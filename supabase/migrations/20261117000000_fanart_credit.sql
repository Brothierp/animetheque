-- Crédit de l'artiste sur les fan arts, et pseudos décorés acceptés (ex. « ˚˖𓍢ִ໋❀𝓜𝓪𝓴𝓸𝓽𝓸 »).
-- À exécuter après 20261116020000_fanarts.sql. Peut être relancé sans risque.
--   • les lettres « stylisées » (𝓜𝓪𝓴𝓸𝓽𝓸, ｍａｋｏｔｏ…) sont ramenées à des lettres normales avant les contrôles,
--     ce qui évite aussi de contourner le filtre de mots interdits avec ces caractères ;
--   • le contrôle de langue ignore les symboles et signes décoratifs : seul un vrai mot dans un autre alphabet
--     (au moins 3 lettres) est refusé ;
--   • nouveau champ « Artiste » sur les fan arts : nom libre (symboles acceptés), sans lien ni mot interdit.

-- 1. Normalisation : lettres stylisées → lettres normales (NFKC), puis minuscules, accents et « leet ».
create or replace function public.normalize_text(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(lower(normalize(coalesce(t, ''), NFKC)),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ013457@$!|',
      'aaaaaaceeeeiiiinooooouuuuyyoaoieastasii'),
    '(.)\1{2,}', '\1\1', 'g')
$$;

-- 2. Langues : on ne compte que les lettres, et il faut un vrai mot (3 lettres ou plus) dans un alphabet refusé.
create or replace function public.language_problem(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := normalize(coalesce(t, ''), NFKC);
  letters int; jp int; other int; w text[]; fe int := 0; ot int := 0; x text;
  FE_WORDS text[] := array['le','la','les','un','une','des','du','de','et','est','pas','que','qui','je','tu','il','elle','on','nous','vous','ce','cet','cette','mais','tres','bien','pour','avec','sur','dans','mon','ton','son','ma','plus','moins','trop','vraiment','tout','fin','serie','the','and','is','it','this','that','was','very','but','not','with','for','of','to','in','my','i','you','he','she','we','they','so','really','good','great','bad','anime','story','show','are','be','have','has','its','es','non','die','a','o'];
  OT_WORDS text[] := array['el','los','las','una','unos','unas','muy','pero','porque','mas','esta','este','tambien','gracias','hola','para','como','del','al','lo','mi','tu','bueno','buena','bonita','bonito','hermosa','hermoso','todo','nada','gusta','encanta','mucho','mucha','tengo','tiene','favorita','favorito','ilustracion','dibujo',
    'der','die','das','und','ist','nicht','ein','eine','sehr','aber','auch','ich','mit','gut','schon','wirklich','mein','dein','danke','zeichnung',
    'gli','che','non','sono','molto','della','anche','perche','bella','bello','grazie','ciao','questo','questa',
    'os','uma','muito','nao','voce','com','isso','obrigado','obrigada','lindo','linda','legal',
    'het','een','niet','ik','zijn','dat','och','att','jag','inte','det','som'];
begin
  letters := length(regexp_replace(s, '[[:space:][:punct:][:digit:]]', '', 'g'));
  if letters = 0 then return null; end if;
  -- lettres d'alphabets refusés (cyrillique, grec, arabe, hébreu, devanagari, thaï, coréen) ; les signes diacritiques isolés ne comptent pas
  other := length(regexp_replace(s, '[^А-яЁёΑ-Ωα-ωء-يא-תक-हก-ฮ가-힯]', '', 'g'));
  if other >= 3 then return 'language'; end if;
  -- japonais (kana, kanji) : toléré pour citer un titre, pas pour tout le texte
  jp := length(regexp_replace(s, '[^぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]', '', 'g'));
  if jp > 30 or (jp > 6 and jp::numeric / letters > 0.35) then return 'language'; end if;
  -- autres langues à alphabet latin : petits mots courants (espagnol, allemand, italien, portugais…)
  w := regexp_split_to_array(lower(translate(s, 'àâäéèêëîïôöùûüçñãõáíóú', 'aaaeeeeiioouuucnaoaiou')), '[^a-z]+');
  foreach x in array w loop
    if x = any(FE_WORDS) then fe := fe + 1; end if;
    if x = any(OT_WORDS) and not (x = any(FE_WORDS)) then ot := ot + 1; end if;
  end loop;
  if ot >= 3 and ot >= fe then return 'language'; end if;
  return null;
end $$;

-- 3. Crédit de l'artiste
alter table public.fanarts add column if not exists credit text;
alter table public.fanarts drop constraint if exists fanarts_credit_check;
alter table public.fanarts add constraint fanarts_credit_check check (credit is null or char_length(btrim(credit)) between 1 and 80);
grant update (credit) on public.fanarts to authenticated;

create or replace function public.fanarts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  new.credit := nullif(btrim(new.credit), '');
  if public.has_forbidden_word(txt || ' ' || coalesce(new.credit, '')) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(txt) is not null then raise exception 'language' using errcode = '23514'; end if;
  if lower(normalize(coalesce(new.credit, ''), NFKC)) ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|art)(\W|$)|@[a-z0-9_.]+\.[a-z]{2,})' then
    raise exception 'credit_link' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.reject_reason := null; new.reviewed_at := null; new.created_at := now();
    if (select count(*) from public.fanarts where user_id = new.user_id and created_at > now() - interval '1 day') >= 5 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    if (select count(*) from public.fanarts where user_id = new.user_id and status = 'pending') >= 10 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  elsif public.is_admin() and new.status is distinct from old.status then
    new.reviewed_at := now();
    if new.status <> 'rejected' then new.reject_reason := null; end if;
  elsif not public.is_admin() then
    new.status := case when (new.title, new.description, new.credit) is distinct from (old.title, old.description, old.credit) then 'pending' else old.status end;
    new.reject_reason := case when new.status = 'pending' then null else old.reject_reason end;
  end if;
  return new;
end $$;

drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer);
create or replace function public.fanarts_list(
  p_sort text default 'recent', p_character integer default null, p_anime integer default null,
  p_user uuid default null, p_ids uuid[] default null, p_limit integer default 48, p_offset integer default 0)
returns table (id uuid, user_id uuid, username text, path text, width integer, height integer, title text, description text, credit text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.user_id, coalesce(p.username, 'Membre'), f.path, f.width, f.height, f.title, f.description, f.credit, f.character_id, f.anime_id,
         f.status, case when f.user_id = (select auth.uid()) then f.reject_reason end, f.created_at,
         (select count(*) from public.fanart_likes l where l.fanart_id = f.id),
         exists (select 1 from public.fanart_likes l where l.fanart_id = f.id and l.user_id = (select auth.uid())),
         f.user_id = (select auth.uid())
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id
  where (f.status = 'approved' or (p_user is not null and p_user = (select auth.uid()) and f.user_id = p_user))
    and (p_character is null or f.character_id = p_character)
    and (p_anime is null or f.anime_id = p_anime)
    and (p_user is null or f.user_id = p_user)
    and (p_ids is null or f.id = any(p_ids))
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), f.user_id))
  order by case when p_sort = 'top' then (select count(*) from public.fanart_likes l where l.fanart_id = f.id) end desc nulls last, f.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke all on function public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer) from public;
grant execute on function public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer) to anon, authenticated;

drop function if exists public.admin_fanarts(text);
create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.character_id, f.anime_id,
    f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;
