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
