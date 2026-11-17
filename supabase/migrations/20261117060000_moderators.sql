-- Modérateurs : des personnes de confiance qui aident l'administrateur à modérer.
-- À exécuter après 20261117050000_min_age.sql. Peut être relancé sans risque.
--   • un modérateur vérifie les fan arts et les images des conversations avec un mineur, traite les signalements
--     et supprime les avis ; il ne voit ni les e-mails des membres, ni la liste des comptes, ni les suggestions ;
--   • seul l'administrateur nomme ou retire les modérateurs (page Administration → Comptes).

create table if not exists public.moderators (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  added_at   timestamptz not null default now()
);
alter table public.moderators enable row level security;
revoke all on public.moderators from anon, authenticated;

create or replace function public.is_moderator() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.moderators where user_id = (select auth.uid()))
$$;
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_admin() or public.is_moderator()
$$;
revoke all on function public.is_moderator(), public.is_staff() from public;
grant execute on function public.is_moderator(), public.is_staff() to authenticated;

-- Nommer / retirer un modérateur (administrateur seulement), par pseudo.
create or replace function public.admin_set_moderator(name text, enable boolean) returns text
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  select user_id into u from public.profiles where lower(username) = lower(btrim(name));
  if u is null then raise exception 'not_found' using errcode = 'P0002'; end if;
  if enable then
    if not public.old_enough(u) or not public.is_adult_user(u) then raise exception 'moderator_minor' using errcode = '42501'; end if;
    insert into public.moderators (user_id) values (u) on conflict do nothing;
  else delete from public.moderators where user_id = u; end if;
  return (select username from public.profiles where user_id = u);
end $$;
create or replace function public.admin_moderators()
returns table (user_id uuid, username text, added_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select m.user_id, p.username, m.added_at from public.moderators m left join public.profiles p on p.user_id = m.user_id order by m.added_at;
end $$;
revoke all on function public.admin_set_moderator(text, boolean), public.admin_moderators() from public;
grant execute on function public.admin_set_moderator(text, boolean), public.admin_moderators() to authenticated;

-- ---------------------------------------------------------------------------
-- Les fonctions et règles de modération passent de « administrateur » à « équipe » (administrateur + modérateurs)
-- ---------------------------------------------------------------------------

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
  if new.adult and not public.is_staff() and not public.is_adult_user(new.user_id) then
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
  elsif public.is_staff() and new.status is distinct from old.status then
    new.reviewed_at := now();
    if new.status <> 'rejected' then new.reject_reason := null; end if;
  elsif not public.is_staff() then
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

create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text, source_url text,
               tags text[], adult boolean, character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.source_url,
    f.tags, f.adult, f.character_id, f.anime_id, f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;

create or replace function public.admin_pending_fanarts() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() then (select count(*)::integer from public.fanarts where status = 'pending') else 0 end
$$;

create or replace function public.can_read_chat_image(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.chat_images c where c.path = p and (
    c.sender = (select auth.uid()) or (c.recipient = (select auth.uid()) and c.status = 'approved') or public.is_staff()))
$$;

create or replace function public.admin_chat_images(p_status text default 'pending')
returns table (id uuid, path text, status text, created_at timestamptz, sender uuid, sender_name text, sender_adult boolean,
               recipient uuid, recipient_name text, recipient_adult boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select c.id, c.path, c.status, c.created_at,
    c.sender, ps.username, public.is_adult_user(c.sender), c.recipient, pr.username, public.is_adult_user(c.recipient)
  from public.chat_images c left join public.profiles ps on ps.user_id = c.sender left join public.profiles pr on pr.user_id = c.recipient
  where c.status = p_status order by c.created_at limit 200;
end $$;
revoke all on function public.admin_chat_images(text) from public;
grant execute on function public.admin_chat_images(text) to authenticated;

create or replace function public.admin_pending_chat_images() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() then (select count(*)::integer from public.chat_images where status = 'pending') else 0 end
$$;

create or replace function public.admin_pending_chat_images() returns integer
language sql stable security definer set search_path = '' as $$
  select case when public.is_staff() then (select count(*)::integer from public.chat_images where status = 'pending') else 0 end
$$;

create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean, auto boolean, category text,
               comment_id uuid, fanart_id uuid, with_context boolean, urgent boolean,
               reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled, r.auto, r.category, r.comment_id, r.fanart_id, r.with_context, r.urgent,
    pr.username, case when public.is_admin() then ur.email::text end, r.target_user, pt.username, case when public.is_admin() then ut.email::text end
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.urgent desc, r.created_at desc;
end $$;

create or replace function public.my_counters()
returns table (messages bigint, friend_requests bigint, feedback_replies bigint, admin_feedback bigint, admin_reports bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.messages where recipient = (select auth.uid()) and read_at is null),
         (select count(*) from public.friendships where (select auth.uid()) in (user_a, user_b) and status = 'pending' and requested_by <> (select auth.uid())),
         (select count(*) from public.feedback where user_id = (select auth.uid()) and user_unread),
         case when public.is_admin() then (select count(*) from public.feedback where status = 'nouveau') else 0 end,
         case when public.is_staff() then (select count(*) from public.reports where not handled) else 0 end
$$;

drop policy if exists "signalements: admin" on public.reports;
create policy "signalements: admin" on public.reports for select to authenticated using (public.is_staff() or reporter = (select auth.uid()));

drop policy if exists "signalements: traitement" on public.reports;
create policy "signalements: traitement" on public.reports for update to authenticated using (public.is_staff()) with check (public.is_staff());

drop policy if exists "avis: suppression" on public.anime_comments;
create policy "avis: suppression" on public.anime_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

drop policy if exists "fanarts: lecture" on public.fanarts;
create policy "fanarts: lecture" on public.fanarts for select to authenticated
  using ((status = 'approved' and (not adult or public.can_see_adult())) or user_id = (select auth.uid()) or public.is_staff());

drop policy if exists "fanarts: modification" on public.fanarts;
create policy "fanarts: modification" on public.fanarts for update to authenticated
  using (user_id = (select auth.uid()) or public.is_staff()) with check (user_id = (select auth.uid()) or public.is_staff());

drop policy if exists "fanarts: suppression" on public.fanarts;
create policy "fanarts: suppression" on public.fanarts for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

drop policy if exists "fanarts: suppression du sien ou admin" on storage.objects;
create policy "fanarts: suppression du sien ou admin" on storage.objects for delete to authenticated
  using (bucket_id = 'fanarts' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff()));

drop policy if exists "images chat: lecture" on public.chat_images;
create policy "images chat: lecture" on public.chat_images for select to authenticated
  using (sender = (select auth.uid()) or recipient = (select auth.uid()) or public.is_staff());

drop policy if exists "images chat: vérification" on public.chat_images;
create policy "images chat: vérification" on public.chat_images for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "images chat: suppression" on public.chat_images;
create policy "images chat: suppression" on public.chat_images for delete to authenticated
  using (sender = (select auth.uid()) or public.is_staff());

drop policy if exists "images chat: fichier suppression" on storage.objects;
create policy "images chat: fichier suppression" on storage.objects for delete to authenticated
  using (bucket_id = 'chat-images' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff()));
