\pset format unaligned
\set ON_ERROR_STOP 0
\set A 'aaaaaaaa-0000-0000-0000-000000000001'
\set E 'eeeeeeee-0000-0000-0000-000000000005'
\set F 'ffffffff-0000-0000-0000-000000000006'
\echo '=== SÉCURITÉ / AVIS'
insert into auth.users (id, email, raw_user_meta_data) values
 (:'E', 'e@ex.com', '{"username":"Emma","birth_year":"1988"}'), (:'F', 'f@ex.com', '{"username":"Felix","birth_year":"2010"}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select 'E cherche Felix (mineur) : autorisé=' || allowed || ' mixte=' || mixed from public.find_member('felix');
select 'E → Felix : ' || public.send_friend_request(:'F'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select public.accept_friend(:'E'); select 'profil mixte : ' || mixed from public.member_profiles(array[:'E'::uuid]); commit;
\echo '--- messages bloqués (attendus : contact_blocked x6)'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'ajoute moi sur snap'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'mon num 06 12 34 56 78'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'écris moi à emma@mail.fr'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'regarde https://exemple.com'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'viens sur Disc0rd'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.messages (recipient, body) values (:'E', 'tu as Instagram ?'); rollback;
\echo '--- messages normaux et à risque'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', 'Tu as aimé la saison 2 de Frieren ? La rencontre avec Fern est top');
insert into public.messages (recipient, body) values (:'F', 'Ne le dis à personne, c''est notre secret');
insert into public.messages (recipient, body) values (:'F', 'Tu habites où ?'); commit;
select 'signalements auto : ' || string_agg(category || '/' || (message_id is not null), ', ' order by category) from public.reports where auto;
\echo '--- entre majeurs : pas de filtre'
insert into public.messages (sender, recipient, body) select :'A', 'bbbbbbbb-0000-0000-0000-000000000002', 'ajoute moi sur snap';
\echo '--- avis'
begin; set local role anon; select 'anon lit : ' || count(*) from public.anime_comments_list(1); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.anime_comments (anime_id, body) values (1, 'Superbe série, l''animation est vraiment magnifique.');
select 'E a publié, liste : ' || string_agg(username || ' mine=' || mine, ',') from public.anime_comments_list(1); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.anime_comments (anime_id, body, spoiler) values (1, 'Great show, the ending of 葬送のフリーレン made me cry', true);
select 'F (anglais + titre japonais) OK'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.anime_comments (anime_id, body) values (1, 'deuxième avis'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.anime_comments set body = 'Es una serie muy buena pero el final es triste y no me gusta' where user_id = :'F'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.anime_comments set body = 'Das ist eine sehr gute Serie und ich mag die Musik auch' where user_id = :'F'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.anime_comments set body = 'Очень хорошее аниме' where user_id = :'F'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.anime_comments set body = 'とても面白いアニメでした。最終回は泣きました。また見たいです。' where user_id = :'F'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.anime_comments set body = 'Une série qui est vraiment bien, avec une fin que je n''attendais pas' where user_id = :'F';
select 'F modifie en français : ' || count(*) from public.anime_comments where body like 'Une série%';
update public.anime_comments set body = 'hack' where user_id = :'E'; select 'F modifie l''avis de E : 0 attendu → ' || count(*) from public.anime_comments where body = 'hack'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.reports (comment_id, reason) select id, 'Pas d''accord' from public.anime_comments where user_id = :'E'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin : ' || count(*) || ' signalement(s), dont avis ' || count(*) filter (where comment_id is not null) || ', auto ' || count(*) filter (where auto) from public.admin_reports();
delete from public.anime_comments where user_id = :'E'; select 'admin supprime avis : reste ' || count(*) from public.anime_comments; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'F voit les signalements : ' || count(*) from public.reports; rollback;
\echo '--- langue des messages'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.messages (recipient, body) values (:'E', 'Hola, es una serie muy buena pero no me gusta el final'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.messages (recipient, body) values (:'E', 'Non, tu es sûre ? Il est vraiment top, à voir ok'); select 'message français OK'; rollback;
