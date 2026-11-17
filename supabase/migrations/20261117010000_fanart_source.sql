-- Source des fan arts récupérés sur d'autres plateformes (Pinterest, DeviantArt, ArtStation, Pixiv…).
-- À exécuter après 20261117000000_fanart_credit.sql. Peut être relancé sans risque.
--   • lien https facultatif, uniquement vers des sites d'illustration connus (liste ci-dessous) ;
--   • modifier la source renvoie le fan art en vérification ;
--   • les images envoyées depuis la messagerie sont des fan arts comme les autres : vérifiées avant d'être visibles.

alter table public.fanarts add column if not exists source_url text;
alter table public.fanarts drop constraint if exists fanarts_source_check;
alter table public.fanarts add constraint fanarts_source_check check (source_url is null or (
  char_length(source_url) <= 300 and source_url !~ '\s'
  and source_url ~* '^https://([a-z0-9-]+\.)*(pinterest\.[a-z]{2,3}(\.[a-z]{2})?|pin\.it|deviantart\.com|artstation\.com|pixiv\.net|x\.com|twitter\.com|instagram\.com|tumblr\.com|bsky\.app|reddit\.com|behance\.net)(/.*)?$'));
grant update (source_url) on public.fanarts to authenticated;

create or replace function public.fanarts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  new.credit := nullif(btrim(new.credit), '');
  new.source_url := nullif(btrim(new.source_url), '');
  if public.has_forbidden_word(txt || ' ' || coalesce(new.credit, '')) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(txt) is not null then raise exception 'language' using errcode = '23514'; end if;
  if lower(normalize(coalesce(new.credit, ''), NFKC)) ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|art)(\W|$)|@[a-z0-9_.]+\.[a-z]{2,})' then
    raise exception 'credit_link' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pending'; new.reject_reason := null; new.reviewed_at := null; new.created_at := now();
    if (select count(*) from public.fanarts where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
    if (select count(*) from public.fanarts where user_id = new.user_id and status = 'pending') >= 15 then
      raise exception 'rate_limited' using errcode = 'P0001';
    end if;
  elsif public.is_admin() and new.status is distinct from old.status then
    new.reviewed_at := now();
    if new.status <> 'rejected' then new.reject_reason := null; end if;
  elsif not public.is_admin() then
    new.status := case when (new.title, new.description, new.credit, new.source_url) is distinct from (old.title, old.description, old.credit, old.source_url)
                       then 'pending' else old.status end;
    new.reject_reason := case when new.status = 'pending' then null else old.reject_reason end;
  end if;
  return new;
end $$;

drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer);
create or replace function public.fanarts_list(
  p_sort text default 'recent', p_character integer default null, p_anime integer default null,
  p_user uuid default null, p_ids uuid[] default null, p_limit integer default 48, p_offset integer default 0)
returns table (id uuid, user_id uuid, username text, path text, width integer, height integer, title text, description text, credit text, source_url text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.user_id, coalesce(p.username, 'Membre'), f.path, f.width, f.height, f.title, f.description, f.credit, f.source_url, f.character_id, f.anime_id,
         f.status, case when f.user_id = (select auth.uid()) then f.reject_reason end, f.created_at,
         (select count(*) from public.fanart_likes l where l.fanart_id = f.id),
         exists (select 1 from public.fanart_likes l where l.fanart_id = f.id and l.user_id = (select auth.uid())),
         f.user_id = (select auth.uid())
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id
  where (f.status = 'approved' or (p_user is not null and p_user = (select auth.uid()) and f.user_id = p_user)
         or (p_ids is not null and f.user_id = (select auth.uid())))
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
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text, source_url text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.source_url, f.character_id, f.anime_id,
    f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;
