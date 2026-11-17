-- Étiquettes (tags) sur les fan arts, dont « 18+ ».
-- À exécuter après 20261117010000_fanart_source.sql. Peut être relancé sans risque.
--   • jusqu'à 8 étiquettes libres par fan art (2 à 24 caractères, filtre de mots interdits) ;
--   • 18+ : visible uniquement par les membres connectés et majeurs (année de naissance), jamais par les
--     visiteurs ni les mineurs — appliqué par la base de données, pas seulement par le site ;
--   • un mineur ne peut pas publier de fan art 18+ ; un fan art 18+ ne peut pas être envoyé à un mineur ;
--   • l'administrateur peut ajouter ou retirer l'étiquette 18+ lors de la vérification.

alter table public.fanarts add column if not exists tags text[] not null default '{}';
alter table public.fanarts add column if not exists adult boolean not null default false;
alter table public.fanarts drop constraint if exists fanarts_tags_check;
alter table public.fanarts add constraint fanarts_tags_check check (cardinality(tags) <= 8);
create index if not exists fanarts_tags_idx on public.fanarts using gin (tags);
grant update (tags, adult) on public.fanarts to authenticated;

-- Peut-on voir un fan art 18+ ? (membre connecté et majeur)
create or replace function public.can_see_adult() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and public.is_adult_user((select auth.uid()))
$$;
revoke all on function public.can_see_adult() from public;
grant execute on function public.can_see_adult() to anon, authenticated;

drop policy if exists "fanarts: lecture publique" on public.fanarts;
drop policy if exists "fanarts: lecture" on public.fanarts;
create policy "fanarts: lecture publique" on public.fanarts for select to anon using (status = 'approved' and not adult);
create policy "fanarts: lecture" on public.fanarts for select to authenticated
  using ((status = 'approved' and (not adult or public.can_see_adult())) or user_id = (select auth.uid()) or public.is_admin());

create or replace function public.fanarts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  new.credit := nullif(btrim(new.credit), '');
  new.source_url := nullif(btrim(new.source_url), '');
  -- étiquettes : minuscules, sans « # », sans doublon ; « 18+ » se règle avec la colonne adult
  new.tags := coalesce((select array_agg(distinct x) from (
      select left(btrim(lower(regexp_replace(t, '^#+', ''))), 24) as x from unnest(coalesce(new.tags, '{}')) t) s
    where char_length(x) >= 2 and x not in ('18+', '+18', 'nsfw', '18')), '{}');
  if cardinality(new.tags) > 8 then new.tags := new.tags[1:8]; end if;
  if lower(normalize(array_to_string(coalesce(new.tags, '{}'), ' '), NFKC)) ~ '(https?://|www\.|\.(com|fr|net|org)(\W|$))' then
    raise exception 'credit_link' using errcode = '23514';
  end if;
  if public.has_forbidden_word(txt || ' ' || coalesce(new.credit, '') || ' ' || array_to_string(new.tags, ' ')) then
    raise exception 'forbidden_word' using errcode = '23514';
  end if;
  if public.language_problem(txt) is not null then raise exception 'language' using errcode = '23514'; end if;
  if lower(normalize(coalesce(new.credit, ''), NFKC)) ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|art)(\W|$)|@[a-z0-9_.]+\.[a-z]{2,})' then
    raise exception 'credit_link' using errcode = '23514';
  end if;
  -- un mineur (ou un compte sans année de naissance) ne publie pas de contenu 18+
  if new.adult and not public.is_admin() and not public.is_adult_user(new.user_id) then
    raise exception 'adult_minor' using errcode = '42501';
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
    -- texte, crédit, source ou retrait du 18+ : nouvelle vérification
    new.status := case when (new.title, new.description, new.credit, new.source_url) is distinct from (old.title, old.description, old.credit, old.source_url)
                         or (old.adult and not new.adult) then 'pending' else old.status end;
    new.reject_reason := case when new.status = 'pending' then null else old.reject_reason end;
  end if;
  return new;
end $$;

drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer);
drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer, text);
create or replace function public.fanarts_list(
  p_sort text default 'recent', p_character integer default null, p_anime integer default null,
  p_user uuid default null, p_ids uuid[] default null, p_limit integer default 48, p_offset integer default 0, p_tag text default null)
returns table (id uuid, user_id uuid, username text, path text, width integer, height integer, title text, description text, credit text, source_url text,
               tags text[], adult boolean,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.user_id, coalesce(p.username, 'Membre'), f.path, f.width, f.height, f.title, f.description, f.credit, f.source_url,
         f.tags, f.adult, f.character_id, f.anime_id,
         f.status, case when f.user_id = (select auth.uid()) then f.reject_reason end, f.created_at,
         (select count(*) from public.fanart_likes l where l.fanart_id = f.id),
         exists (select 1 from public.fanart_likes l where l.fanart_id = f.id and l.user_id = (select auth.uid())),
         f.user_id = (select auth.uid())
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id
  where ((f.status = 'approved' and (not f.adult or public.can_see_adult()))
         or (p_user is not null and p_user = (select auth.uid()) and f.user_id = p_user)
         or (p_ids is not null and f.user_id = (select auth.uid())))
    and (p_character is null or f.character_id = p_character)
    and (p_anime is null or f.anime_id = p_anime)
    and (p_user is null or f.user_id = p_user)
    and (p_ids is null or f.id = any(p_ids))
    and (p_tag is null or (p_tag = '18+' and f.adult) or lower(p_tag) = any(f.tags))
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), f.user_id))
  order by case when p_sort = 'top' then (select count(*) from public.fanart_likes l where l.fanart_id = f.id) end desc nulls last, f.created_at desc
  limit least(greatest(p_limit, 1), 100) offset greatest(p_offset, 0)
$$;
revoke all on function public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer, text) from public;
grant execute on function public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer, text) to anon, authenticated;

-- Étiquettes les plus utilisées (pour les filtres de la galerie), selon ce que la personne a le droit de voir.
create or replace function public.fanart_tags_top(n integer default 30)
returns table (tag text, uses bigint)
language sql stable security definer set search_path = '' as $$
  select t, count(*) from public.fanarts f, unnest(f.tags) t
  where f.status = 'approved' and (not f.adult or public.can_see_adult())
  group by t order by count(*) desc, t limit least(greatest(n, 1), 60)
$$;
revoke all on function public.fanart_tags_top(integer) from public;
grant execute on function public.fanart_tags_top(integer) to anon, authenticated;

drop function if exists public.admin_fanarts(text);
create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text, source_url text,
               tags text[], adult boolean, character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.source_url,
    f.tags, f.adult, f.character_id, f.anime_id, f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;

-- Un fan art 18+ ne peut pas être envoyé à un mineur (ni par un mineur) dans la messagerie.
create or replace function public.messages_adult() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.body ~ '\[\[fanart:' and exists (
    select 1 from public.fanarts f
    where f.adult and f.id::text in (select (regexp_matches(new.body, '\[\[fanart:([0-9a-f-]{36})\]\]', 'g'))[1]))
    and not (public.is_adult_user(new.sender) and public.is_adult_user(new.recipient)) then
    raise exception 'adult_blocked' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_adult on public.messages;
create trigger messages_adult before insert on public.messages for each row execute function public.messages_adult();
