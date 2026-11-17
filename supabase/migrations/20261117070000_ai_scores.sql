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
