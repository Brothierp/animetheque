-- Animéthèque : mise à jour complète « communauté » (amis, messagerie, avis, fan arts, protection des mineurs, modération, notifications, discussions par épisode, notifications sur l'appareil, profils publics).
-- Copie TOUT ce fichier dans Supabase → SQL Editor → New query, puis clique Run. Peut être relancé sans risque.

-- ==================== 20261112000000_progress_fav_characters.sql ====================
-- Suivi des épisodes vus et personnages favoris.
-- À exécuter après les scripts précédents. Peut être relancé sans risque.
-- Le site fonctionne sans ce script : ces deux fonctions s'activent dès qu'il a été lancé.

-- 1. Nombre d'épisodes vus pour chaque titre de la collection.
alter table public.collection_entries add column if not exists progress smallint;
alter table public.collection_entries drop constraint if exists collection_entries_progress_check;
alter table public.collection_entries add constraint collection_entries_progress_check check (progress is null or progress between 0 and 5000);

-- 2. Personnages favoris (identifiant AniList du personnage).
create table if not exists public.favorite_characters (
  user_id      uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  character_id integer     not null check (character_id > 0),
  created_at   timestamptz not null default now(),
  primary key (user_id, character_id)
);
alter table public.favorite_characters enable row level security;
revoke all on public.favorite_characters from anon;
grant select, insert, delete on public.favorite_characters to authenticated;

drop policy if exists "favchars: lecture des siens" on public.favorite_characters;
drop policy if exists "favchars: ajout des siens" on public.favorite_characters;
drop policy if exists "favchars: suppression des siens" on public.favorite_characters;
create policy "favchars: lecture des siens" on public.favorite_characters
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "favchars: ajout des siens" on public.favorite_characters
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "favchars: suppression des siens" on public.favorite_characters
  for delete to authenticated using ((select auth.uid()) = user_id);

-- 3000 favoris maximum par personne.
create or replace function public.enforce_favchar_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.favorite_characters where user_id = new.user_id) >= 3000 then
    raise exception 'favchar_limit_reached' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists favchars_limit on public.favorite_characters;
create trigger favchars_limit before insert on public.favorite_characters
  for each row execute function public.enforce_favchar_limit();

-- ==================== 20261116000000_social.sql ====================
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

-- ==================== 20261116010000_safety_comments.sql ====================
-- Protection des mineurs dans la messagerie, et avis des membres sous chaque animé.
-- À exécuter après 20261116000000_social.sql. Peut être relancé sans risque.
--
-- 1. Les mineurs peuvent devenir amis avec des majeurs (message de prévention côté site).
--    Les conversations entre un majeur et un mineur sont analysées automatiquement par la base :
--      • coordonnées et liens bloqués (téléphone, e-mail, réseaux sociaux, adresses web) ;
--      • messages à risque (secret, photos, rendez-vous, questions intimes…) signalés à l'administrateur,
--        qui ne voit que le message concerné.
--    La messagerie n'accepte que du texte : aucune photo ni fichier.
-- 2. Avis publics sous chaque animé : un par membre et par animé, modifiable ; en français ou en anglais
--    (japonais toléré pour citer un titre) ; filtre de mots interdits ; signalement ; suppression par l'admin.

-- ---------------------------------------------------------------------------
-- 1. Amitiés mineurs / majeurs
-- ---------------------------------------------------------------------------
create or replace function public.can_befriend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a <> b and public.has_birth_year(a) and public.has_birth_year(b) and not public.is_blocked(a, b)
$$;
create or replace function public.is_mixed_age(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_adult_user(a) <> public.is_adult_user(b)
$$;
revoke all on function public.is_mixed_age(uuid, uuid) from public;
grant execute on function public.is_mixed_age(uuid, uuid) to authenticated;

-- find_member et member_profiles indiquent si la relation est entre un majeur et un mineur (pour la prévention).
drop function if exists public.find_member(text);
create or replace function public.find_member(name text)
returns table (user_id uuid, username text, avatar_path text, relation text, allowed boolean, mixed boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path,
         coalesce((select case when f.status = 'accepted' then 'friend' when f.requested_by = (select auth.uid()) then 'sent' else 'received' end
                   from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))), 'none'),
         public.can_befriend((select auth.uid()), p.user_id),
         public.is_mixed_age((select auth.uid()), p.user_id)
  from public.profiles p
  where lower(p.username) = lower(btrim(name)) and p.user_id <> (select auth.uid())
    and not public.is_blocked((select auth.uid()), p.user_id)
  limit 1
$$;
drop function if exists public.member_profiles(uuid[]);
create or replace function public.member_profiles(ids uuid[])
returns table (user_id uuid, username text, avatar_path text, mixed boolean)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.username, p.avatar_path, public.is_mixed_age((select auth.uid()), p.user_id) from public.profiles p
  where p.user_id = any(ids) and (p.user_id = (select auth.uid()) or exists (
    select 1 from public.friendships f where f.user_a = least(p.user_id, (select auth.uid())) and f.user_b = greatest(p.user_id, (select auth.uid()))))
$$;
revoke all on function public.find_member(text), public.member_profiles(uuid[]) from public;
grant execute on function public.find_member(text), public.member_profiles(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Signalements : automatiques (sans auteur) et sur les avis
-- ---------------------------------------------------------------------------
alter table public.reports alter column reporter drop not null;
alter table public.reports add column if not exists auto boolean not null default false;
alter table public.reports add column if not exists comment_id uuid;
alter table public.reports add column if not exists category text;

-- ---------------------------------------------------------------------------
-- 3. Analyse des messages entre un majeur et un mineur
-- ---------------------------------------------------------------------------
-- Texte normalisé pour la détection : minuscules, sans accents, « leet » remplacé.
create or replace function public.safety_text(t text) returns text
language sql immutable set search_path = '' as $$
  select ' ' || regexp_replace(public.normalize_text(t), '[^a-z0-9@.:/]+', ' ', 'g') || ' '
$$;

create or replace function public.messages_safety() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- les fiches partagées du site ([[anime:12]], [[perso:34]], [[fanart:<id>]]) ne comptent pas
  b text := regexp_replace(coalesce(new.body, ''), '\[\[(anime|perso|fanart|image):[0-9a-f-]{1,36}\]\]', ' ', 'g');
  raw text := lower(b);
  t text := public.safety_text(b);
  digits text := regexp_replace(b, '[^0-9]', '', 'g');
  cat text := null;
begin
  if not public.is_mixed_age(new.sender, new.recipient) then return new; end if;

  -- a) Coordonnées et liens : bloqués
  if raw ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|be|ch|ca)(\W|$))'
     or raw ~ '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
     or length(digits) >= 8
     or t ~ ' (snap|snapchat|insta|instagram|whatsapp|whats app|wa me|discord|telegram|tiktok|signal|messenger|kik|skype|facetime|numero|num tel|telephone|mon tel|ton tel|adresse|address|phone number|my number|your number) ' then
    raise exception 'contact_blocked' using errcode = 'P0001',
      hint = 'Entre majeurs et mineurs, les coordonnées et les liens ne peuvent pas être échangés.';
  end if;

  -- b) Messages à risque : envoyés, mais signalés automatiquement à l'administrateur
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
drop trigger if exists messages_safety on public.messages;
create trigger messages_safety before insert on public.messages for each row execute function public.messages_safety();

-- Le message à risque est enregistré avant d'être inséré : on rattache ensuite le signalement à son id.
create or replace function public.messages_safety_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.reports set message_id = new.id
   where auto and message_id is null and target_user = new.sender and excerpt = left(new.body, 2000) and created_at > now() - interval '1 minute';
  return new;
end $$;
drop trigger if exists messages_safety_link on public.messages;
create trigger messages_safety_link after insert on public.messages for each row execute function public.messages_safety_link();

-- ---------------------------------------------------------------------------
-- 4. Langues autorisées (avis) : français et anglais ; japonais toléré pour un titre
-- ---------------------------------------------------------------------------
create or replace function public.language_problem(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  letters int; jp int; other int; w text[]; fe int := 0; ot int := 0; x text;
  FE_WORDS text[] := array['le','la','les','un','une','des','du','de','et','est','pas','que','qui','je','tu','il','elle','on','nous','vous','ce','cet','cette','mais','tres','bien','pour','avec','sur','dans','mon','ton','son','ma','plus','moins','trop','vraiment','tout','fin','serie','the','and','is','it','this','that','was','very','but','not','with','for','of','to','in','my','i','you','he','she','we','they','so','really','good','great','bad','anime','story','show','are','be','have','has','its','es','non','die','a','o'];
  OT_WORDS text[] := array['el','los','las','una','unos','unas','muy','pero','porque','mas','esta','este','tambien','gracias','hola','para','como','del','al','lo','mi','tu','bueno','buena','bonita','bonito','hermosa','hermoso','todo','nada','gusta','encanta','mucho','mucha','tengo','tiene','favorita','favorito','ilustracion','dibujo',
    'der','die','das','und','ist','nicht','ein','eine','sehr','aber','auch','ich','mit','gut','schon','wirklich','mein','dein','danke','zeichnung',
    'gli','che','non','sono','molto','della','anche','perche','bella','bello','grazie','ciao','questo','questa',
    'os','uma','muito','nao','voce','com','isso','obrigado','obrigada','lindo','linda','legal',
    'het','een','niet','ik','zijn','dat','och','att','jag','inte','det','som'];
begin
  letters := length(regexp_replace(coalesce(t, ''), '[[:space:][:punct:][:digit:]]', '', 'g'));
  if letters = 0 then return null; end if;
  -- alphabets non latins (hors japonais) : refusés
  other := length(regexp_replace(t, '[^Ѐ-ӿͰ-Ͽ؀-ۿݐ-ݿ֐-׿ऀ-ॿ฀-๿가-힯ᄀ-ᇿ]', '', 'g'));
  if other > 0 then return 'language'; end if;
  -- japonais (kana, kanji) : toléré pour citer un titre, pas pour tout l'avis
  jp := length(regexp_replace(t, '[^぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]', '', 'g'));
  if jp > 30 or jp::numeric / letters > 0.35 then return 'language'; end if;
  -- autres langues à alphabet latin : petits mots courants (espagnol, allemand, italien, portugais…)
  w := regexp_split_to_array(lower(translate(t, 'àâäéèêëîïôöùûüçñãõáíóú', 'aaaeeeeiioouuucnaoaiou')), '[^a-z]+');
  foreach x in array w loop
    if x = any(FE_WORDS) then fe := fe + 1; end if;
    if x = any(OT_WORDS) and not (x = any(FE_WORDS)) then ot := ot + 1; end if;
  end loop;
  if ot >= 3 and ot >= fe then return 'language'; end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Avis sous chaque animé
-- ---------------------------------------------------------------------------
create table if not exists public.anime_comments (
  id         uuid        primary key default gen_random_uuid(),
  anime_id   integer     not null check (anime_id > 0),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  body       text        not null check (char_length(btrim(body)) between 2 and 1500),
  spoiler    boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (anime_id, user_id)
);
create index if not exists anime_comments_anime_idx on public.anime_comments (anime_id, created_at desc);
alter table public.anime_comments enable row level security;
revoke all on public.anime_comments from anon, authenticated;
grant select on public.anime_comments to anon, authenticated;
grant insert, delete on public.anime_comments to authenticated;
grant update (body, spoiler) on public.anime_comments to authenticated;

drop policy if exists "avis: lecture" on public.anime_comments;
drop policy if exists "avis: écriture" on public.anime_comments;
drop policy if exists "avis: modification" on public.anime_comments;
drop policy if exists "avis: suppression" on public.anime_comments;
create policy "avis: lecture" on public.anime_comments for select to anon, authenticated using (true);
-- Pseudo requis pour publier un avis.
create policy "avis: écriture" on public.anime_comments for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.username is not null));
create policy "avis: modification" on public.anime_comments for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "avis: suppression" on public.anime_comments for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

create or replace function public.comments_check() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if public.has_forbidden_word(new.body) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(new.body) is not null then
    raise exception 'language' using errcode = '23514', hint = 'Les avis s''écrivent en français ou en anglais.';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.anime_comments where user_id = new.user_id and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists comments_check on public.anime_comments;
create trigger comments_check before insert or update on public.anime_comments for each row execute function public.comments_check();

-- Avis d'un animé avec le pseudo de leur auteur (lisible par tous, même sans compte).
create or replace function public.anime_comments_list(aid integer)
returns table (id uuid, body text, spoiler boolean, created_at timestamptz, updated_at timestamptz, user_id uuid, username text, mine boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.spoiler, c.created_at, c.updated_at, c.user_id, coalesce(p.username, 'Membre'), c.user_id = (select auth.uid())
  from public.anime_comments c left join public.profiles p on p.user_id = c.user_id
  where c.anime_id = aid
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), c.user_id))
  order by (c.user_id = (select auth.uid())) desc, c.created_at desc
  limit 200
$$;
revoke all on function public.anime_comments_list(integer) from public;
grant execute on function public.anime_comments_list(integer) to anon, authenticated;

-- Signaler un avis : copie du texte pour l'administrateur.
create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages; c public.anime_comments;
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
  if new.target_user is null then raise exception 'no_target' using errcode = '22023'; end if;
  if (select count(*) from public.reports where reporter = new.reporter and created_at > now() - interval '1 day') >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Signalements pour l'administrateur (avec détections automatiques et avis).
drop function if exists public.admin_reports();
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean, auto boolean, category text,
               comment_id uuid, reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled, r.auto, r.category, r.comment_id,
    pr.username, ur.email::text, r.target_user, pt.username, ut.email::text
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.created_at desc;
end $$;
revoke all on function public.admin_reports() from public;
grant execute on function public.admin_reports() to authenticated;

-- La langue est aussi vérifiée dans les messages privés et les suggestions.
create or replace function public.language_check() returns trigger
language plpgsql set search_path = '' as $$
begin
  if public.language_problem(new.body) is not null then
    raise exception 'language' using errcode = '23514', hint = 'Seuls le français et l''anglais sont acceptés.';
  end if;
  return new;
end $$;
drop trigger if exists messages_language on public.messages;
create trigger messages_language before insert on public.messages for each row execute function public.language_check();
drop trigger if exists feedback_language on public.feedback;
create trigger feedback_language before insert or update of body on public.feedback for each row execute function public.language_check();
drop trigger if exists feedback_replies_language on public.feedback_replies;
create trigger feedback_replies_language before insert on public.feedback_replies for each row execute function public.language_check();

-- ==================== 20261116020000_fanarts.sql ====================
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
drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer);
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
drop function if exists public.admin_fanarts(text);
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

-- ==================== 20261117000000_fanart_credit.sql ====================
-- Crédit de l'artiste sur les fan arts, et pseudos décorés acceptés (ex. « ˚˖𓍢ִ໋❀𝓜𝓪𝓴𝓸𝓽𝓸 »).
-- À exécuter après 20261116020000_fanarts.sql. Peut être relancé sans risque.
--   • les lettres « stylisées » (𝓜𝓪𝓴𝓸𝓽𝓸, ｍａｋｏｔｏ…) sont ramenées à des lettres normales avant les contrôles,
--     ce qui évite aussi de contourner le filtre de mots interdits avec ces caractères ;
--   • le contrôle de langue ignore les symboles et signes décoratifs : seul un vrai mot dans un autre alphabet
--     (au moins 3 lettres) est refusé ;
--   • nouveau champ « Artiste » sur les fan arts : nom libre (symboles acceptés), sans lien ni mot interdit.

-- 1. Normalisation : lettres stylisées → lettres normales (NFKC), puis minuscules, accents et « leet ».
create or replace function public.normalize_text(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(lower(normalize(coalesce(t, ''), NFKC)),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ013457@$!|',
      'aaaaaaceeeeiiiinooooouuuuyyoaoieastasii'),
    '(.)\1{2,}', '\1\1', 'g')
$$;

-- 2. Langues : on ne compte que les lettres, et il faut un vrai mot (3 lettres ou plus) dans un alphabet refusé.
create or replace function public.language_problem(t text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  s text := normalize(coalesce(t, ''), NFKC);
  letters int; jp int; other int; w text[]; fe int := 0; ot int := 0; x text;
  FE_WORDS text[] := array['le','la','les','un','une','des','du','de','et','est','pas','que','qui','je','tu','il','elle','on','nous','vous','ce','cet','cette','mais','tres','bien','pour','avec','sur','dans','mon','ton','son','ma','plus','moins','trop','vraiment','tout','fin','serie','the','and','is','it','this','that','was','very','but','not','with','for','of','to','in','my','i','you','he','she','we','they','so','really','good','great','bad','anime','story','show','are','be','have','has','its','es','non','die','a','o'];
  OT_WORDS text[] := array['el','los','las','una','unos','unas','muy','pero','porque','mas','esta','este','tambien','gracias','hola','para','como','del','al','lo','mi','tu','bueno','buena','bonita','bonito','hermosa','hermoso','todo','nada','gusta','encanta','mucho','mucha','tengo','tiene','favorita','favorito','ilustracion','dibujo',
    'der','die','das','und','ist','nicht','ein','eine','sehr','aber','auch','ich','mit','gut','schon','wirklich','mein','dein','danke','zeichnung',
    'gli','che','non','sono','molto','della','anche','perche','bella','bello','grazie','ciao','questo','questa',
    'os','uma','muito','nao','voce','com','isso','obrigado','obrigada','lindo','linda','legal',
    'het','een','niet','ik','zijn','dat','och','att','jag','inte','det','som'];
begin
  letters := length(regexp_replace(s, '[[:space:][:punct:][:digit:]]', '', 'g'));
  if letters = 0 then return null; end if;
  -- lettres d'alphabets refusés (cyrillique, grec, arabe, hébreu, devanagari, thaï, coréen) ; les signes diacritiques isolés ne comptent pas
  other := length(regexp_replace(s, '[^А-яЁёΑ-Ωα-ωء-يא-תक-हก-ฮ가-힯]', '', 'g'));
  if other >= 3 then return 'language'; end if;
  -- japonais (kana, kanji) : toléré pour citer un titre, pas pour tout le texte
  jp := length(regexp_replace(s, '[^぀-ゟ゠-ヿ一-鿿ｦ-ﾟ]', '', 'g'));
  if jp > 30 or (jp > 6 and jp::numeric / letters > 0.35) then return 'language'; end if;
  -- autres langues à alphabet latin : petits mots courants (espagnol, allemand, italien, portugais…)
  w := regexp_split_to_array(lower(translate(s, 'àâäéèêëîïôöùûüçñãõáíóú', 'aaaeeeeiioouuucnaoaiou')), '[^a-z]+');
  foreach x in array w loop
    if x = any(FE_WORDS) then fe := fe + 1; end if;
    if x = any(OT_WORDS) and not (x = any(FE_WORDS)) then ot := ot + 1; end if;
  end loop;
  if ot >= 3 and ot >= fe then return 'language'; end if;
  return null;
end $$;

-- 3. Crédit de l'artiste
alter table public.fanarts add column if not exists credit text;
alter table public.fanarts drop constraint if exists fanarts_credit_check;
alter table public.fanarts add constraint fanarts_credit_check check (credit is null or char_length(btrim(credit)) between 1 and 80);
grant update (credit) on public.fanarts to authenticated;

create or replace function public.fanarts_check() returns trigger
language plpgsql security definer set search_path = '' as $$
declare txt text := coalesce(new.title, '') || ' ' || coalesce(new.description, '');
begin
  new.credit := nullif(btrim(new.credit), '');
  if public.has_forbidden_word(txt || ' ' || coalesce(new.credit, '')) then raise exception 'forbidden_word' using errcode = '23514'; end if;
  if public.language_problem(txt) is not null then raise exception 'language' using errcode = '23514'; end if;
  if lower(normalize(coalesce(new.credit, ''), NFKC)) ~ '(https?://|www\.|\.(com|fr|net|org|io|gg|me|ly|art)(\W|$)|@[a-z0-9_.]+\.[a-z]{2,})' then
    raise exception 'credit_link' using errcode = '23514';
  end if;
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
    new.status := case when (new.title, new.description, new.credit) is distinct from (old.title, old.description, old.credit) then 'pending' else old.status end;
    new.reject_reason := case when new.status = 'pending' then null else old.reject_reason end;
  end if;
  return new;
end $$;

drop function if exists public.fanarts_list(text, integer, integer, uuid, uuid[], integer, integer);
create or replace function public.fanarts_list(
  p_sort text default 'recent', p_character integer default null, p_anime integer default null,
  p_user uuid default null, p_ids uuid[] default null, p_limit integer default 48, p_offset integer default 0)
returns table (id uuid, user_id uuid, username text, path text, width integer, height integer, title text, description text, credit text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz, likes bigint, liked boolean, mine boolean)
language sql stable security definer set search_path = '' as $$
  select f.id, f.user_id, coalesce(p.username, 'Membre'), f.path, f.width, f.height, f.title, f.description, f.credit, f.character_id, f.anime_id,
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

drop function if exists public.admin_fanarts(text);
create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text,
               character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.character_id, f.anime_id,
    f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;

-- ==================== 20261117010000_fanart_source.sql ====================
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

-- ==================== 20261117020000_fanart_tags.sql ====================
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

-- ==================== 20261117030000_chat_images.sql ====================
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

-- ==================== 20261117040000_reports_manual.sql ====================
-- Signalements manuels : un message ou un membre, avec un motif précis, quand quelqu'un contourne les contrôles automatiques.
-- À exécuter après 20261117030000_chat_images.sql. Peut être relancé sans risque.
--   • motif choisi dans une liste (category) + précisions libres (reason) ;
--   • signaler un membre : on peut joindre les 15 derniers messages de la conversation (avec l'accord de la personne
--     qui signale, qui y participe) ; sinon l'administrateur ne voit toujours que le message signalé ;
--   • « urgent » : la conversation concerne un majeur et un mineur (traité en priorité par l'administrateur).

alter table public.reports add column if not exists with_context boolean not null default false;
alter table public.reports add column if not exists urgent boolean not null default false;

create or replace function public.report_before_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.messages; c public.anime_comments; f public.fanarts; ctx text;
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

drop function if exists public.admin_reports();
create or replace function public.admin_reports()
returns table (id uuid, created_at timestamptz, reason text, excerpt text, handled boolean, auto boolean, category text,
               comment_id uuid, fanart_id uuid, with_context boolean, urgent boolean,
               reporter_name text, reporter_email text, target_id uuid, target_name text, target_email text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select r.id, r.created_at, r.reason, r.excerpt, r.handled, r.auto, r.category, r.comment_id, r.fanart_id, r.with_context, r.urgent,
    pr.username, ur.email::text, r.target_user, pt.username, ut.email::text
  from public.reports r
  left join public.profiles pr on pr.user_id = r.reporter left join auth.users ur on ur.id = r.reporter
  left join public.profiles pt on pt.user_id = r.target_user left join auth.users ut on ut.id = r.target_user
  order by r.handled, r.urgent desc, r.created_at desc;
end $$;
revoke all on function public.admin_reports() from public;
grant execute on function public.admin_reports() to authenticated;

-- ==================== 20261117050000_min_age.sql ====================
-- Âge minimum : 15 ans (en France, avant 15 ans, l'accord d'un parent est nécessaire pour traiter les données d'un mineur).
-- À exécuter après 20261117040000_reports_manual.sql. Peut être relancé sans risque.
--   • inscription refusée si l'année de naissance donne moins de 15 ans cette année ; l'année des 15 ans,
--     le site demande en plus de confirmer que l'anniversaire est passé ;
--   • comptes existants de moins de 15 ans : collection conservée, mais amis, messagerie, avis, fan arts et images
--     sont bloqués par la base de données.

create or replace function public.old_enough(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(year from now())::int - birth_year >= 15 from public.profiles where user_id = u), false)
$$;
revoke all on function public.old_enough(uuid) from public;
grant execute on function public.old_enough(uuid) to authenticated;

-- Profil : l'année saisie (à l'inscription ou plus tard) doit donner au moins 15 ans cette année.
create or replace function public.check_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_year is not null and new.birth_year > extract(year from now())::int then
    raise exception 'invalid_birth_year' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.birth_year is not null and new.birth_year is distinct from old.birth_year then
    raise exception 'birth_year_locked' using errcode = '42501';
  end if;
  if new.birth_year is not null and (tg_op = 'INSERT' or old.birth_year is null)
     and extract(year from now())::int - new.birth_year < 15 then
    raise exception 'too_young' using errcode = '23514';
  end if;
  if new.username is not null and (tg_op = 'INSERT' or new.username is distinct from old.username)
     and public.username_problem(new.username) in ('invalid', 'forbidden') then
    raise exception 'forbidden_username' using errcode = '23514';
  end if;
  return new;
end $$;

-- Amitiés : les deux personnes doivent avoir au moins 15 ans.
create or replace function public.can_befriend(a uuid, b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select a <> b and public.has_birth_year(a) and public.has_birth_year(b)
     and public.old_enough(a) and public.old_enough(b) and not public.is_blocked(a, b)
$$;

-- Messages, images, avis, fan arts : réservés aux 15 ans et plus.
create or replace function public.require_old_enough() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a uuid; b uuid;
begin
  if tg_table_name = 'messages' then a := new.sender; b := new.recipient;
  elsif tg_table_name = 'chat_images' then a := new.sender; b := new.recipient;
  else a := new.user_id; b := null; end if;
  if not public.old_enough(a) or (b is not null and not public.old_enough(b)) then
    raise exception 'too_young' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists messages_age on public.messages;
create trigger messages_age before insert on public.messages for each row execute function public.require_old_enough();
drop trigger if exists chat_images_age on public.chat_images;
create trigger chat_images_age before insert on public.chat_images for each row execute function public.require_old_enough();
drop trigger if exists comments_age on public.anime_comments;
create trigger comments_age before insert on public.anime_comments for each row execute function public.require_old_enough();
drop trigger if exists fanarts_age on public.fanarts;
create trigger fanarts_age before insert on public.fanarts for each row execute function public.require_old_enough();

-- ==================== 20261117060000_moderators.sql ====================
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

drop function if exists public.admin_fanarts(text);
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

drop function if exists public.admin_chat_images(text);
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

revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;

-- ==================== 20261117070000_ai_scores.sql ====================
-- Score de l'analyse automatique des images (IA NSFWJS exécutée dans le navigateur au moment de l'envoi).
-- À exécuter après 20261117060000_moderators.sql. Peut être relancé sans risque.
--   • ai_score : probabilité (0 à 1) que l'image soit à caractère sexuel, calculée avant l'envoi ;
--   • les files de vérification affichent d'abord les images les plus suspectes ;
--   • c'est un indice pour l'équipe de modération, pas une décision : la vérification humaine reste la règle.

alter table public.fanarts add column if not exists ai_score real check (ai_score between 0 and 1);
alter table public.chat_images add column if not exists ai_score real check (ai_score between 0 and 1);

drop function if exists public.admin_fanarts(text);
create or replace function public.admin_fanarts(p_status text default 'pending')
returns table (id uuid, user_id uuid, username text, email text, path text, title text, description text, credit text, source_url text,
               tags text[], adult boolean, ai_score real, character_id integer, anime_id integer, status text, reject_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select f.id, f.user_id, p.username, u.email::text, f.path, f.title, f.description, f.credit, f.source_url,
    f.tags, f.adult, f.ai_score, f.character_id, f.anime_id, f.status, f.reject_reason, f.created_at
  from public.fanarts f left join public.profiles p on p.user_id = f.user_id left join auth.users u on u.id = f.user_id
  where f.status = p_status order by f.ai_score desc nulls last, f.created_at limit 200;
end $$;
revoke all on function public.admin_fanarts(text) from public;
grant execute on function public.admin_fanarts(text) to authenticated;

drop function if exists public.admin_chat_images(text);
create or replace function public.admin_chat_images(p_status text default 'pending')
returns table (id uuid, path text, status text, created_at timestamptz, ai_score real, sender uuid, sender_name text, sender_adult boolean,
               recipient uuid, recipient_name text, recipient_adult boolean)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  return query select c.id, c.path, c.status, c.created_at, c.ai_score,
    c.sender, ps.username, public.is_adult_user(c.sender), c.recipient, pr.username, public.is_adult_user(c.recipient)
  from public.chat_images c left join public.profiles ps on ps.user_id = c.sender left join public.profiles pr on pr.user_id = c.recipient
  where c.status = p_status order by c.ai_score desc nulls last, c.created_at limit 200;
end $$;
revoke all on function public.admin_chat_images(text) from public;
grant execute on function public.admin_chat_images(text) to authenticated;

-- ==================== 20261117080000_notifications_activity.sql ====================
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
-- Droits de la fonction « push » (rôle service_role) sur les tables qu'elle lit ou écrit.
-- Les projets Supabase récents n'accordent plus ces droits automatiquement : sans eux, la fonction
-- répond « permission denied » et aucune notification n'arrive sur les téléphones.
grant select, insert on public.notifications to service_role;
grant select, delete on public.push_subscriptions to service_role;
grant select on public.profiles to service_role;
grant select on public.messages to service_role;
-- Jeu et communauté : avis likés, notes de la communauté, top de la semaine, sondage de saison,
-- défi (quiz) de la semaine, objectif annuel, « adorés par tes amis » et compteurs pour les badges.
-- À exécuter après 20261117120000_push_service_grants.sql. Peut être relancé sans risque.
-- Les collections restent privées : seuls des totaux anonymes sont publiés (et seulement à partir de 3 membres).

-- ---------------------------------------------------------------------------
-- 1. Avis likés (« utile ») — un like par membre et par avis, notification à l'auteur
-- ---------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id uuid        not null references public.anime_comments (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_likes enable row level security;
revoke all on public.comment_likes from anon, authenticated;
grant select, insert, delete on public.comment_likes to authenticated;
drop policy if exists "likes avis: les siens" on public.comment_likes;
create policy "likes avis: les siens" on public.comment_likes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.anime_comments c where c.id = comment_id and c.user_id <> (select auth.uid())));

create or replace function public.comment_likes_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.anime_comments;
begin
  select * into c from public.anime_comments where id = new.comment_id;
  -- une seule notification par avis et par membre, même s'il retire puis remet son like
  if found and not public.is_blocked(c.user_id, new.user_id)
     and not exists (select 1 from public.notifications n where n.user_id = c.user_id and n.kind = 'comment_like' and n.actor = new.user_id and n.ref = c.anime_id::text) then
    perform public.notify(c.user_id, 'comment_like', new.user_id, c.anime_id::text);
  end if;
  return new;
end $$;
drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify after insert on public.comment_likes for each row execute function public.comment_likes_notify();

-- Liste des avis : nombre de likes, « j'ai liké », les plus utiles d'abord (le tien en tête).
drop function if exists public.anime_comments_list(integer);
create function public.anime_comments_list(aid integer)
returns table (id uuid, body text, spoiler boolean, created_at timestamptz, updated_at timestamptz, user_id uuid, username text, mine boolean, likes bigint, liked boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.spoiler, c.created_at, c.updated_at, c.user_id, coalesce(p.username, 'Membre'), c.user_id = (select auth.uid()),
         (select count(*) from public.comment_likes l where l.comment_id = c.id),
         exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = (select auth.uid()))
  from public.anime_comments c left join public.profiles p on p.user_id = c.user_id
  where c.anime_id = aid
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), c.user_id))
  order by (c.user_id = (select auth.uid())) desc, 9 desc, c.created_at desc
  limit 200
$$;
revoke all on function public.anime_comments_list(integer) from public;
grant execute on function public.anime_comments_list(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notes de la communauté et top de la semaine (totaux anonymes)
-- ---------------------------------------------------------------------------
create or replace function public.community_stats(aid integer)
returns table (avg_rating numeric, ratings bigint, favorites bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  select case when count(rating) >= 3 then round(avg(rating), 1) end,
         case when count(rating) >= 3 then count(rating) else 0 end,
         case when count(*) >= 3 then count(*) filter (where favorite) else 0 end,
         case when count(*) >= 3 then count(*) else 0 end
  from public.collection_entries where anime_id = aid
$$;
-- Les animés qui ont le plus bougé dans les collections ces 7 derniers jours (au moins 2 membres).
create or replace function public.community_top_week(p_limit integer default 20)
returns table (anime_id integer, members bigint, score bigint)
language sql stable security definer set search_path = '' as $$
  select anime_id, count(*), sum(1 + case when favorite then 3 else 0 end + case when rating >= 4 then 2 else 0 end
                                  + case when status in ('watching', 'watched') then 1 else 0 end)::bigint
  from public.collection_entries
  where updated_at > now() - interval '7 days'
  group by anime_id having count(*) >= 2
  order by 3 desc, 2 desc limit least(greatest(p_limit, 1), 50)
$$;
revoke all on function public.community_stats(integer), public.community_top_week(integer) from public;
grant execute on function public.community_stats(integer), public.community_top_week(integer) to anon, authenticated;

-- Adorés par tes amis : coups de cœur et notes 4-5 étoiles des amis qui partagent leur activité.
create or replace function public.friends_loved(p_limit integer default 20)
returns table (anime_id integer, friends bigint, names text)
language sql stable security definer set search_path = '' as $$
  select e.anime_id, count(distinct e.user_id), string_agg(distinct p.username, ', ')
  from public.collection_entries e join public.profiles p on p.user_id = e.user_id
  where (e.favorite or e.rating >= 4) and p.share_activity
    and e.user_id <> (select auth.uid()) and public.is_friend((select auth.uid()), e.user_id)
  group by e.anime_id
  order by 2 desc, max(e.updated_at) desc limit least(greatest(p_limit, 1), 50)
$$;
revoke all on function public.friends_loved(integer) from public;
grant execute on function public.friends_loved(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sondage « animé de la saison » : un vote par membre et par saison, modifiable pendant la saison
-- ---------------------------------------------------------------------------
create or replace function public.current_season_key() returns text
language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'Europe/Paris', 'YYYY') || '-' ||
         (array['WINTER', 'SPRING', 'SUMMER', 'FALL'])[(extract(month from now() at time zone 'Europe/Paris')::int - 1) / 3 + 1]
$$;
create table if not exists public.season_votes (
  season     text        not null check (season ~ '^\d{4}-(WINTER|SPRING|SUMMER|FALL)$'),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  anime_id   integer     not null check (anime_id > 0),
  created_at timestamptz not null default now(),
  primary key (season, user_id)
);
alter table public.season_votes enable row level security;
revoke all on public.season_votes from anon, authenticated;
grant select, insert, delete on public.season_votes to authenticated;
grant update (anime_id) on public.season_votes to authenticated;
drop policy if exists "votes: les siens" on public.season_votes;
create policy "votes: les siens" on public.season_votes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and season = public.current_season_key() and public.old_enough((select auth.uid())));

create or replace function public.season_poll(p_season text)
returns table (anime_id integer, votes bigint)
language sql stable security definer set search_path = '' as $$
  select anime_id, count(*) from public.season_votes where season = p_season group by anime_id order by 2 desc, min(created_at) limit 30
$$;
revoke all on function public.season_poll(text) from public;
grant execute on function public.season_poll(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Défi de la semaine (quiz) : un essai par semaine, classement général et entre amis
-- ---------------------------------------------------------------------------
create or replace function public.current_week_key() returns text
language sql stable set search_path = '' as $$ select to_char(now() at time zone 'Europe/Paris', 'IYYY-"W"IW') $$;
create table if not exists public.quiz_scores (
  week       text        not null check (week ~ '^\d{4}-W\d{2}$'),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  score      smallint    not null,
  total      smallint    not null check (total between 1 and 20),
  ms         integer     not null check (ms between 0 and 3600000),
  created_at timestamptz not null default now(),
  primary key (week, user_id),
  check (score between 0 and total)
);
alter table public.quiz_scores enable row level security;
revoke all on public.quiz_scores from anon, authenticated;
grant select, insert on public.quiz_scores to authenticated;
drop policy if exists "quiz: les siens" on public.quiz_scores;
drop policy if exists "quiz: un essai" on public.quiz_scores;
create policy "quiz: les siens" on public.quiz_scores for select to authenticated using (user_id = (select auth.uid()));
create policy "quiz: un essai" on public.quiz_scores for insert to authenticated
  with check (user_id = (select auth.uid()) and week = public.current_week_key());

-- Classement d'une semaine : les 20 meilleurs, plus toi et tes amis (pseudo uniquement).
create or replace function public.quiz_board(p_week text)
returns table (username text, score smallint, total smallint, ms integer, me boolean, friend boolean, rank bigint)
language sql stable security definer set search_path = '' as $$
  with r as (
    select q.user_id, coalesce(p.username, 'Membre') as username, q.score, q.total, q.ms,
           rank() over (order by q.score desc, q.ms) as rk
    from public.quiz_scores q left join public.profiles p on p.user_id = q.user_id
    where q.week = p_week)
  select username, score, total, ms, user_id = (select auth.uid()),
         (select auth.uid()) is not null and public.is_friend((select auth.uid()), user_id), rk
  from r
  where rk <= 20 or user_id = (select auth.uid()) or ((select auth.uid()) is not null and public.is_friend((select auth.uid()), user_id))
  order by rk, username limit 60
$$;
revoke all on function public.quiz_board(text) from public;
grant execute on function public.quiz_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Objectif annuel (« voir 50 animés en 2027 »)
-- ---------------------------------------------------------------------------
create table if not exists public.user_goals (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  year       smallint    not null check (year between 2020 and 2100),
  target     smallint    not null check (target between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);
alter table public.user_goals enable row level security;
revoke all on public.user_goals from anon, authenticated;
grant select, insert, delete on public.user_goals to authenticated;
grant update (target, updated_at) on public.user_goals to authenticated;
drop policy if exists "objectifs: les siens" on public.user_goals;
create policy "objectifs: les siens" on public.user_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Compteurs pour les badges (ce que la collection seule ne dit pas)
-- ---------------------------------------------------------------------------
create or replace function public.my_achievements() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reviews',  (select count(*) from public.anime_comments where user_id = (select auth.uid())),
    'likes',    (select count(*) from public.comment_likes l join public.anime_comments c on c.id = l.comment_id where c.user_id = (select auth.uid())),
    'fanarts',  (select count(*) from public.fanarts where user_id = (select auth.uid()) and status = 'approved'),
    'posts',    (select count(*) from public.episode_posts where user_id = (select auth.uid())),
    'friends',  (select count(*) from public.friendships where (select auth.uid()) in (user_a, user_b) and status = 'accepted'),
    'quizzes',  (select count(*) from public.quiz_scores where user_id = (select auth.uid())),
    'perfect',  (select count(*) from public.quiz_scores where user_id = (select auth.uid()) and score = total),
    'votes',    (select count(*) from public.season_votes where user_id = (select auth.uid())))
$$;
revoke all on function public.my_achievements() from public;
grant execute on function public.my_achievements() to authenticated;

-- La fonction « push » lit les notifications « like » comme les autres (droits déjà donnés en 20261117120000).
-- Supprimer une conversation (de son côté uniquement).
-- À exécuter après 20261118000000_jeu_communaute.sql. Peut être relancé sans risque.
--   • les messages échangés jusqu'ici disparaissent de TA messagerie ; l'autre personne garde sa copie ;
--   • si l'un de vous écrit à nouveau, la conversation réapparaît avec les nouveaux messages seulement ;
--   • les messages restent en base pour l'autre personne (et pour un signalement éventuel de sa part).

create table if not exists public.conversation_clears (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  other      uuid        not null references auth.users (id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, other)
);
alter table public.conversation_clears enable row level security;
revoke all on public.conversation_clears from anon, authenticated;
grant select on public.conversation_clears to authenticated;
drop policy if exists "conversations effacées: les siennes" on public.conversation_clears;
create policy "conversations effacées: les siennes" on public.conversation_clears for select to authenticated using (user_id = (select auth.uid()));

-- Lecture des messages : on ne voit plus ceux d'une conversation effacée (jusqu'à la date d'effacement).
drop policy if exists "messages: lecture" on public.messages;
create policy "messages: lecture" on public.messages for select to authenticated
  using ((select auth.uid()) in (sender, recipient)
         and not exists (select 1 from public.conversation_clears c
                         where c.user_id = (select auth.uid())
                           and c.other = case when messages.sender = (select auth.uid()) then messages.recipient else messages.sender end
                           and messages.created_at <= c.cleared_at));

-- Effacer : enregistre la date et marque les messages reçus comme lus (la pastille disparaît).
create or replace function public.clear_conversation(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or p_other is null or p_other = me then raise exception 'no_target' using errcode = '22023'; end if;
  insert into public.conversation_clears (user_id, other, cleared_at) values (me, p_other, now())
    on conflict (user_id, other) do update set cleared_at = excluded.cleared_at;
  update public.messages set read_at = now() where sender = p_other and recipient = me and read_at is null;
end $$;
revoke all on function public.clear_conversation(uuid) from public;
grant execute on function public.clear_conversation(uuid) to authenticated;
