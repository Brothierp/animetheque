-- Supprimer une conversation (de son côté uniquement).
-- À exécuter après 20261118000000_jeu_communaute.sql. Peut être relancé sans risque.
--   • les messages échangés jusqu'ici disparaissent de TA messagerie ; l'autre personne garde sa copie ;
--   • si l'un de vous écrit à nouveau, la conversation réapparaît avec les nouveaux messages seulement ;
--   • les messages restent en base pour l'autre personne (et pour un signalement éventuel de sa part).

create table if not exists public.conversation_clears (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  other      uuid        not null references auth.users (id) on delete cascade,
  cleared_at timestamptz not null default now(),
  primary key (user_id, other)
);
alter table public.conversation_clears enable row level security;
revoke all on public.conversation_clears from anon, authenticated;
grant select on public.conversation_clears to authenticated;
drop policy if exists "conversations effacées: les siennes" on public.conversation_clears;
create policy "conversations effacées: les siennes" on public.conversation_clears for select to authenticated using (user_id = (select auth.uid()));

-- Lecture des messages : on ne voit plus ceux d'une conversation effacée (jusqu'à la date d'effacement).
drop policy if exists "messages: lecture" on public.messages;
create policy "messages: lecture" on public.messages for select to authenticated
  using ((select auth.uid()) in (sender, recipient)
         and not exists (select 1 from public.conversation_clears c
                         where c.user_id = (select auth.uid())
                           and c.other = case when messages.sender = (select auth.uid()) then messages.recipient else messages.sender end
                           and messages.created_at <= c.cleared_at));

-- Effacer : enregistre la date et marque les messages reçus comme lus (la pastille disparaît).
create or replace function public.clear_conversation(p_other uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null or p_other is null or p_other = me then raise exception 'no_target' using errcode = '22023'; end if;
  insert into public.conversation_clears (user_id, other, cleared_at) values (me, p_other, now())
    on conflict (user_id, other) do update set cleared_at = excluded.cleared_at;
  update public.messages set read_at = now() where sender = p_other and recipient = me and read_at is null;
end $$;
revoke all on function public.clear_conversation(uuid) from public;
grant execute on function public.clear_conversation(uuid) to authenticated;
