-- Pseudo, avatar et filtre de mots interdits (pseudo, noms de listes, commentaires).
-- À exécuter après les trois scripts précédents. Peut être relancé sans risque.

-- ---------------------------------------------------------------------------
-- 1. Mots interdits. Table modifiable depuis Supabase > Table Editor > banned_words.
--    mode = 'word'      : bloqué seulement s'il apparaît comme mot entier (évite de bloquer « computer » pour « pute »)
--    mode = 'substring' : bloqué même collé à d'autres lettres (pour les termes sans ambiguïté)
--    Les mots sont comparés après normalisation (minuscules, sans accents, chiffres et symboles
--    « leet » remplacés : 0→o, 1→i, 3→e, 4→a, 5→s, 7→t, @→a, $→s, !→i, |→i).
-- ---------------------------------------------------------------------------
create table if not exists public.banned_words (
  word text primary key check (char_length(word) between 2 and 40),
  mode text not null default 'word' check (mode in ('word', 'substring'))
);
alter table public.banned_words enable row level security;
revoke all on public.banned_words from anon, authenticated;   -- invisible pour les utilisateurs

insert into public.banned_words (word, mode) values
  -- insultes (français)
  ('connard', 'substring'), ('connasse', 'substring'), ('salope', 'substring'), ('salopard', 'substring'),
  ('encule', 'substring'), ('enculer', 'substring'), ('enfoire', 'substring'), ('batard', 'substring'),
  ('pouffiasse', 'substring'), ('petasse', 'substring'), ('trouduc', 'substring'), ('fils de pute', 'substring'),
  ('nique ta mere', 'substring'), ('niquetamere', 'substring'), ('ta gueule', 'substring'), ('fdp', 'word'),
  ('ntm', 'word'), ('pute', 'word'), ('putes', 'word'), ('con', 'word'), ('conne', 'word'), ('cons', 'word'),
  ('salaud', 'word'), ('tg', 'word'),
  -- haine, racisme, homophobie (français)
  ('negre', 'substring'), ('negresse', 'substring'), ('bougnoul', 'substring'), ('bougnoule', 'substring'),
  ('youpin', 'substring'), ('youtre', 'substring'), ('chinetoque', 'substring'), ('bicot', 'word'),
  ('bamboula', 'word'), ('raton', 'word'), ('negro', 'word'), ('sale arabe', 'substring'), ('sale noir', 'substring'),
  ('sale juif', 'substring'), ('sale chinois', 'substring'), ('sale pd', 'substring'), ('pd', 'word'), ('pede', 'word'),
  ('tarlouze', 'substring'), ('tantouze', 'substring'), ('tapette', 'word'), ('gouine', 'substring'),
  ('travelo', 'substring'), ('heil hitler', 'substring'), ('sieg heil', 'substring'), ('white power', 'substring'),
  ('kkk', 'word'), ('pedo', 'word'), ('pedophile', 'word'),
  -- anglais
  ('nigger', 'substring'), ('nigga', 'substring'), ('faggot', 'substring'), ('fag', 'word'), ('cunt', 'word'),
  ('bitch', 'substring'), ('whore', 'substring'), ('slut', 'word'), ('chink', 'word'), ('spic', 'word'),
  ('kike', 'word'), ('wetback', 'substring'), ('motherfucker', 'substring'), ('fuck you', 'substring'),
  ('asshole', 'substring'), ('dickhead', 'substring'), ('tranny', 'substring')
on conflict (word) do nothing;

create or replace function public.normalize_text(t text) returns text
language sql immutable set search_path = '' as $$
  select regexp_replace(
    translate(lower(coalesce(t, '')),
      'àáâãäåçèéêëìíîïñòóôõöùúûüýÿœæ013457@$!|',
      'aaaaaaceeeeiiiinooooouuuuyyoaoieastasii'),
    '(.)\1{2,}', '\1\1', 'g')   -- « coooonnard » → « coonnard »
$$;

-- Vrai si le texte contient un mot interdit.
create or replace function public.has_forbidden_word(t text) returns boolean
language sql stable security definer set search_path = '' as $$
  with n as (select public.normalize_text(t) as s)
  select exists (
    select 1 from public.banned_words b, n
    where (b.mode = 'substring'
           and regexp_replace(n.s, '[^a-z0-9]', '', 'g')
               like '%' || regexp_replace(public.normalize_text(b.word), '[^a-z0-9]', '', 'g') || '%')
       or (b.mode = 'word'
           and position(' ' || regexp_replace(public.normalize_text(b.word), '[^a-z0-9]+', ' ', 'g') || ' '
                        in ' ' || regexp_replace(n.s, '[^a-z0-9]+', ' ', 'g') || ' ') > 0)
  )
$$;

create or replace function public.reject_forbidden() returns trigger
language plpgsql set search_path = '' as $$
declare
  v text := to_jsonb(new) ->> tg_argv[0];
begin
  if v is not null and public.has_forbidden_word(v) then
    raise exception 'forbidden_word' using errcode = '23514', hint = 'Ce texte contient un terme interdit.';
  end if;
  return new;
end $$;

drop trigger if exists lists_forbidden on public.lists;
create trigger lists_forbidden before insert or update of name on public.lists
  for each row execute function public.reject_forbidden('name');

drop trigger if exists entries_forbidden on public.collection_entries;
create trigger entries_forbidden before insert or update of comment on public.collection_entries
  for each row execute function public.reject_forbidden('comment');

-- ---------------------------------------------------------------------------
-- 2. Profil : pseudo et avatar. L'année de naissance devient facultative à la création
--    (un compte Google peut choisir son pseudo avant), mais reste définitive une fois saisie.
-- ---------------------------------------------------------------------------
alter table public.profiles alter column birth_year drop not null;
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists avatar_path text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (username ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ_.-]{3,20}$' and username ~ '[A-Za-zÀ-ÖØ-öø-ÿ]')
);
alter table public.profiles drop constraint if exists profiles_avatar_path_owner;
alter table public.profiles add constraint profiles_avatar_path_owner check (
  avatar_path is null or split_part(avatar_path, '/', 1) = user_id::text
);
create unique index if not exists profiles_username_key on public.profiles (lower(username));

create or replace function public.username_problem(name text) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when name is null or not (name ~ '^[A-Za-z0-9À-ÖØ-öø-ÿ_.-]{3,20}$' and name ~ '[A-Za-zÀ-ÖØ-öø-ÿ]') then 'invalid'
    when public.has_forbidden_word(name)
      or regexp_replace(public.normalize_text(name), '[^a-z0-9]', '', 'g')
         in ('admin', 'administrateur', 'moderateur', 'moderator', 'support', 'animetheque', 'staff', 'root') then 'forbidden'
    when exists (select 1 from public.profiles p where lower(p.username) = lower(name)
                 and p.user_id is distinct from auth.uid()) then 'taken'
    else null
  end
$$;

-- Vérification avant inscription : 'ok', 'invalid', 'forbidden' ou 'taken'.
create or replace function public.username_status(name text) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(public.username_problem(name), 'ok')
$$;
revoke all on function public.username_status(text) from public;
grant execute on function public.username_status(text) to anon, authenticated;

create or replace function public.check_profile() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.birth_year is not null and new.birth_year > extract(year from now())::int then
    raise exception 'invalid_birth_year' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and old.birth_year is not null and new.birth_year is distinct from old.birth_year then
    raise exception 'birth_year_locked' using errcode = '42501';
  end if;
  if new.username is not null and (tg_op = 'INSERT' or new.username is distinct from old.username)
     and public.username_problem(new.username) in ('invalid', 'forbidden') then
    raise exception 'forbidden_username' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists profiles_birth_year on public.profiles;
drop trigger if exists profiles_check on public.profiles;
create trigger profiles_check before insert or update on public.profiles
  for each row execute function public.check_profile();

-- L'utilisateur peut modifier son pseudo, son avatar, et saisir son année si elle manque.
grant update (username, avatar_path, birth_year) on public.profiles to authenticated;
drop policy if exists "profiles: modification de son profil" on public.profiles;
create policy "profiles: modification de son profil" on public.profiles
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- Inscription par e-mail : pseudo et année arrivent dans les métadonnées du compte.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  y text := new.raw_user_meta_data ->> 'birth_year';
  u text := new.raw_user_meta_data ->> 'username';
  yr smallint;
begin
  if y ~ '^\d{4}$' and y::int between 1900 and extract(year from now())::int then yr := y::smallint; end if;
  if u is not null and public.username_problem(u) is not null then u := null; end if;
  if yr is not null or u is not null then
    begin
      insert into public.profiles (user_id, birth_year, username) values (new.id, yr, u)
      on conflict (user_id) do nothing;
    exception when others then
      begin   -- pseudo pris entre-temps : on garde au moins l'année
        insert into public.profiles (user_id, birth_year) values (new.id, yr) on conflict (user_id) do nothing;
      exception when others then null;
      end;
    end;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Avatars : stockage privé, un dossier par utilisateur (<id>/fichier.webp), 1 Mo max.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 1048576, array['image/webp', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "avatars: lecture du sien"     on storage.objects;
drop policy if exists "avatars: ajout du sien"       on storage.objects;
drop policy if exists "avatars: modification du sien" on storage.objects;
drop policy if exists "avatars: suppression du sien" on storage.objects;
create policy "avatars: lecture du sien" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: ajout du sien" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: modification du sien" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: suppression du sien" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
