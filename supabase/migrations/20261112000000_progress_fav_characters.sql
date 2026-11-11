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
