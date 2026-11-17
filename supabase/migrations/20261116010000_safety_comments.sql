-- Protection des mineurs dans la messagerie, et avis des membres sous chaque animé.
-- À exécuter après 20261116000000_social.sql. Peut être relancé sans risque.
--
-- 1. Les mineurs peuvent devenir amis avec des majeurs (message de prévention côté site).
--    Les conversations entre un majeur et un mineur sont analysées automatiquement par la base :
--      • coordonnées et liens bloqués (téléphone, e-mail, réseaux sociaux, adresses web) ;
--      • messages à risque (secret, photos, rendez-vous, questions intimes…) signalés à l'administrateur,
--        qui ne voit que le message concerné.
--    La messagerie n'accepte que du texte : aucune photo ni fichier.
-- 2. Avis publics sous chaque animé : un par membre et par animé, modifiable ; en français ou en anglais
--    (japonais toléré pour citer un titre) ; filtre de mots interdits ; signalement ; suppression par l'admin.

-- ---------------------------------------------------------------------------
-- 1. Amitiés mineurs / majeurs
-- ---------------------------------------------------------------------------
create or replace function public.can_befriend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a <> b and public.has_birth_year(a) and public.has_birth_year(b) and not public.is_blocked(a, b)
$$;
create or replace function public.is_mixed_age(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_adult_user(a) <> public.is_adult_user(b)
$$;
revoke all on function public.is_mixed_age(uuid, uuid) from public;
grant execute on function public.is_mixed_age(uuid, uuid) to authenticated;

-- find_member et member_profiles indiquent si la relation est entre un majeur et un mineur (pour la prévention).
drop function if exists public.find_member(text);
create or replace function public.find_member(name text)
returns table (user_id uuid, username text, avatar_path text, relation text, allowed boolean, mixed boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path,
         coalesce((select case when f.status = 'accepted' then 'friend' when f.requested_by = (select auth.uid()) then 'sent' else 'received' end
                   from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))), 'none'),
         public.can_befriend((select auth.uid()), p.user_id),
         public.is_mixed_age((select auth.uid()), p.user_id)
  from public.profiles p
  where lower(p.username) = lower(btrim(name)) and p.user_id <> (select auth.uid())
    and not public.is_blocked((select auth.uid()), p.user_id)
  limit 1
$$;
drop function if exists public.member_profiles(uuid[]);
create or replace function public.member_profiles(ids uuid[])
returns table (user_id uuid, username text, avatar_path text, mixed boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path, public.is_mixed_age((select auth.uid()), p.user_id) from public.profiles p
  where p.user_id = any(ids) and (p.user_id = (select auth.uid()) or exists (
    select 1 from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))))
$$;
revoke all on function public.find_member(text), public.member_profiles(uuid[]) from public;
grant execute on function public.find_member(text), public.member_profiles(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Signalements : automatiques (sans auteur) et sur les avis
-- ---------------------------------------------------------------------------
alter table public.reports alter column reporter drop not null;
alter table public.reports add column if not exists auto boolean not null default false;
alter table public.reports add column if not exists comment_id uuid;
alter table public.reports add column if not exists category text;

-- ---------------------------------------------------------------------------
-- 3. Analyse des messages entre un majeur et un mineur
-- ---------------------------------------------------------------------------
-- Texte normalisé pour la détection : minuscules, sans accents, « leet » remplacé.
create or replace function public.safety_text(t text) returns text
language sql immutable set search_path = '' as $$
  select ' ' || regexp_replace(public.normalize_text(t), '[^a-z0-9@.:/]+', ' ', 'g') || ' '
$$;

create or replace function public.messages_safety() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- les fiches partagées du site ([[anime:12]], [[perso:34]], [[fanart:<id>]]) ne comptent pas
  b text := regexp_replace(coalesce(new.body, ''), '\[\[(anime|perso|fanart|image):[0-9a-f-]{1,36}\]\]', ' ', 'g');
  raw text := lower(b);
  t text := public.safety_text(b);
  digits text := regexp_replace(b, '[^0-9]', '', 'g');
  cat text := null;
begin
  if not public.is_mixed_age(new.sender, new.recipient) then return new; end if;

  -- a) Coordonnées et liens : bloqués
  if raw ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|be|ch|ca)(\W|$))'
     or raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
     or length(digits) >= 8
     or t ~ ' (snap|snapchat|insta|instagram|whatsapp|whats app|wa me|discord|telegram|tiktok|signal|messenger|kik|skype|facetime|numero|num tel|telephone|mon tel|ton tel|adresse|address|phone number|my number|your number) ' then
    raise exception 'contact_blocked' using errcode = 'P0001',
      hint = 'Entre majeurs et mineurs, les coordonnées et les liens ne peuvent pas être échangés.';
  end if;

  -- b) Messages à risque : envoyés, mais signalés automatiquement à l'administrateur
  if t ~ ' (secret|garde ca pour toi|le dis a personne|dis rien a tes parents|tes parents|your parents|don t tell|dont tell|between us|entre nous) ' then cat := 'secret';
  elsif t ~ ' (photo de toi|photos de toi|ta photo|tes photos|selfie|nude|nudes|webcam|video de toi|picture of you|pic of you|pics of you|montre toi|show me you) ' then cat := 'photos';
  elsif t ~ ' (on se voit|se voir|se rencontrer|rejoins moi|viens chez|chez moi|chez toi|rdv|rendez vous|meet up|meet me|let s meet|come over|ou tu habites|tu habites ou|where do you live|t habites) ' then cat := 'rencontre';
  elsif t ~ ' (sexy|sexe|sex|bisou|bisous|calin|petite amie|petit ami|girlfriend|boyfriend|tu es seule|t es seule|tu es seul|t es seul|are you alone|seul chez|seule chez|deshabille|undress|kiss|ton corps|your body) ' then cat := 'intime';
  elsif t ~ ' (quel age|t as quel age|how old are you|ton age|your age|tu as quel age) ' then cat := 'age';
  elsif t ~ ' (cadeau|gift|argent|money|paypal|carte cadeau|robux|v bucks) ' then cat := 'cadeau';
  end if;
  if cat is not null then
    insert into public.reports (reporter, target_user, excerpt, reason, auto, category)
    values (null, new.sender, left(new.body, 2000), 'Détection automatique (conversation majeur / mineur) : ' || cat, true, cat);
  end if;
  return new;
end $$;
drop trigger if exists messages_safety on public.messages;
create trigger messages_safety before insert on public.messages for each row execute function public.messages_safety();

-- Le message à risque est enregistré avant d'être inséré : on rattache ensuite le signalement à son id.
create or replace function public.messages_safety_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reports set message_id = new.id
   where auto and message_id is null and target_user = new.sender and excerpt = left(new.body, 2000) and created_at > now() - interval '1 minute';
  return new;
end $$;
drop trigger if exists messages_safety_link on public.messages;
create trigger messages_safety_link after insert on public.messages for each row execute function public.messages_safety_link();

-- ---------------------------------------------------------------------------
-- 4. Langues autorisées (avis) : français et anglais ; japonais toléré pour un titre
-- ---------------------------------------------------------------------------
create or replace function public.language_problem(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  letters int; jp int; other int; w text[]; fe int := 0; ot int := 0; x text;
  FE_WORDS text[] := array['le','la','les','un','une','des','du','de','et','est','pas','que','qui','je','tu','il','elle','on','nous','vous','ce','cet','cette','mais','tres','bien','pour','avec','sur','dans','mon','ton','son','ma','plus','moins','trop','vraiment','tout','fin','serie','the','and','is','it','this','that','was','very','but','not','with','for','of','to','in','my','i','you','he','she','we','they','so','really','good','great','bad','anime','story','show','are','be','have','has','its','es','non','die','a','o'];
  OT_WORDS text[] := array['el','los','las','una','unos','unas','muy','pero','porque','mas','esta','este','tambien','gracias','hola','para','como','del','al','lo','mi','tu','bueno','buena','bonita','bonito','hermosa','hermoso','todo','nada','gusta','encanta','mucho','mucha','tengo','tiene','favorita','favorito','ilustracion','dibujo',
    'der','die','das','und','ist','nicht','ein','eine','sehr','aber','auch','ich','mit','gut','schon','wirklich','mein','dein','danke','zeichnung',
    'gli','che','non','sono','molto','della','anche','perche','bella','bello','grazie','ciao','questo','questa',
    'os','uma','muito','nao','voce','com','isso','obrigado','obrigada','lindo','linda','legal',
    'het','een','niet','ik','zijn','dat','och','att','jag','inte','det','som'];
begin
  letters := length(regexp_replace(coalesce(t, ''), '[[:space:][:punct:][:digit:]]', '', 'g'));
  if letters = 0 then return null; end if;
  -- alphabets non latins (hors japonais) : refusés
  other := length(regexp_replace(t, '[^Ѐ-ӿͰ-Ͽ؀-ۿݐ-ݿ֐-׿ऀ-ॿ฀-๿가-힯ᄀ-ᇿ]', '', 'g'));
  if other > 0 then return 'language'; end if;
  -- japonais (kana, kanji) : toléré pour citer un titre, pas pour tout l'avis
  jp := length(regexp_replace(t, '[^぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]', '', 'g'));
  if jp > 30 or jp::numeric / letters > 0.35 then return 'language'; end if;
  -- autres langues à alphabet latin : petits mots courants (espagnol, allemand, italien, portugais…)
  w := regexp_split_to_array(lower(translate(t, 'àâäéèêëîïôöùûüçñãõáíóú', 'aaaeeeeiioouuucnaoaiou')), '[^a-z]+');
  foreach x in array w loop
    if x = any(FE_WORDS) then fe := fe + 1; end if;
    if x = any(OT_WORDS) and not (x = any(FE_WORDS)) then ot := ot + 1; end if;
  end loop;
  if ot >= 3 and ot >= fe then return 'language'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Avis sous chaque animé
-- ---------------------------------------------------------------------------
create table if not exists public.anime_comments (
  id         uuid        primary key default gen_random_uuid(),
  anime_id   integer     not null check (anime_id > 0),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 2 and 1500),
  spoiler    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anime_id, user_id)
);
create index if not exists anime_comments_anime_idx on public.anime_comments (anime_id, created_at desc);
alter table public.anime_comments enable row level security;
revoke all on public.anime_comments from anon, authenticated;
grant select on public.anime_comments to anon, authenticated;
grant insert, delete on public.anime_comments to authenticated;
grant update (body, spoiler) on public.anime_comments to authenticated;

drop policy if exists "avis: lecture" on public.anime_comments;
drop policy if exists "avis: écriture" on public.anime_comments;
drop policy if exists "avis: modification" on public.anime_comments;
drop policy if exists "avis: suppression" on public.anime_comments;
create policy "avis: lecture" on public.anime_comments for select to anon, authenticated using (true);
-- Pseudo requis pour publier un avis.
create policy "avis: écriture" on public.anime_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.username is not null));
create policy "avis: modification" on public.anime_comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "avis: suppression" on public.anime_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create or replace function public.comments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.has_forbidden_word(new.body) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(new.body) is not null then
    raise exception 'language' using errcode = '23514', hint = 'Les avis s''écrivent en français ou en anglais.';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.anime_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists comments_check on public.anime_comments;
create trigger comments_check before insert or update on public.anime_comments for each row execute function public.comments_check();

-- Avis d'un animé avec le pseudo de leur auteur (lisible par tous, même sans compte).
create or replace function public.anime_comments_list(aid integer)
returns table (id uuid, body text, spoiler boolean, created_at timestamptz, updated_at timestamptz, user_id uuid, username text, mine boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.spoiler, c.created_at, c.updated_at, c.user_id, coalesce(p.username, 'Membre'), c.user_id = (select auth.uid())
  from public.anime_comments c left join public.profiles p on p.user_id = c.user_id
  where c.anime_id = aid
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), c.user_id))
  order by (c.user_id = (select auth.uid())) desc, c.created_at desc
  limit 200
$$;
revoke all on function public.anime_comments_list(integer) from public;
grant execute on function public.anime_comments_list(integer) to anon, authenticated;

-- Signaler un avis : copie du texte pour l'administrateur.
create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages; c public.anime_comments;
begin
  if new.auto then return new; end if;
  if new.message_id is not null then
    select * into m from public.messages where id = new.message_id and new.reporter in (sender, recipient);
    if found then new.excerpt := left(m.body, 2000); new.target_user := m.sender; else new.message_id := null; end if;
  end if;
  if new.comment_id is not null then
    select * into c from public.anime_comments where id = new.comment_id;
    if found then new.excerpt := left(c.body, 2000); new.target_user := c.user_id; new.category := 'avis'; else new.comment_id := null; end if;
  end if;
  if new.target_user is null then raise exception 'no_target' using errcode = '22023'; end if;
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Signalements pour l'administrateur (avec détections automatiques et avis).
drop function if exists public.admin_reports();
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean, auto boolean, category text,
               comment_id uuid, reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled, r.auto, r.category, r.comment_id,
    pr.username, ur.email::text, r.target_user, pt.username, ut.email::text
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.created_at desc;
end $$;
revoke all on function public.admin_reports() from public;
grant execute on function public.admin_reports() to authenticated;

-- La langue est aussi vérifiée dans les messages privés et les suggestions.
create or replace function public.language_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.language_problem(new.body) is not null then
    raise exception 'language' using errcode = '23514', hint = 'Seuls le français et l''anglais sont acceptés.';
  end if;
  return new;
end $$;
drop trigger if exists messages_language on public.messages;
create trigger messages_language before insert on public.messages for each row execute function public.language_check();
drop trigger if exists feedback_language on public.feedback;
create trigger feedback_language before insert or update of body on public.feedback for each row execute function public.language_check();
drop trigger if exists feedback_replies_language on public.feedback_replies;
create trigger feedback_replies_language before insert on public.feedback_replies for each row execute function public.language_check();
