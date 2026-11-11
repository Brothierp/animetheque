-- Suppression de compte par l'utilisateur lui-même (droit à l'effacement, RGPD).
-- Supprime le compte auth.users de l'appelant ; ses fiches, listes et titres de listes
-- disparaissent avec lui grâce aux clés étrangères « on delete cascade ».
create or replace function public.delete_my_account() returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;
  delete from auth.users where id = uid;
end $$;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
