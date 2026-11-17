\pset format unaligned
\set ON_ERROR_STOP 0
\set A 'aaaaaaaa-0000-0000-0000-000000000001'
\set B 'bbbbbbbb-0000-0000-0000-000000000002'
\set C 'cccccccc-0000-0000-0000-000000000003'
\set D 'dddddddd-0000-0000-0000-000000000004'
-- A et B majeurs, C mineure (2012), D sans année ; A est admin
insert into auth.users (id, email, raw_user_meta_data) values
 (:'A', 'a@ex.com', '{"username":"Alice","birth_year":"1990"}'), (:'B', 'b@ex.com', '{"username":"Bob","birth_year":"1995"}'),
 (:'C', 'c@ex.com', '{"username":"Chloe","birth_year":"2010"}'), (:'D', 'd@ex.com', '{"username":"Dan"}');
insert into public.admins values (:'A');
insert into storage.objects (bucket_id, name) values ('avatars', 'bbbbbbbb-0000-0000-0000-000000000002/1.webp'), ('avatars', 'cccccccc-0000-0000-0000-000000000003/1.webp');

\echo '--- amis'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'A cherche « bob » : ' || username || ' relation=' || relation || ' autorisé=' || allowed from public.find_member('bob');
select 'A cherche « chloe » (mineure) : autorisé=' || allowed from public.find_member('CHLOE');
select 'A cherche « inconnu » : ' || count(*) from public.find_member('inconnu');
select 'A → Bob : ' || public.send_friend_request(:'B'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select public.send_friend_request(:'C'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select public.send_friend_request(:'D'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.friendships values (least(:'A'::uuid, :'C'::uuid), greatest(:'A'::uuid, :'C'::uuid), :'A', 'accepted'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select 'B voit le profil d''Alice (demande en cours) : ' || count(*) from public.member_profiles(array[:'A'::uuid]);
select 'compteurs B : ' || friend_requests || ' demande(s)' from public.my_counters();
select public.accept_friend(:'A'); select 'B ami avec A : ' || public.is_friend(:'B', :'A'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
select 'C voit le profil d''Alice (aucun lien) : ' || count(*) from public.member_profiles(array[:'A'::uuid]); rollback;

\echo '--- avatars'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'A voit les avatars : ' || string_agg(left(name, 8), ',') from storage.objects; rollback;

\echo '--- messages'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (recipient, body) values (:'B', 'Salut Bob ! Tu as vu Frieren ?'); select 'A → B envoyé'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (recipient, body) values (:'C', 'coucou'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (recipient, body) values (:'B', 'espèce de connard'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (sender, recipient, body) values (:'B', :'A', 'faux expéditeur'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select 'B non-lus : ' || messages from public.my_counters();
update public.messages set read_at = now() where recipient = :'B'; select 'B non-lus après lecture : ' || messages from public.my_counters();
update public.messages set body = 'modifié' where recipient = :'B'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
select 'C voit les messages A/B : ' || count(*) from public.messages; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (recipient, body) select :'B', 'spam ' || g from generate_series(1, 25) g; rollback;

\echo '--- listes'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.lists (id, name) values ('11111111-0000-0000-0000-000000000001', 'Privée'), ('11111111-0000-0000-0000-000000000002', 'Partagée'), ('11111111-0000-0000-0000-000000000003', 'Commune');
update public.lists set visibility = 'friends' where id = '11111111-0000-0000-0000-000000000002';
insert into public.list_items (list_id, user_id, anime_id) values ('11111111-0000-0000-0000-000000000001', :'A', 1), ('11111111-0000-0000-0000-000000000002', :'A', 2), ('11111111-0000-0000-0000-000000000003', :'A', 3);
insert into public.list_members (list_id, user_id) values ('11111111-0000-0000-0000-000000000003', :'B'); select 'A a créé 3 listes, Bob membre de « Commune »'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.list_members (list_id, user_id) values ('11111111-0000-0000-0000-000000000001', :'C'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select 'B voit les listes : ' || string_agg(name, ', ' order by name) from public.lists;
select 'B voit les titres : ' || string_agg(anime_id::text, ',' order by anime_id) from public.list_items;
insert into public.list_items (list_id, user_id, anime_id) values ('11111111-0000-0000-0000-000000000003', :'A', 99);
select 'B a ajouté 99 dans « Commune », ajouté par B : ' || (added_by = :'B') from public.list_items where anime_id = 99; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
insert into public.list_items (list_id, user_id, anime_id) values ('11111111-0000-0000-0000-000000000002', :'A', 98); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
update public.lists set name = 'Piratée' where id = '11111111-0000-0000-0000-000000000003'; select 'B renomme « Commune » : ' || count(*) || ' ligne(s)' from public.lists where name = 'Piratée'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
select 'C voit les listes d''Alice : ' || count(*) from public.lists; select 'C voit les titres : ' || count(*) from public.list_items; rollback;

\echo '--- suggestions'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
insert into public.feedback (kind, body, page) values ('idee', 'Un mode clair serait top', '#/'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
insert into public.feedback (body, status, user_unread) values ('je triche sur le statut', 'clos', true); select 'statut forcé ignoré : ' || status from public.feedback where body like 'je triche%'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select 'B voit les suggestions de C : ' || count(*) from public.feedback; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select * from public.admin_feedback(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin : ' || count(*) || ' suggestion(s), de ' || max(username) from public.admin_feedback();
select 'compteur admin : ' || admin_feedback from public.my_counters();
insert into public.feedback_replies (feedback_id, body) select id, 'Merci, c''est noté !' from public.feedback; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true);
select 'C : réponse non lue=' || feedback_replies from public.my_counters();
select 'C voit : ' || string_agg(body || ' (admin=' || from_admin || ')', ' | ') from public.feedback_replies;
insert into public.feedback_replies (feedback_id, body, from_admin) select id, 'Merci à toi', true from public.feedback;
select 'réponse de C marquée admin ? ' || bool_or(from_admin) from public.feedback_replies where body = 'Merci à toi';
select public.mark_feedback_read(); select 'C après lecture : ' || feedback_replies from public.my_counters(); commit;

\echo '--- signalements et blocage'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
insert into public.reports (message_id, reason) select id, 'Message déplacé' from public.messages limit 1; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin voit : ' || reporter_name || ' signale ' || target_name || ' : « ' || excerpt || ' »' from public.admin_reports(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'B', true);
select public.block_user(:'A'); select 'après blocage, ami ? ' || public.is_friend(:'A', :'B'); select 'membre de « Commune » ? ' || count(*) from public.list_members; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.messages (recipient, body) values (:'B', 'tu es là ?'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'A cherche Bob après blocage : ' || count(*) from public.find_member('Bob'); rollback;
begin; set local role anon; select count(*) from public.messages; rollback;
begin; set local role anon; select count(*) from public.feedback; rollback;
\echo '--- suppression de compte'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'C', true); select public.delete_my_account(); commit;
select 'après suppression de C : suggestions ' || (select count(*) from public.feedback) || ', réponses ' || (select count(*) from public.feedback_replies);
