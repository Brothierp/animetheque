-- Animéthèque : collections privées (coups de cœur, notes, commentaires, statuts, listes).
-- Sécurité au niveau des lignes : chaque utilisateur ne lit et ne modifie que ses propres lignes.
-- À exécuter une fois dans Supabase > SQL Editor (ou via `supabase db push`).

-- ---------------------------------------------------------------------------
-- 1. Fiche de collection : une ligne par (utilisateur, animé)
-- ---------------------------------------------------------------------------
create table if not exists public.collection_entries (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  anime_id   integer     not null check (anime_id > 0),          -- identifiant AniList
  favorite   boolean     not null default false,                  -- coup de cœur
  rating     smallint    check (rating between 1 and 5),          -- note 1 à 5 étoiles
  comment    text        check (char_length(comment) <= 280),     -- commentaire rapide
  status     text        check (status in ('watched', 'watching', 'plan', 'dropped')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, anime_id)
);

-- ---------------------------------------------------------------------------
-- 2. Listes personnelles (50 max par utilisateur, noms uniques sans tenir compte de la casse)
-- ---------------------------------------------------------------------------
create table if not exists public.lists (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  name       text        not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index if not exists lists_user_name_key on public.lists (user_id, lower(btrim(name)));

-- ---------------------------------------------------------------------------
-- 3. Contenu des listes. La clé étrangère composite (list_id, user_id) garantit
--    qu'on ne peut ranger un titre que dans une liste qui nous appartient.
-- ---------------------------------------------------------------------------
create table if not exists public.list_items (
  list_id  uuid        not null,
  user_id  uuid        not null default auth.uid(),
  anime_id integer     not null check (anime_id > 0),
  added_at timestamptz not null default now(),
  primary key (list_id, anime_id),
  foreign key (list_id, user_id) references public.lists (id, user_id) on delete cascade
);
create index if not exists list_items_user_idx on public.list_items (user_id);

-- ---------------------------------------------------------------------------
-- Déclencheurs
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists collection_entries_touch on public.collection_entries;
create trigger collection_entries_touch before update on public.collection_entries
  for each row execute function public.touch_updated_at();

create or replace function public.enforce_list_limit() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.lists where user_id = new.user_id) >= 50 then
    raise exception 'list_limit_reached' using errcode = 'P0001', hint = '50 listes maximum';
  end if;
  return new;
end $$;

drop trigger if exists lists_limit on public.lists;
create trigger lists_limit before insert on public.lists
  for each row execute function public.enforce_list_limit();

-- ---------------------------------------------------------------------------
-- Sécurité au niveau des lignes (RLS)
-- ---------------------------------------------------------------------------
alter table public.collection_entries enable row level security;
alter table public.lists              enable row level security;
alter table public.list_items         enable row level security;

-- Les visiteurs non connectés n'ont aucun accès.
revoke all on public.collection_entries, public.lists, public.list_items from anon;
grant select, insert, update, delete on public.collection_entries, public.lists, public.list_items to authenticated;

-- collection_entries
drop policy if exists "entries: lecture de ses lignes"       on public.collection_entries;
drop policy if exists "entries: ajout de ses lignes"         on public.collection_entries;
drop policy if exists "entries: modification de ses lignes"  on public.collection_entries;
drop policy if exists "entries: suppression de ses lignes"   on public.collection_entries;
create policy "entries: lecture de ses lignes" on public.collection_entries
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "entries: ajout de ses lignes" on public.collection_entries
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "entries: modification de ses lignes" on public.collection_entries
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "entries: suppression de ses lignes" on public.collection_entries
  for delete to authenticated using ((select auth.uid()) = user_id);

-- lists
drop policy if exists "lists: lecture de ses listes"      on public.lists;
drop policy if exists "lists: ajout de ses listes"        on public.lists;
drop policy if exists "lists: modification de ses listes" on public.lists;
drop policy if exists "lists: suppression de ses listes"  on public.lists;
create policy "lists: lecture de ses listes" on public.lists
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "lists: ajout de ses listes" on public.lists
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "lists: modification de ses listes" on public.lists
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "lists: suppression de ses listes" on public.lists
  for delete to authenticated using ((select auth.uid()) = user_id);

-- list_items
drop policy if exists "items: lecture de ses titres"     on public.list_items;
drop policy if exists "items: ajout de ses titres"       on public.list_items;
drop policy if exists "items: suppression de ses titres" on public.list_items;
create policy "items: lecture de ses titres" on public.list_items
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "items: ajout de ses titres" on public.list_items
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "items: suppression de ses titres" on public.list_items
  for delete to authenticated using ((select auth.uid()) = user_id);
