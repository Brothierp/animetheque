-- Images envoyées dans les conversations : privées, jamais publiées dans la galerie de fan arts.
-- À exécuter après 20261117020000_fanart_tags.sql. Peut être relancé sans risque.
--   • stockage privé (bucket « chat-images ») : seuls l'expéditeur, le destinataire et l'administrateur y accèdent ;
--   • entre deux majeurs : l'image est visible tout de suite ;
--   • si un mineur participe à la conversation : l'image est vérifiée par l'administrateur avant que le destinataire la voie ;
--   • 30 images par jour au plus ; seulement entre amis, jamais avec une personne bloquée.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-images', 'chat-images', false, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

create table if not exists public.chat_images (
  id            uuid        primary key default gen_random_uuid(),
  sender        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipient     uuid        not null references auth.users (id) on delete cascade,
  path          text        not null unique check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  width         integer     check (width between 1 and 10000),
  height        integer     check (height between 1 and 10000),
  status        text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at   timestamptz,
  created_at    timestamptz not null default now(),
  check (sender <> recipient)
);
create index if not exists chat_images_pending_idx on public.chat_images (created_at) where status = 'pending';
alter table public.chat_images enable row level security;
revoke all on public.chat_images from anon, authenticated;
grant select, insert, delete on public.chat_images to authenticated;
grant update (status) on public.chat_images to authenticated;

drop policy if exists "images chat: lecture" on public.chat_images;
drop policy if exists "images chat: envoi" on public.chat_images;
drop policy if exists "images chat: vérification" on public.chat_images;
drop policy if exists "images chat: suppression" on public.chat_images;
create policy "images chat: lecture" on public.chat_images for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()) or public.is_admin());
create policy "images chat: envoi" on public.chat_images for insert to authenticated
  with check (sender = (select auth.uid()) and split_part(path, '/', 1) = (select auth.uid())::text
              and public.is_friend(sender, recipient) and not public.is_blocked(sender, recipient));
create policy "images chat: vérification" on public.chat_images for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "images chat: suppression" on public.chat_images for delete to authenticated
  using (sender = (select auth.uid()) or public.is_admin());

-- Statut fixé par la base : visible tout de suite entre deux majeurs, sinon vérification.
create or replace function public.chat_images_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if (select count(*) from public.chat_images where sender = new.sender and created_at > now() - interval '1 day') >= 30 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    new.created_at := now(); new.reviewed_at := null;
    new.status := case when public.is_adult_user(new.sender) and public.is_adult_user(new.recipient) then 'approved' else 'pending' end;
  elsif new.status is distinct from old.status then
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists chat_images_check on public.chat_images;
create trigger chat_images_check before insert or update on public.chat_images for each row execute function public.chat_images_check();

-- Le destinataire ne voit l'image (fichier) qu'une fois visible ; l'expéditeur et l'administrateur toujours.
create or replace function public.can_read_chat_image(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_images c where c.path = p and (
    c.sender = (select auth.uid()) or (c.recipient = (select auth.uid()) and c.status = 'approved') or public.is_admin()))
$$;
revoke all on function public.can_read_chat_image(text) from public;
grant execute on function public.can_read_chat_image(text) to authenticated;

drop policy if exists "images chat: fichier lecture" on storage.objects;
drop policy if exists "images chat: fichier ajout" on storage.objects;
drop policy if exists "images chat: fichier suppression" on storage.objects;
create policy "images chat: fichier lecture" on storage.objects for select to authenticated
  using (bucket_id = 'chat-images' and public.can_read_chat_image(name));
create policy "images chat: fichier ajout" on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "images chat: fichier suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

-- Un message ne peut citer que des images de cette conversation, envoyées par l'expéditeur.
create or replace function public.messages_images() returns trigger
language plpgsql security definer set search_path = '' as $$
declare i text;
begin
  for i in select (regexp_matches(new.body, '\[\[image:([0-9a-f-]{36})\]\]', 'g'))[1] loop
    if not exists (select 1 from public.chat_images c where c.id::text = i and c.sender = new.sender and c.recipient = new.recipient) then
      raise exception 'image_not_allowed' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists messages_images on public.messages;
create trigger messages_images before insert on public.messages for each row execute function public.messages_images();

-- Les jetons d'image ne comptent pas comme des coordonnées dans l'analyse des conversations majeur / mineur.
create or replace function public.messages_safety() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  b text := regexp_replace(coalesce(new.body, ''), '\[\[(anime|perso|fanart|image):[0-9a-f-]{1,36}\]\]', ' ', 'g');
  raw text := lower(b);
  t text := public.safety_text(b);
  digits text := regexp_replace(b, '[^0-9]', '', 'g');
  cat text := null;
begin
  if not public.is_mixed_age(new.sender, new.recipient) then return new; end if;
  if raw ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|be|ch|ca)(\W|$))'
     or raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
     or length(digits) >= 8
     or t ~ ' (snap|snapchat|insta|instagram|whatsapp|whats app|wa me|discord|telegram|tiktok|signal|messenger|kik|skype|facetime|numero|num tel|telephone|mon tel|ton tel|adresse|address|phone number|my number|your number) ' then
    raise exception 'contact_blocked' using errcode = 'P0001',
      hint = 'Entre majeurs et mineurs, les coordonnées et les liens ne peuvent pas être échangés.';
  end if;
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

-- File de vérification pour l'administrateur (conversations avec un mineur).
drop function if exists public.admin_chat_images(text);
create or replace function public.admin_chat_images(p_status text default 'pending')
returns table (id uuid, path text, status text, created_at timestamptz, sender uuid, sender_name text, sender_adult boolean,
               recipient uuid, recipient_name text, recipient_adult boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select c.id, c.path, c.status, c.created_at,
    c.sender, ps.username, public.is_adult_user(c.sender), c.recipient, pr.username, public.is_adult_user(c.recipient)
  from public.chat_images c left join public.profiles ps on ps.user_id = c.sender left join public.profiles pr on pr.user_id = c.recipient
  where c.status = p_status order by c.created_at limit 200;
end $$;
revoke all on function public.admin_chat_images(text) from public;
grant execute on function public.admin_chat_images(text) to authenticated;

create or replace function public.admin_pending_chat_images() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then (select count(*)::integer from public.chat_images where status = 'pending') else 0 end
$$;
revoke all on function public.admin_pending_chat_images() from public;
grant execute on function public.admin_pending_chat_images() to authenticated;
