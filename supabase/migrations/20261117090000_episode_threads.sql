-- Discussions par épisode : un fil pour chaque épisode de chaque animé.
-- À exécuter après 20261117080000_notifications_activity.sql. Peut être relancé sans risque.
--   • lisibles par tous ; le site ne déverrouille un épisode que si tu l'as vu (compteur d'épisodes de ta
--     collection), pour éviter les spoilers ;
--   • écrire : membre de 15 ans et plus avec un pseudo ; français ou anglais ; filtre de mots interdits ;
--     30 messages par heure au plus ; réponse possible à un autre message ;
--   • signalement, suppression par l'auteur ou l'équipe de modération ; notification quand on te répond.

create table if not exists public.episode_posts (
  id         uuid        primary key default gen_random_uuid(),
  anime_id   integer     not null check (anime_id > 0),
  episode    smallint    not null check (episode between 1 and 5000),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  reply_to   uuid        references public.episode_posts (id) on delete set null,
  body       text        not null check (char_length(btrim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists episode_posts_idx on public.episode_posts (anime_id, episode, created_at);
alter table public.episode_posts enable row level security;
revoke all on public.episode_posts from anon, authenticated;
grant select on public.episode_posts to anon, authenticated;
grant insert, delete on public.episode_posts to authenticated;

drop policy if exists "épisodes: lecture" on public.episode_posts;
drop policy if exists "épisodes: écriture" on public.episode_posts;
drop policy if exists "épisodes: suppression" on public.episode_posts;
create policy "épisodes: lecture" on public.episode_posts for select to anon, authenticated using (true);
create policy "épisodes: écriture" on public.episode_posts for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.username is not null));
create policy "épisodes: suppression" on public.episode_posts for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

create or replace function public.episode_posts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not public.old_enough(new.user_id) then raise exception 'too_young' using errcode = '42501'; end if;
  if public.has_forbidden_word(new.body) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(new.body) is not null then raise exception 'language' using errcode = '23514'; end if;
  if (select count(*) from public.episode_posts where user_id = new.user_id and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  if new.reply_to is not null and not exists (select 1 from public.episode_posts r where r.id = new.reply_to and r.anime_id = new.anime_id and r.episode = new.episode) then
    new.reply_to := null;
  end if;
  new.created_at := now();
  return new;
end $$;
drop trigger if exists episode_posts_check on public.episode_posts;
create trigger episode_posts_check before insert on public.episode_posts for each row execute function public.episode_posts_check();

-- Quelqu'un te répond : notification (« Léa t'a répondu sur l'épisode 7 de … »).
create or replace function public.episode_posts_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare to_user uuid;
begin
  if new.reply_to is not null then
    select user_id into to_user from public.episode_posts where id = new.reply_to;
    if to_user is not null and to_user <> new.user_id and not public.is_blocked(to_user, new.user_id) then
      perform public.notify(to_user, 'episode_reply', new.user_id, new.anime_id || ':' || new.episode);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists episode_posts_notify on public.episode_posts;
create trigger episode_posts_notify after insert on public.episode_posts for each row execute function public.episode_posts_notify();

-- Messages d'un épisode, avec le pseudo (sans les membres bloqués).
create or replace function public.episode_thread(aid integer, ep integer)
returns table (id uuid, user_id uuid, username text, reply_to uuid, body text, created_at timestamptz, mine boolean)
language sql stable security definer set search_path = '' as $$
  select x.id, x.user_id, coalesce(p.username, 'Membre'), x.reply_to, x.body, x.created_at, x.user_id = (select auth.uid())
  from public.episode_posts x left join public.profiles p on p.user_id = x.user_id
  where x.anime_id = aid and x.episode = ep
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), x.user_id))
  order by x.created_at limit 500
$$;
-- Nombre de messages par épisode (pour la grille des épisodes).
create or replace function public.episode_counts(aid integer)
returns table (episode smallint, posts bigint, last_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select episode, count(*), max(created_at) from public.episode_posts where anime_id = aid group by episode
$$;
revoke all on function public.episode_thread(integer, integer), public.episode_counts(integer) from public;
grant execute on function public.episode_thread(integer, integer), public.episode_counts(integer) to anon, authenticated;

-- Signaler un message d'épisode.
alter table public.reports add column if not exists post_id uuid;
create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages; c public.anime_comments; f public.fanarts; ep public.episode_posts; ctx text;
begin
  -- détection automatique : insérée par la base, sans auteur (un membre ne peut pas s'en faire passer pour une)
  if new.auto and new.reporter is null then
    new.urgent := true;
    return new;
  end if;
  new.auto := false;
  if new.message_id is not null then
    select * into m from public.messages where id = new.message_id and new.reporter in (sender, recipient);
    if found then new.excerpt := left(m.body, 2000); new.target_user := m.sender; else new.message_id := null; end if;
  end if;
  if new.comment_id is not null then
    select * into c from public.anime_comments where id = new.comment_id;
    if found then new.excerpt := left(c.body, 2000); new.target_user := c.user_id; new.category := coalesce(new.category, 'avis'); else new.comment_id := null; end if;
  end if;
  if new.fanart_id is not null then
    select * into f from public.fanarts where id = new.fanart_id and status = 'approved';
    if found then new.excerpt := left(f.title || ' — ' || f.path, 2000); new.target_user := f.user_id; new.category := coalesce(new.category, 'fanart'); else new.fanart_id := null; end if;
  end if;
  if new.post_id is not null then
    select * into ep from public.episode_posts where id = new.post_id;
    if found then new.excerpt := left('Épisode ' || ep.episode || ' : ' || ep.body, 2000); new.target_user := ep.user_id; new.category := coalesce(new.category, 'discussion'); else new.post_id := null; end if;
  end if;
  if new.target_user is null or new.target_user = new.reporter then raise exception 'no_target' using errcode = '22023'; end if;
  new.category := left(new.category, 40);
  -- contexte : les 15 derniers messages entre la personne qui signale et la personne signalée
  if new.with_context then
    select string_agg(to_char(x.created_at at time zone 'Europe/Paris', 'DD/MM HH24:MI') || ' · ' || coalesce(p.username, 'Membre') || ' : ' || x.body, E'\n' order by x.created_at)
      into ctx
      from (select * from public.messages
             where (sender = new.reporter and recipient = new.target_user) or (sender = new.target_user and recipient = new.reporter)
             order by created_at desc limit 15) x
      left join public.profiles p on p.user_id = x.sender;
    if ctx is null then new.with_context := false;
    else new.excerpt := left(case when new.excerpt is not null then new.excerpt || E'\n\n— Conversation —\n' else '' end || ctx, 6000); end if;
  end if;
  new.urgent := public.is_mixed_age(new.reporter, new.target_user);
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Activité des amis : « a discuté de l'épisode 7 de … » (si le partage d'activité est activé).
create or replace function public.activity_episode_post() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.log_activity(new.user_id, 'episode_post', new.anime_id, new.episode::text, new.episode);
  return new;
end $$;
drop trigger if exists episode_posts_activity on public.episode_posts;
create trigger episode_posts_activity after insert on public.episode_posts for each row execute function public.activity_episode_post();
