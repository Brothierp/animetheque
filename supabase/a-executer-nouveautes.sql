-- Animéthèque : uniquement les NOUVEAUTÉS depuis la dernière mise à jour (discussions par épisode,
-- notifications sur le téléphone, profils et listes publics). Si tu as déjà lancé a-executer-communaute.sql
-- avant le 17 novembre au soir, lance seulement ce fichier. Peut être relancé sans risque.

-- ==================== 20261117090000_episode_threads.sql ====================
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

-- ==================== 20261117100000_push.sql ====================
-- Notifications sur le téléphone ou l'ordinateur (Web Push), même site fermé.
-- À exécuter après 20261117090000_episode_threads.sql. Peut être relancé sans risque.
-- Fonctionne avec la fonction Supabase « push » (supabase/functions/push/index.ts), à déployer une fois.
--   • chaque appareil qui accepte les notifications est enregistré (push_subscriptions) ;
--   • chaque notification (cloche) et chaque message privé déclenche un envoi sur les appareils du destinataire ;
--   • toutes les heures, la fonction vérifie les épisodes sortis et prévient les membres qui suivent la série ;
--   • les clés de chiffrement (VAPID) sont créées par la fonction elle-même et gardées dans un schéma privé,
--     jamais visible depuis le site.

-- Extensions Supabase : appels web depuis la base (pg_net) et tâches planifiées (pg_cron).
do $$ begin create extension if not exists pg_net; exception when others then raise notice 'pg_net indisponible : %', sqlerrm; end $$;
do $$ begin create extension if not exists pg_cron; exception when others then raise notice 'pg_cron indisponible : %', sqlerrm; end $$;

-- ---------------------------------------------------------------------------
-- 1. Configuration privée (adresse de la fonction, secret partagé, clés VAPID)
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.push_config (
  id          integer primary key default 1 check (id = 1),
  fn_url      text    not null,
  secret      text    not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  public_key  text,
  private_key text,
  subject     text    not null default 'https://animetheque.vercel.app/mentions-legales.html'
);
insert into private.push_config (fn_url) values ('https://glohxfprxscfjcelyube.supabase.co/functions/v1/push') on conflict (id) do nothing;

create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$ select public_key from private.push_config where id = 1 $$;
revoke all on function public.push_public_key() from public;
grant execute on function public.push_public_key() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Appareils abonnés
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint   text        not null unique check (endpoint ~ '^https://'),
  p256dh     text        not null,
  auth       text        not null,
  device     text        check (char_length(device) <= 120),
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
drop policy if exists "push: les siens" on public.push_subscriptions;
create policy "push: les siens" on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- 10 appareils au plus par compte (les plus anciens sont retirés)
create or replace function public.push_subscriptions_limit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.push_subscriptions where user_id = new.user_id and id not in (
    select id from public.push_subscriptions where user_id = new.user_id order by created_at desc limit 9);
  return new;
end $$;
drop trigger if exists push_subscriptions_limit on public.push_subscriptions;
create trigger push_subscriptions_limit before insert on public.push_subscriptions for each row execute function public.push_subscriptions_limit();

-- ---------------------------------------------------------------------------
-- 3. Envoi : la base appelle la fonction « push » (si pg_net est disponible)
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists title text;

create or replace function public.push_dispatch(payload jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c private.push_config;
begin
  if to_regproc('net.http_post') is null then return; end if;
  select * into c from private.push_config where id = 1;
  if c is null or c.public_key is null then return; end if;           -- fonction pas encore déployée / initialisée
  execute 'select net.http_post(url := $1, body := $2, headers := $3, timeout_milliseconds := 5000)'
    using c.fn_url, payload, jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret);
exception when others then
  raise notice 'push_dispatch : %', sqlerrm;                          -- un envoi raté ne bloque jamais l'action du membre
end $$;
revoke all on function public.push_dispatch(jsonb) from public;

create or replace function public.notifications_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.user_id) then
    perform public.push_dispatch(jsonb_build_object('notification_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists notifications_push on public.notifications;
create trigger notifications_push after insert on public.notifications for each row execute function public.notifications_push();

-- Messages privés : un envoi au plus toutes les 2 minutes par conversation (pas de rafale).
create or replace function public.messages_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.push_subscriptions where user_id = new.recipient)
     and not exists (select 1 from public.messages m where m.sender = new.sender and m.recipient = new.recipient
                     and m.id <> new.id and m.created_at > now() - interval '2 minutes' and m.read_at is null) then
    perform public.push_dispatch(jsonb_build_object('message_id', new.id));
  end if;
  return new;
end $$;
drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert on public.messages for each row execute function public.messages_push();

-- Notification de test (bouton « Tester » dans Mon compte).
create or replace function public.push_test() returns void
language sql security definer set search_path = '' as $$
  select public.notify((select auth.uid()), 'test', null, null)
$$;
revoke all on function public.push_test() from public;
grant execute on function public.push_test() to authenticated;

-- Nouveaux épisodes : la fonction lit les séries « En cours » des membres abonnés et crée les notifications.
create or replace function public.push_watchers(ids integer[])
returns table (user_id uuid, anime_id integer)
language sql stable security definer set search_path = '' as $$
  select distinct c.user_id, c.anime_id from public.collection_entries c
  where c.status = 'watching' and c.anime_id = any(ids)
    and exists (select 1 from public.push_subscriptions s where s.user_id = c.user_id)
$$;
revoke all on function public.push_watchers(integer[]) from public, anon, authenticated;

-- Toutes les heures (à la 7e minute) : vérification des épisodes sortis.
do $$ begin
  if to_regproc('cron.schedule') is not null and to_regproc('net.http_post') is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = 'animetheque-episodes';
    perform cron.schedule('animetheque-episodes', '7 * * * *', 'select public.push_dispatch(''{"episodes": true}''::jsonb)');
  end if;
exception when others then raise notice 'tâche planifiée non créée : %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Accès de la fonction « push » (clé service uniquement, jamais le site)
-- ---------------------------------------------------------------------------
create or replace function public.push_config_get()
returns table (secret text, public_key text, private_key text, subject text)
language sql stable security definer set search_path = '' as $$
  select secret, public_key, private_key, subject from private.push_config where id = 1
$$;
create or replace function public.push_config_set_keys(pub text, priv text) returns void
language sql security definer set search_path = '' as $$
  update private.push_config set public_key = pub, private_key = priv where id = 1 and public_key is null
$$;
revoke all on function public.push_config_get(), public.push_config_set_keys(text, text) from public, anon, authenticated;
grant execute on function public.push_config_get(), public.push_config_set_keys(text, text), public.push_watchers(integer[]) to service_role;

-- ==================== 20261117110000_public_profiles.sql ====================
-- Profils publics et listes publiques, partageables par lien (avec aperçu sur Discord, WhatsApp, Instagram…).
-- À exécuter après 20261117100000_push.sql. Peut être relancé sans risque.
--   • désactivé par défaut ; réservé aux membres majeurs (protection des mineurs) ;
--   • un profil public montre : pseudo, date d'inscription, nombre de titres, coups de cœur, titres notés 5 ★,
--     listes publiques. Jamais l'e-mail, l'âge, l'avatar, les avis privés ni le reste de la collection ;
--   • une liste publique est visible par toute personne qui a le lien.

alter table public.profiles add column if not exists public_profile boolean not null default false;
grant update (public_profile) on public.profiles to authenticated;

alter table public.lists drop constraint if exists lists_visibility_check;
alter table public.lists add constraint lists_visibility_check check (visibility in ('private', 'friends', 'public'));

-- Seuls les majeurs peuvent rendre public leur profil ou une liste.
create or replace function public.public_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'profiles' then
    if new.public_profile and not coalesce(old.public_profile, false) and not public.is_adult_user(new.user_id) then
      raise exception 'public_minor' using errcode = '42501';
    end if;
  elsif new.visibility = 'public' and (tg_op = 'INSERT' or old.visibility is distinct from 'public') and not public.is_adult_user(new.user_id) then
    raise exception 'public_minor' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists profiles_public_guard on public.profiles;
create trigger profiles_public_guard before insert or update of public_profile on public.profiles for each row execute function public.public_guard();
drop trigger if exists lists_public_guard on public.lists;
create trigger lists_public_guard before insert or update of visibility on public.lists for each row execute function public.public_guard();

-- Profil public (null s'il n'est pas public).
create or replace function public.public_profile(name text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'username', p.username,
    'since', (select created_at from auth.users where id = p.user_id),
    'counts', (select jsonb_build_object(
        'watched', count(*) filter (where status = 'watched'), 'watching', count(*) filter (where status = 'watching'),
        'plan', count(*) filter (where status = 'plan'), 'favorites', count(*) filter (where favorite), 'rated', count(*) filter (where rating is not null))
      from public.collection_entries where user_id = p.user_id),
    'favorites', coalesce((select jsonb_agg(anime_id order by updated_at desc) from (
        select anime_id, updated_at from public.collection_entries where user_id = p.user_id and favorite order by updated_at desc limit 60) f), '[]'),
    'top_rated', coalesce((select jsonb_agg(anime_id order by updated_at desc) from (
        select anime_id, updated_at from public.collection_entries where user_id = p.user_id and rating = 5 order by updated_at desc limit 60) t), '[]'),
    'watching', coalesce((select jsonb_agg(anime_id order by updated_at desc) from (
        select anime_id, updated_at from public.collection_entries where user_id = p.user_id and status = 'watching' order by updated_at desc limit 30) w), '[]'),
    'lists', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name,
        'count', (select count(*) from public.list_items i where i.list_id = l.id)) order by l.created_at)
      from public.lists l where l.user_id = p.user_id and l.visibility = 'public'), '[]'))
  from public.profiles p
  where lower(p.username) = lower(btrim(name)) and p.public_profile and public.is_adult_user(p.user_id)
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), p.user_id))
$$;

-- Liste publique (null si elle n'est pas publique).
create or replace function public.public_list(lid uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', l.id, 'name', l.name, 'owner', p.username, 'owner_public', p.public_profile,
    'items', coalesce((select jsonb_agg(i.anime_id order by i.added_at desc) from public.list_items i where i.list_id = l.id), '[]'))
  from public.lists l join public.profiles p on p.user_id = l.user_id
  where l.id = lid and l.visibility = 'public' and public.is_adult_user(l.user_id)
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), l.user_id))
$$;
revoke all on function public.public_profile(text), public.public_list(uuid) from public;
grant execute on function public.public_profile(text), public.public_list(uuid) to anon, authenticated;
