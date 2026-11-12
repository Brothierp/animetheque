-- Rôle administrateur : consultation de la liste des comptes (pseudo, e-mail, année de naissance, dates).
-- Les collections restent privées : l'administrateur ne voit pas ce que chacun regarde ni ses avis.
-- À exécuter après les scripts précédents. Peut être relancé sans risque.
--
-- Pour te nommer administrateur, exécute ensuite UNE fois (en remplaçant l'adresse par la tienne) :
--   insert into public.admins (user_id) select id from auth.users where email = 'ton.adresse@exemple.com';

create table if not exists public.admins (
  user_id    uuid        primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.admins enable row level security;
-- Aucun accès depuis le site : la liste des administrateurs ne se modifie que dans Supabase (SQL Editor).
revoke all on public.admins from anon, authenticated;

-- Vrai si la personne connectée est administratrice.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()))
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- Liste des comptes, réservée aux administrateurs.
create or replace function public.admin_list_users()
returns table (
  user_id uuid, email text, username text, birth_year smallint, providers text,
  created_at timestamptz, last_sign_in_at timestamptz, email_confirmed boolean, titles integer
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  return query
    select u.id, u.email::text, p.username, p.birth_year,
           coalesce((select string_agg(x, ', ') from jsonb_array_elements_text(u.raw_app_meta_data -> 'providers') x), u.raw_app_meta_data ->> 'provider'),
           u.created_at, u.last_sign_in_at, u.email_confirmed_at is not null,
           (select count(*)::integer from public.collection_entries c where c.user_id = u.id)
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    order by u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;
