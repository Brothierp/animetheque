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
