-- Fausses dates de naissance : la modération peut traiter un compte comme mineur, et les indices d'âge
-- écrits par un membre déclaré majeur (« j'ai 13 ans », « je suis en 4e »…) sont signalés automatiquement.
-- À exécuter après 20261118010000_conversation_clear.sql. Peut être relancé sans risque.

-- ---------------------------------------------------------------------------
-- 1. Statut d'âge décidé par la modération (prime sur l'année déclarée)
--    'minor'   : traité comme mineur (pas de 18+, protections majeurs / mineurs, profil public retiré)
--    'under15' : traité comme moins de 15 ans (amis, messagerie, avis, fan arts et discussions désactivés)
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists age_flag text;
alter table public.profiles drop constraint if exists profiles_age_flag_check;
alter table public.profiles add constraint profiles_age_flag_check check (age_flag in ('minor', 'under15'));
alter table public.profiles add column if not exists age_flag_at timestamptz;
-- (le membre ne peut pas modifier ces colonnes : seules username, avatar_path, birth_year… lui sont ouvertes)

create or replace function public.is_adult_user(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(year from now())::int - birth_year > 18 and age_flag is null from public.profiles where user_id = u), false)
$$;
create or replace function public.old_enough(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select extract(year from now())::int - birth_year >= 15 and age_flag is distinct from 'under15' from public.profiles where user_id = u), false)
$$;

-- Poser ou retirer le statut (équipe de modération). Effets immédiats :
--   • profil public et listes publiques retirés ;
--   • amitiés et demandes avec des majeurs supprimées (la messagerie n'est permise qu'entre personnes du même âge) ;
--   • le membre reçoit une notification qui explique comment contester.
create or replace function public.admin_set_age_flag(p_user uuid, p_flag text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_flag is not null and p_flag not in ('minor', 'under15') then raise exception 'invalid_flag' using errcode = '22023'; end if;
  if p_user = (select auth.uid()) then raise exception 'no_target' using errcode = '22023'; end if;
  update public.profiles set age_flag = p_flag, age_flag_at = case when p_flag is null then null else now() end where user_id = p_user;
  if not found then raise exception 'no_target' using errcode = '22023'; end if;
  if p_flag is not null then
    update public.profiles set public_profile = false where user_id = p_user;
    update public.lists set visibility = 'private' where user_id = p_user and visibility = 'public';
    delete from public.friendships f
      where p_user in (f.user_a, f.user_b)
        and public.is_adult_user(case when f.user_a = p_user then f.user_b else f.user_a end);
    delete from public.moderators where user_id = p_user;
  end if;
  perform public.notify(p_user, case when p_flag is null then 'age_flag_removed' else 'age_flag' end, null, p_flag);
end $$;
-- État d'âge de quelques membres (pour l'écran des signalements).
create or replace function public.admin_age_flags(ids uuid[])
returns table (user_id uuid, age_flag text, adult boolean, birth_year smallint)
language sql stable security definer set search_path = '' as $$
  select p.user_id, p.age_flag, public.is_adult_user(p.user_id), case when public.is_admin() then p.birth_year end
  from public.profiles p where public.is_staff() and p.user_id = any(ids)
$$;
revoke all on function public.admin_set_age_flag(uuid, text), public.admin_age_flags(uuid[]) from public;
grant execute on function public.admin_set_age_flag(uuid, text), public.admin_age_flags(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Indices d'âge écrits par un membre déclaré majeur : signalement automatique (rien n'est bloqué)
-- ---------------------------------------------------------------------------
-- Texte comparé : minuscules, sans accents, chiffres conservés (contrairement au filtre de mots interdits).
create or replace function public.age_hint(t text) returns boolean
language sql immutable set search_path = '' as $$
  select (' ' || regexp_replace(translate(lower(coalesce(t, '')), 'àáâäçèéêëìíîïòóôöùúûüÿ', 'aaaaceeeeiiiioooouuuuy'), '[^a-z0-9]+', ' ', 'g') || ' ') ~ (
       ' j ?a?i (1[0-7]|[89]|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|dix sept) ?ans (?!(de|d|deja|que|qu) )'
    || '| (i m|im|i am) (1[0-7]|[89]) ?(yo|y o|years old|year old) '
    || '| je (suis|serai|vais|rentre|passe) (en|au) (6|5|4|3|6e|5e|4e|3e|6eme|5eme|4eme|3eme|sixieme|cinquieme|quatrieme|troisieme|seconde|2nde|premiere|1ere|terminale|college|lycee|cm2) '
    || '| (mon|au) college '
    || '| (je passe|je revise|reviser|passer) (le|mon) brevet '
    || '| (ma prof|mon prof) (principal|principale) ')
$$;

-- Un seul signalement « indice d'âge » ouvert par membre (pas de doublons).
create or replace function public.age_hint_report(u uuid, body text, src text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if u is null or not public.is_adult_user(u) or not public.age_hint(body) then return; end if;
  if exists (select 1 from public.reports where target_user = u and category = 'indice_age' and not handled) then return; end if;
  insert into public.reports (reporter, target_user, excerpt, reason, auto, category)
  values (null, u, left(src || ' : ' || body, 2000), 'Détection automatique : ce membre, déclaré majeur, semble indiquer qu''il ou elle est mineur·e', true, 'indice_age');
end $$;
revoke all on function public.age_hint(text), public.age_hint_report(uuid, text, text) from public;

create or replace function public.age_hint_messages() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.age_hint_report(new.sender, new.body, 'Message privé'); return new; end $$;
create or replace function public.age_hint_comments() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.age_hint_report(new.user_id, new.body, 'Avis'); return new; end $$;
create or replace function public.age_hint_posts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform public.age_hint_report(new.user_id, new.body, 'Discussion d''épisode ' || new.episode); return new; end $$;

drop trigger if exists messages_age_hint on public.messages;
create trigger messages_age_hint after insert on public.messages for each row execute function public.age_hint_messages();
drop trigger if exists comments_age_hint on public.anime_comments;
create trigger comments_age_hint after insert or update of body on public.anime_comments for each row execute function public.age_hint_comments();
drop trigger if exists episode_posts_age_hint on public.episode_posts;
create trigger episode_posts_age_hint after insert on public.episode_posts for each row execute function public.age_hint_posts();
