\echo '--- profils et listes publics'
\set H 'abababab-0000-0000-0000-000000000008'
\set F 'ffffffff-0000-0000-0000-000000000006'
begin; set local role anon; select 'profil privé : ' || coalesce(public.public_profile('Hugo')::text, 'invisible'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
update public.profiles set public_profile = true where user_id = :'H';
insert into public.lists (id, name, visibility) values ('22222222-0000-0000-0000-000000000001', 'Mes isekai préférés', 'public');
insert into public.list_items (list_id, user_id, anime_id) values ('22222222-0000-0000-0000-000000000001', :'H', 108465); commit;
begin; set local role anon;
select 'profil public : ' || (public.public_profile('hugo') - 'since')::text;
select 'liste publique : ' || (public.public_list('22222222-0000-0000-0000-000000000001') ->> 'name') || ' par ' || (public.public_list('22222222-0000-0000-0000-000000000001') ->> 'owner'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.profiles set public_profile = true where user_id = :'F'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.lists (name, visibility) values ('liste mineur', 'public'); rollback;
