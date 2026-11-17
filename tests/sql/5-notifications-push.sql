\echo '--- notifications sur l''appareil'
\set H 'abababab-0000-0000-0000-000000000008'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
insert into public.push_subscriptions (endpoint, p256dh, auth, device) values ('https://push.example/abc', 'cle', 'auth', 'Android');
select 'abonnement : ' || count(*) from public.push_subscriptions; select public.push_test(); select 'test créé : ' || string_agg(kind, ',') from public.notifications where kind = 'test';
select 'clé publique (pas encore créée) : ' || coalesce(public.push_public_key(), 'aucune'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select 'Alice voit les abonnements d''Hugo : ' || count(*) from public.push_subscriptions; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
select * from public.push_config_get(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
select * from public.push_watchers(array[21]); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
insert into public.push_subscriptions (endpoint, p256dh, auth) values ('http://pas-https', 'a', 'b'); rollback;
set role service_role; select 'fonction : séries suivies par les abonnés : ' || string_agg(anime_id::text, ',') from public.push_watchers(array[21, 16498]); reset role;
