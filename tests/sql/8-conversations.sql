\echo '--- suppression d''une conversation'
\set X 'abababab-0000-0000-0000-000000000008'
\set Y 'cdcdcdcd-0000-0000-0000-000000000009'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.messages (recipient, body, created_at) values (:'X', 'Salut Hugo, tu as vu le dernier épisode ?', now() - interval '1 hour'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
select 'Hugo, messages avec Inès avant : ' || count(*) from public.messages where :'Y' in (sender, recipient);
select public.clear_conversation(:'Y');
select 'Hugo, messages avec Inès après suppression : ' || count(*) from public.messages where :'Y' in (sender, recipient);
select 'Hugo, non lus : ' || messages from public.my_counters(); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
select 'Inès garde sa copie : ' || (count(*) > 0) from public.messages where :'X' in (sender, recipient);
insert into public.messages (recipient, body, created_at) values (:'X', 'Tu es là ?', now() + interval '1 second'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
select 'Hugo voit le nouveau message : ' || string_agg(body, ' | ') from public.messages where :'Y' in (sender, recipient);
select public.clear_conversation(:'X'); rollback;
