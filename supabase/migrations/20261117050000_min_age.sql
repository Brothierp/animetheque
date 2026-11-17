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
