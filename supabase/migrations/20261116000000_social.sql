-- Social : suggestions (vers l'administrateur), amis, blocages, messagerie entre amis, listes partagées et
-- listes communes, signalements. À exécuter après les scripts précédents. Peut être relancé sans risque.
--
-- Règles de sécurité (toutes appliquées par la base, pas seulement par le site) :
--  • on n'ajoute un ami qu'avec son pseudo exact (pas d'annuaire) et il doit accepter ;
--  • messages uniquement entre amis, jamais avec quelqu'un qu'on a bloqué ou qui nous a bloqué ;
--  • protection des mineurs : amitiés seulement entre mineurs ou seulement entre majeurs
--    (année de naissance requise ; majeur = 19 ans dans l'année, comme pour le contenu 18+) ;
--  • l'administrateur ne lit jamais les conversations : un signalement conserve seulement le message signalé ;
--  • filtre de mots interdits sur les messages ; 20 messages par minute au plus.

-- ---------------------------------------------------------------------------
-- 0. Fonctions utilitaires
-- ---------------------------------------------------------------------------
create or replace function public.is_adult_user(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(year from now())::int - birth_year > 18 from public.profiles where user_id = u), false)
$$;
create or replace function public.has_birth_year(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where user_id = u and birth_year is not null)
$$;

-- ---------------------------------------------------------------------------
-- 1. Suggestions
-- ---------------------------------------------------------------------------
create table if not exists public.feedback (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text        not null default 'idee' check (kind in ('idee', 'bug', 'autre')),
  body        text        not null check (char_length(btrim(body)) between 3 and 2000),
  page        text        check (char_length(page) <= 200),
  status      text        not null default 'nouveau' check (status in ('nouveau', 'lu', 'repondu', 'clos')),
  user_unread boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists feedback_user_idx on public.feedback (user_id);
create table if not exists public.feedback_replies (
  id          uuid        primary key default gen_random_uuid(),
  feedback_id uuid        not null references public.feedback (id) on delete cascade,
  author_id   uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  from_admin  boolean     not null default false,
  body        text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at  timestamptz not null default now()
);
create index if not exists feedback_replies_fb_idx on public.feedback_replies (feedback_id);

alter table public.feedback enable row level security;
alter table public.feedback_replies enable row level security;
revoke all on public.feedback, public.feedback_replies from anon;
grant select, insert on public.feedback, public.feedback_replies to authenticated;
grant update (status) on public.feedback to authenticated;

drop policy if exists "feedback: lecture" on public.feedback;
drop policy if exists "feedback: envoi" on public.feedback;
drop policy if exists "feedback: statut (admin)" on public.feedback;
create policy "feedback: lecture" on public.feedback for select to authenticated
  using ((select auth.uid()) = user_id or public.is_admin());
create policy "feedback: envoi" on public.feedback for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "feedback: statut (admin)" on public.feedback for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "replies: lecture" on public.feedback_replies;
drop policy if exists "replies: envoi" on public.feedback_replies;
create policy "replies: lecture" on public.feedback_replies for select to authenticated
  using (public.is_admin() or exists (select 1 from public.feedback f where f.id = feedback_id and f.user_id = (select auth.uid())));
create policy "replies: envoi" on public.feedback_replies for insert to authenticated
  with check (author_id = (select auth.uid()) and (public.is_admin()
    or exists (select 1 from public.feedback f where f.id = feedback_id and f.user_id = (select auth.uid()) and f.status <> 'clos')));

-- 10 suggestions par jour au plus ; from_admin est calculé par la base (impossible à falsifier).
create or replace function public.feedback_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.feedback where user_id = new.user_id and created_at > now() - interval '1 day') >= 10 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  new.status := 'nouveau'; new.user_unread := false;
  return new;
end $$;
drop trigger if exists feedback_bi on public.feedback;
create trigger feedback_bi before insert on public.feedback for each row execute function public.feedback_before_insert();

create or replace function public.reply_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.from_admin := public.is_admin() and not exists (select 1 from public.feedback f where f.id = new.feedback_id and f.user_id = new.author_id);
  return new;
end $$;
create or replace function public.reply_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.from_admin then
    update public.feedback set status = 'repondu', user_unread = true, updated_at = now() where id = new.feedback_id;
  else
    update public.feedback set status = 'nouveau', updated_at = now() where id = new.feedback_id;
  end if;
  return new;
end $$;
drop trigger if exists replies_bi on public.feedback_replies;
drop trigger if exists replies_ai on public.feedback_replies;
create trigger replies_bi before insert on public.feedback_replies for each row execute function public.reply_before_insert();
create trigger replies_ai after insert on public.feedback_replies for each row execute function public.reply_after_insert();

-- Le membre marque comme lues les réponses à ses suggestions.
create or replace function public.mark_feedback_read() returns void
language sql security definer set search_path = '' as $$
  update public.feedback set user_unread = false where user_id = (select auth.uid()) and user_unread
$$;
revoke all on function public.mark_feedback_read() from public;
grant execute on function public.mark_feedback_read() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Amis et blocages
-- ---------------------------------------------------------------------------
create table if not exists public.friendships (
  user_a       uuid        not null references auth.users (id) on delete cascade,
  user_b       uuid        not null references auth.users (id) on delete cascade,
  requested_by uuid        not null references auth.users (id) on delete cascade,
  status       text        not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  primary key (user_a, user_b),
  check (user_a < user_b),
  check (requested_by in (user_a, user_b))
);
create index if not exists friendships_b_idx on public.friendships (user_b);
create table if not exists public.blocks (
  blocker    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  blocked    uuid        not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
revoke all on public.friendships, public.blocks from anon, authenticated;
grant select, delete on public.friendships to authenticated;          -- création et acceptation : fonctions ci-dessous
grant select, delete on public.blocks to authenticated;               -- création : block_user()

drop policy if exists "amis: lecture" on public.friendships;
drop policy if exists "amis: retrait" on public.friendships;
create policy "amis: lecture" on public.friendships for select to authenticated
  using ((select auth.uid()) in (user_a, user_b));
create policy "amis: retrait" on public.friendships for delete to authenticated
  using ((select auth.uid()) in (user_a, user_b));
drop policy if exists "blocages: lecture" on public.blocks;
drop policy if exists "blocages: retrait" on public.blocks;
create policy "blocages: lecture" on public.blocks for select to authenticated using ((select auth.uid()) = blocker);
create policy "blocages: retrait" on public.blocks for delete to authenticated using ((select auth.uid()) = blocker);

create or replace function public.is_friend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships where user_a = least(a, b) and user_b = greatest(a, b) and status = 'accepted')
$$;
create or replace function public.is_blocked(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.blocks where (blocker = a and blocked = b) or (blocker = b and blocked = a))
$$;
-- Protection des mineurs : même tranche d'âge requise, année de naissance connue des deux côtés.
create or replace function public.can_befriend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a <> b and public.has_birth_year(a) and public.has_birth_year(b)
     and public.is_adult_user(a) = public.is_adult_user(b) and not public.is_blocked(a, b)
$$;

-- Trouver un membre par son pseudo exact (sans tenir compte des majuscules). Renvoie aussi le statut de la relation.
drop function if exists public.find_member(text);
create or replace function public.find_member(name text)
returns table (user_id uuid, username text, avatar_path text, relation text, allowed boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path,
         coalesce((select case when f.status = 'accepted' then 'friend' when f.requested_by = (select auth.uid()) then 'sent' else 'received' end
                   from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))), 'none'),
         public.can_befriend((select auth.uid()), p.user_id)
  from public.profiles p
  where lower(p.username) = lower(btrim(name)) and p.user_id <> (select auth.uid())
    and not public.is_blocked((select auth.uid()), p.user_id)
  limit 1
$$;

create or replace function public.send_friend_request(target uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); f public.friendships;
begin
  if me is null then raise exception 'not_authenticated' using errcode = '42501'; end if;
  if not public.can_befriend(me, target) then raise exception 'not_allowed' using errcode = '42501'; end if;
  select * into f from public.friendships where user_a = least(me, target) and user_b = greatest(me, target);
  if found then
    if f.status = 'pending' and f.requested_by <> me then   -- il m'avait déjà invité : on accepte
      update public.friendships set status = 'accepted', accepted_at = now() where user_a = f.user_a and user_b = f.user_b;
      return 'accepted';
    end if;
    return f.status;
  end if;
  if (select count(*) from public.friendships where requested_by = me and status = 'pending' and created_at > now() - interval '1 day') >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into public.friendships (user_a, user_b, requested_by) values (least(me, target), greatest(me, target), me);
  return 'pending';
end $$;

create or replace function public.accept_friend(other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if not public.can_befriend(me, other) then raise exception 'not_allowed' using errcode = '42501'; end if;
  update public.friendships set status = 'accepted', accepted_at = now()
   where user_a = least(me, other) and user_b = greatest(me, other) and status = 'pending' and requested_by = other;
  if not found then raise exception 'no_request' using errcode = 'P0002'; end if;
end $$;

-- Bloquer : retire l'amitié, les listes communes partagées, et empêche tout contact.
create or replace function public.block_user(target uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or target = me then raise exception 'not_allowed' using errcode = '42501'; end if;
  insert into public.blocks (blocker, blocked) values (me, target) on conflict do nothing;
  delete from public.friendships where user_a = least(me, target) and user_b = greatest(me, target);
  delete from public.list_members m using public.lists l
   where m.list_id = l.id and ((l.user_id = me and m.user_id = target) or (l.user_id = target and m.user_id = me));
end $$;

-- Profils visibles : soi, ses amis, et les personnes avec une demande d'ami en cours (pseudo + avatar seulement).
drop function if exists public.member_profiles(uuid[]);
create or replace function public.member_profiles(ids uuid[])
returns table (user_id uuid, username text, avatar_path text)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path from public.profiles p
  where p.user_id = any(ids) and (p.user_id = (select auth.uid()) or exists (
    select 1 from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))))
$$;

revoke all on function public.is_friend(uuid, uuid), public.is_blocked(uuid, uuid), public.can_befriend(uuid, uuid),
  public.find_member(text), public.send_friend_request(uuid), public.accept_friend(uuid), public.block_user(uuid),
  public.member_profiles(uuid[]), public.is_adult_user(uuid), public.has_birth_year(uuid) from public;
grant execute on function public.find_member(text), public.send_friend_request(uuid), public.accept_friend(uuid),
  public.block_user(uuid), public.member_profiles(uuid[]), public.is_friend(uuid, uuid), public.is_blocked(uuid, uuid) to authenticated;

-- Les amis voient l'avatar l'un de l'autre.
create or replace function public.is_friend_folder(folder text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.friendships where status = 'accepted'
    and ((user_a = (select auth.uid()) and user_b::text = folder) or (user_b = (select auth.uid()) and user_a::text = folder)))
$$;
revoke all on function public.is_friend_folder(text) from public;
grant execute on function public.is_friend_folder(text) to authenticated;
drop policy if exists "avatars: lecture des amis" on storage.objects;
create policy "avatars: lecture des amis" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and public.is_friend_folder((storage.foldername(name))[1]));

-- ---------------------------------------------------------------------------
-- 3. Messages (entre amis uniquement)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id         bigint      generated always as identity primary key,
  sender     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  recipient  uuid        not null references auth.users (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  check (sender <> recipient)
);
create index if not exists messages_pair_idx on public.messages (least(sender, recipient), greatest(sender, recipient), created_at desc);
create index if not exists messages_unread_idx on public.messages (recipient) where read_at is null;
alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select, insert, delete on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;

drop policy if exists "messages: lecture" on public.messages;
drop policy if exists "messages: envoi" on public.messages;
drop policy if exists "messages: lu" on public.messages;
drop policy if exists "messages: suppression" on public.messages;
create policy "messages: lecture" on public.messages for select to authenticated
  using ((select auth.uid()) in (sender, recipient));
create policy "messages: envoi" on public.messages for insert to authenticated
  with check (sender = (select auth.uid()) and public.is_friend(sender, recipient) and not public.is_blocked(sender, recipient));
create policy "messages: lu" on public.messages for update to authenticated
  using (recipient = (select auth.uid())) with check (recipient = (select auth.uid()));
create policy "messages: suppression" on public.messages for delete to authenticated
  using (sender = (select auth.uid()));

drop trigger if exists messages_forbidden on public.messages;
create trigger messages_forbidden before insert on public.messages
  for each row execute function public.reject_forbidden('body');
create or replace function public.messages_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages where sender = new.sender and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists messages_rate on public.messages;
create trigger messages_rate before insert on public.messages for each row execute function public.messages_rate();

-- Messages en direct (Supabase Realtime), si la publication existe.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Listes partagées et listes communes
-- ---------------------------------------------------------------------------
alter table public.lists add column if not exists visibility text not null default 'private';
alter table public.lists drop constraint if exists lists_visibility_check;
alter table public.lists add constraint lists_visibility_check check (visibility in ('private', 'friends'));
alter table public.list_items add column if not exists added_by uuid default auth.uid() references auth.users (id) on delete set null;

create table if not exists public.list_members (
  list_id  uuid        not null references public.lists (id) on delete cascade,
  user_id  uuid        not null references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (list_id, user_id)
);
create index if not exists list_members_user_idx on public.list_members (user_id);
alter table public.list_members enable row level security;
revoke all on public.list_members from anon, authenticated;
grant select, insert, delete on public.list_members to authenticated;

create or replace function public.list_owner(lid uuid) returns uuid
language sql stable security definer set search_path = '' as $$ select user_id from public.lists where id = lid $$;
create or replace function public.list_member_count(lid uuid) returns integer
language sql stable security definer set search_path = '' as $$ select count(*)::integer from public.list_members where list_id = lid $$;
create or replace function public.can_edit_list(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lists l where l.id = lid and (l.user_id = (select auth.uid())
    or exists (select 1 from public.list_members m where m.list_id = lid and m.user_id = (select auth.uid()))))
$$;
create or replace function public.can_view_list(lid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.can_edit_list(lid) or exists (select 1 from public.lists l where l.id = lid and l.visibility = 'friends'
    and public.is_friend((select auth.uid()), l.user_id))
$$;
revoke all on function public.list_owner(uuid), public.can_edit_list(uuid), public.can_view_list(uuid), public.list_member_count(uuid) from public;
grant execute on function public.list_owner(uuid), public.can_edit_list(uuid), public.can_view_list(uuid), public.list_member_count(uuid) to authenticated;

drop policy if exists "lists: lecture de ses listes" on public.lists;
drop policy if exists "lists: lecture" on public.lists;
create policy "lists: lecture" on public.lists for select to authenticated
  using ((select auth.uid()) = user_id or public.can_view_list(id));
grant update (name, visibility) on public.lists to authenticated;

drop policy if exists "items: lecture de ses titres" on public.list_items;
drop policy if exists "items: ajout de ses titres" on public.list_items;
drop policy if exists "items: suppression de ses titres" on public.list_items;
drop policy if exists "items: lecture" on public.list_items;
drop policy if exists "items: ajout" on public.list_items;
drop policy if exists "items: suppression" on public.list_items;
create policy "items: lecture" on public.list_items for select to authenticated
  using ((select auth.uid()) = user_id or public.can_view_list(list_id));
-- user_id = propriétaire de la liste (garanti par la clé étrangère) ; ajout par le propriétaire ou un membre.
create policy "items: ajout" on public.list_items for insert to authenticated
  with check (public.can_edit_list(list_id) and user_id = public.list_owner(list_id));
create policy "items: suppression" on public.list_items for delete to authenticated
  using (public.can_edit_list(list_id));

drop policy if exists "membres: lecture" on public.list_members;
drop policy if exists "membres: ajout" on public.list_members;
drop policy if exists "membres: retrait" on public.list_members;
create policy "membres: lecture" on public.list_members for select to authenticated
  using (user_id = (select auth.uid()) or public.can_view_list(list_id));
-- Seul le propriétaire invite, et seulement ses amis (10 membres au plus).
create policy "membres: ajout" on public.list_members for insert to authenticated
  with check (public.list_owner(list_id) = (select auth.uid()) and public.is_friend((select auth.uid()), user_id)
    and public.list_member_count(list_id) < 10);
-- Le propriétaire retire un membre ; un membre peut quitter la liste.
create policy "membres: retrait" on public.list_members for delete to authenticated
  using (public.list_owner(list_id) = (select auth.uid()) or user_id = (select auth.uid()));

-- Retirer un ami retire aussi le partage des listes communes entre vous.
create or replace function public.friendship_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.list_members m using public.lists l
   where m.list_id = l.id and ((l.user_id = old.user_a and m.user_id = old.user_b) or (l.user_id = old.user_b and m.user_id = old.user_a));
  return old;
end $$;
drop trigger if exists friendships_ad on public.friendships;
create trigger friendships_ad after delete on public.friendships for each row execute function public.friendship_removed();

-- ---------------------------------------------------------------------------
-- 5. Signalements (l'administrateur ne voit que le message signalé)
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id          uuid        primary key default gen_random_uuid(),
  reporter    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  target_user uuid        references auth.users (id) on delete cascade,
  message_id  bigint,
  excerpt     text,
  reason      text        not null check (char_length(btrim(reason)) between 1 and 500),
  handled     boolean     not null default false,
  created_at  timestamptz not null default now()
);
alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant select, insert on public.reports to authenticated;
grant update (handled) on public.reports to authenticated;
drop policy if exists "signalements: envoi" on public.reports;
drop policy if exists "signalements: admin" on public.reports;
drop policy if exists "signalements: traitement" on public.reports;
create policy "signalements: envoi" on public.reports for insert to authenticated with check (reporter = (select auth.uid()));
create policy "signalements: admin" on public.reports for select to authenticated using (public.is_admin() or reporter = (select auth.uid()));
create policy "signalements: traitement" on public.reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Copie du message signalé (si on fait partie de la conversation) au moment du signalement.
create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages;
begin
  if new.message_id is not null then
    select * into m from public.messages where id = new.message_id and new.reporter in (sender, recipient);
    if found then new.excerpt := left(m.body, 2000); new.target_user := m.sender; else new.message_id := null; end if;
  end if;
  if new.target_user is null then raise exception 'no_target' using errcode = '22023'; end if;
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists reports_bi on public.reports;
create trigger reports_bi before insert on public.reports for each row execute function public.report_before_insert();

-- Signalements pour l'administrateur, avec les pseudos.
drop function if exists public.admin_reports();
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean,
               reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled,
    pr.username, ur.email::text, r.target_user, pt.username, ut.email::text
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.created_at desc;
end $$;
-- Suggestions pour l'administrateur, avec pseudo et e-mail de l'auteur.
create or replace function public.admin_feedback()
returns table (id uuid, kind text, body text, page text, status text, created_at timestamptz, updated_at timestamptz,
               user_id uuid, username text, email text, replies bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.kind, f.body, f.page, f.status, f.created_at, f.updated_at, f.user_id, p.username, u.email::text,
    (select count(*) from public.feedback_replies r where r.feedback_id = f.id)
  from public.feedback f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  order by (f.status = 'nouveau') desc, f.updated_at desc;
end $$;
revoke all on function public.admin_reports(), public.admin_feedback() from public;
grant execute on function public.admin_reports(), public.admin_feedback() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Compteurs pour les pastilles (une seule requête)
-- ---------------------------------------------------------------------------
create or replace function public.my_counters()
returns table (messages bigint, friend_requests bigint, feedback_replies bigint, admin_feedback bigint, admin_reports bigint)
language sql stable security definer set search_path = '' as $$
  select (select count(*) from public.messages where recipient = (select auth.uid()) and read_at is null),
         (select count(*) from public.friendships where (select auth.uid()) in (user_a, user_b) and status = 'pending' and requested_by <> (select auth.uid())),
         (select count(*) from public.feedback where user_id = (select auth.uid()) and user_unread),
         case when public.is_admin() then (select count(*) from public.feedback where status = 'nouveau') else 0 end,
         case when public.is_admin() then (select count(*) from public.reports where not handled) else 0 end
$$;
revoke all on function public.my_counters() from public;
grant execute on function public.my_counters() to authenticated;
