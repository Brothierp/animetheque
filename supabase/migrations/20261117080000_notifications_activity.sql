-- Notifications (cloche) et fil d'activité des amis.
-- À exécuter après 20261117070000_ai_scores.sql. Peut être relancé sans risque.
--   • notifications créées par la base : demande d'ami reçue / acceptée, fan art validé ou refusé,
--     réponse à une suggestion, image d'une conversation validée ; lues par leur seul destinataire ;
--   • activité : visible seulement par les amis, et seulement si la personne l'a activée dans « Mon compte »
--     (désactivée par défaut) : titre terminé ou commencé, note de 4 ou 5 étoiles, coup de cœur, fan art publié, avis publié.

-- ---------------------------------------------------------------------------
-- 1. Notifications
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null,
  actor      uuid        references auth.users (id) on delete cascade,
  ref        text,
  created_at timestamptz not null default now(),
  read_at    timestamptz
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select, delete on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
drop policy if exists "notifications: les siennes" on public.notifications;
drop policy if exists "notifications: lues" on public.notifications;
drop policy if exists "notifications: suppression" on public.notifications;
create policy "notifications: les siennes" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications: lues" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notifications: suppression" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.notify(u uuid, k text, a uuid, r text) returns void
language sql security definer set search_path = '' as $$
  insert into public.notifications (user_id, kind, actor, ref) select u, k, a, r where u is not null;
  -- on ne garde que les 100 dernières notifications de chacun
  delete from public.notifications where user_id = u and id not in (select id from public.notifications where user_id = u order by id desc limit 100);
$$;
revoke all on function public.notify(uuid, text, uuid, text) from public;

create or replace function public.notify_friendship() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform public.notify(case when new.requested_by = new.user_a then new.user_b else new.user_a end, 'friend_request', new.requested_by, null);
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'accepted' then
    perform public.notify(new.requested_by, 'friend_accepted', case when new.requested_by = new.user_a then new.user_b else new.user_a end, null);
  end if;
  return new;
end $$;
drop trigger if exists friendships_notify on public.friendships;
create trigger friendships_notify after insert or update on public.friendships for each row execute function public.notify_friendship();

create or replace function public.notify_fanart() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status in ('approved', 'rejected') then
    perform public.notify(new.user_id, 'fanart_' || new.status, null, new.id::text);
  end if;
  return new;
end $$;
drop trigger if exists fanarts_notify on public.fanarts;
create trigger fanarts_notify after update on public.fanarts for each row execute function public.notify_fanart();

create or replace function public.notify_feedback_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.from_admin then perform public.notify((select user_id from public.feedback where id = new.feedback_id), 'feedback_reply', null, new.feedback_id::text); end if;
  return new;
end $$;
drop trigger if exists feedback_replies_notify on public.feedback_replies;
create trigger feedback_replies_notify after insert on public.feedback_replies for each row execute function public.notify_feedback_reply();

create or replace function public.notify_chat_image() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.status = 'pending' and new.status = 'approved' then perform public.notify(new.recipient, 'chat_image', new.sender, null); end if;
  return new;
end $$;
drop trigger if exists chat_images_notify on public.chat_images;
create trigger chat_images_notify after update on public.chat_images for each row execute function public.notify_chat_image();

-- ---------------------------------------------------------------------------
-- 2. Activité des amis (sur option)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists share_activity boolean not null default false;
grant update (share_activity) on public.profiles to authenticated;

create table if not exists public.activity (
  id         bigint      generated always as identity primary key,
  user_id    uuid        not null references auth.users (id) on delete cascade,
  kind       text        not null,
  anime_id   integer,
  ref        text,
  value      smallint,
  created_at timestamptz not null default now()
);
create index if not exists activity_user_idx on public.activity (user_id, created_at desc);
alter table public.activity enable row level security;
revoke all on public.activity from anon, authenticated;
grant select, delete on public.activity to authenticated;
drop policy if exists "activité: amis" on public.activity;
drop policy if exists "activité: suppression" on public.activity;
create policy "activité: amis" on public.activity for select to authenticated
  using (user_id = (select auth.uid()) or (public.is_friend((select auth.uid()), user_id) and not public.is_blocked((select auth.uid()), user_id)));
create policy "activité: suppression" on public.activity for delete to authenticated using (user_id = (select auth.uid()));

create or replace function public.log_activity(u uuid, k text, a integer, r text, v smallint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((select share_activity from public.profiles where user_id = u), false) then return; end if;
  -- pas de doublon : même action sur le même titre dans les 12 dernières heures
  delete from public.activity where user_id = u and kind = k and anime_id is not distinct from a and ref is not distinct from r and created_at > now() - interval '12 hours';
  insert into public.activity (user_id, kind, anime_id, ref, value) values (u, k, a, r, v);
  delete from public.activity where user_id = u and id not in (select id from public.activity where user_id = u order by id desc limit 200);
end $$;
revoke all on function public.log_activity(uuid, text, integer, text, smallint) from public;

create or replace function public.activity_collection() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from (case when tg_op = 'UPDATE' then old.status end) and new.status in ('watched', 'watching') then
    perform public.log_activity(new.user_id, 'status_' || new.status, new.anime_id, null, null);
  end if;
  if new.rating >= 4 and new.rating is distinct from (case when tg_op = 'UPDATE' then old.rating end) then
    perform public.log_activity(new.user_id, 'rating', new.anime_id, null, new.rating);
  end if;
  if new.favorite and not coalesce(case when tg_op = 'UPDATE' then old.favorite end, false) then
    perform public.log_activity(new.user_id, 'favorite', new.anime_id, null, null);
  end if;
  return new;
end $$;
drop trigger if exists collection_activity on public.collection_entries;
create trigger collection_activity after insert or update on public.collection_entries for each row execute function public.activity_collection();

create or replace function public.activity_fanart() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' and not new.adult then
    perform public.log_activity(new.user_id, 'fanart', new.anime_id, new.id::text, null);
  end if;
  return new;
end $$;
drop trigger if exists fanarts_activity on public.fanarts;
create trigger fanarts_activity after update on public.fanarts for each row execute function public.activity_fanart();

create or replace function public.activity_comment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.log_activity(new.user_id, 'comment', new.anime_id, new.id::text, null);
  return new;
end $$;
drop trigger if exists comments_activity on public.anime_comments;
create trigger comments_activity after insert on public.anime_comments for each row execute function public.activity_comment();

-- Fil d'activité des amis (50 dernières actions), avec le pseudo.
create or replace function public.friends_activity(p_limit integer default 50)
returns table (id bigint, user_id uuid, username text, kind text, anime_id integer, ref text, value smallint, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id, a.user_id, coalesce(p.username, 'Membre'), a.kind, a.anime_id, a.ref, a.value, a.created_at
  from public.activity a left join public.profiles p on p.user_id = a.user_id
  where a.user_id <> (select auth.uid()) and public.is_friend((select auth.uid()), a.user_id) and not public.is_blocked((select auth.uid()), a.user_id)
  order by a.created_at desc limit least(greatest(p_limit, 1), 100)
$$;
revoke all on function public.friends_activity(integer) from public;
grant execute on function public.friends_activity(integer) to authenticated;
