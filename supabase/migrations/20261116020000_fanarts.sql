-- Galerie de fan arts des membres, modérée : chaque image est vérifiée par l'administrateur avant d'être publiée.
-- À exécuter après 20261116010000_safety_comments.sql. Peut être relancé sans risque.
--   • publication : membre avec pseudo, image (WebP/JPEG/PNG, 3 Mo max, convertie et redimensionnée par le site,
--     ce qui supprime les métadonnées comme la position GPS), titre, personnage ou animé lié, description ;
--   • tant qu'elle n'est pas validée, l'image n'est visible que par son auteur et l'administrateur ;
--   • les fan arts validés sont visibles par tous et peuvent être partagés dans la messagerie ;
--   • ♥ par les membres, signalement, suppression par l'auteur ou l'administrateur.

-- Stockage : dossier par membre ; les adresses (identifiants aléatoires) ne sont connues que du site.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fanarts', 'fanarts', true, 3145728, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = true, file_size_limit = 3145728, allowed_mime_types = array['image/webp', 'image/jpeg', 'image/png'];

drop policy if exists "fanarts: ajout du sien" on storage.objects;
drop policy if exists "fanarts: suppression du sien ou admin" on storage.objects;
create policy "fanarts: ajout du sien" on storage.objects for insert to authenticated
  with check (bucket_id = 'fanarts' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "fanarts: suppression du sien ou admin" on storage.objects for delete to authenticated
  using (bucket_id = 'fanarts' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_admin()));

create table if not exists public.fanarts (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  path          text        not null check (path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(webp|jpg|png)$'),
  width         integer     check (width between 1 and 10000),
  height        integer     check (height between 1 and 10000),
  title         text        not null check (char_length(btrim(title)) between 2 and 80),
  description   text        check (char_length(description) <= 500),
  character_id  integer     check (character_id > 0),
  anime_id      integer     check (anime_id > 0),
  status        text        not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text        check (char_length(reject_reason) <= 300),
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz
);
create index if not exists fanarts_status_idx on public.fanarts (status, created_at desc);
create index if not exists fanarts_char_idx on public.fanarts (character_id) where status = 'approved';
create index if not exists fanarts_anime_idx on public.fanarts (anime_id) where status = 'approved';
alter table public.fanarts enable row level security;
revoke all on public.fanarts from anon, authenticated;
grant select on public.fanarts to anon, authenticated;
grant insert, delete on public.fanarts to authenticated;
grant update (title, description, character_id, anime_id, status, reject_reason) on public.fanarts to authenticated;

drop policy if exists "fanarts: lecture" on public.fanarts;
drop policy if exists "fanarts: publication" on public.fanarts;
drop policy if exists "fanarts: modification" on public.fanarts;
drop policy if exists "fanarts: suppression" on public.fanarts;
drop policy if exists "fanarts: lecture publique" on public.fanarts;
create policy "fanarts: lecture publique" on public.fanarts for select to anon using (status = 'approved');
create policy "fanarts: lecture" on public.fanarts for select to authenticated
  using (status = 'approved' or user_id = (select auth.uid()) or public.is_admin());
create policy "fanarts: publication" on public.fanarts for insert to authenticated
  with check (user_id = (select auth.uid()) and split_part(path, '/', 1) = (select auth.uid())::text
              and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.username is not null));
create policy "fanarts: modification" on public.fanarts for update to authenticated
  using (user_id = (select auth.uid()) or public.is_admin()) with check (user_id = (select auth.uid()) or public.is_admin());
create policy "fanarts: suppression" on public.fanarts for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

-- Contrôles : mots interdits, langue, rythme ; seul l'administrateur valide ou refuse.
-- Une modification du texte par l'auteur renvoie l'image en vérification.
create or replace function public.fanarts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  if public.has_forbidden_word(txt) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(txt) is not null then raise exception 'language' using errcode = '23514'; end if;
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
    new.status := case when (new.title, new.description) is distinct from (old.title, old.description) then 'pending' else old.status end;
    new.reject_reason := case when new.status = 'pending' then null else old.reject_reason end;
  end if;
  return new;
end $$;
drop trigger if exists fanarts_check on public.fanarts;
create trigger fanarts_check before insert or update on public.fanarts for each row execute function public.fanarts_check();

-- ♥
create table if not exists public.fanart_likes (
  fanart_id  uuid        not null references public.fanarts (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (fanart_id, user_id)
);
alter table public.fanart_likes enable row level security;
revoke all on public.fanart_likes from anon, authenticated;
grant select, insert, delete on public.fanart_likes to authenticated;
drop policy if exists "fanart_likes: les siens" on public.fanart_likes;
create policy "fanart_likes: les siens" on public.fanart_likes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.fanarts f where f.id = fanart_id and f.status = 'approved'));

-- Liste pour la galerie (avec pseudo de l'auteur, nombre de ♥, et si je l'ai aimé).
create or replace function public.fanarts_list(
  p_sort text default 'recent', p_character integer default null, p_anime integer default null,
  p_user uuid default null, p_ids uuid[] default null, p_limit integer default 48, p_offset integer default 0)
returns table (id uuid, user_id uuid, username text, path text, width integer, height integer, title text, description text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.user_id, coalesce(p.username, 'Membre'), f.path, f.width, f.height, f.title, f.description, f.character_id, f.anime_id,
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

-- File de modération pour l'administrateur.
create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.character_id, f.anime_id,
    f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;

-- Signaler un fan art.
alter table public.reports add column if not exists fanart_id uuid;
create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages; c public.anime_comments; f public.fanarts;
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
  if new.fanart_id is not null then
    select * into f from public.fanarts where id = new.fanart_id and status = 'approved';
    if found then new.excerpt := left(f.title || ' — ' || f.path, 2000); new.target_user := f.user_id; new.category := 'fanart'; else new.fanart_id := null; end if;
  end if;
  if new.target_user is null then raise exception 'no_target' using errcode = '22023'; end if;
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop function if exists public.admin_reports();
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean, auto boolean, category text,
               comment_id uuid, fanart_id uuid, reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled, r.auto, r.category, r.comment_id, r.fanart_id,
    pr.username, ur.email::text, r.target_user, pt.username, ut.email::text
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.created_at desc;
end $$;
revoke all on function public.admin_reports() from public;
grant execute on function public.admin_reports() to authenticated;

-- Nombre de fan arts à vérifier (badge administrateur).
create or replace function public.admin_pending_fanarts() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_admin() then (select count(*)::integer from public.fanarts where status = 'pending') else 0 end
$$;
revoke all on function public.admin_pending_fanarts() from public;
grant execute on function public.admin_pending_fanarts() to authenticated;
