-- Année de naissance : sert à réserver le contenu adulte (18+) aux comptes majeurs.
-- On stocke l'année (et non l'âge) pour que la majorité soit atteinte automatiquement avec le temps.
-- L'année ne peut être saisie qu'une fois et n'est pas modifiable ensuite par l'utilisateur.

create table if not exists public.profiles (
  user_id    uuid        primary key default auth.uid() references auth.users (id) on delete cascade,
  birth_year smallint    not null check (birth_year between 1900 and 2100),
  created_at timestamptz not null default now()
);

-- Refuse une année dans le futur.
create or replace function public.check_birth_year() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_year > extract(year from now())::int then
    raise exception 'invalid_birth_year' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profiles_birth_year on public.profiles;
create trigger profiles_birth_year before insert or update on public.profiles
  for each row execute function public.check_birth_year();

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert on public.profiles to authenticated;   -- pas de update ni delete : l'année est définitive

drop policy if exists "profiles: lecture de son profil" on public.profiles;
drop policy if exists "profiles: création de son profil" on public.profiles;
create policy "profiles: lecture de son profil" on public.profiles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "profiles: création de son profil" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- Inscription par e-mail : l'année saisie dans le formulaire arrive dans les métadonnées du compte.
-- On crée le profil dès la création du compte (avant même la confirmation de l'e-mail).
-- Toute erreur est ignorée pour ne jamais bloquer une inscription ; l'année sera alors redemandée.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  y text := new.raw_user_meta_data ->> 'birth_year';
begin
  if y ~ '^\d{4}$' then
    begin
      insert into public.profiles (user_id, birth_year) values (new.id, y::smallint)
      on conflict (user_id) do nothing;
    exception when others then
      null;
    end;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
