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
