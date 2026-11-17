\echo '--- discussions par épisode'
\set H 'abababab-0000-0000-0000-000000000008'
\set I 'cdcdcdcd-0000-0000-0000-000000000009'
\set G '99999999-9999-0000-0000-000000000007'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
insert into public.episode_posts (id, anime_id, episode, body) values ('eeeeeeee-1111-0000-0000-000000000001', 21, 7, 'Cet épisode est incroyable, la fin m''a surpris'); select 'Hugo publie sur l''épisode 7'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
insert into public.episode_posts (anime_id, episode, body, reply_to) values (21, 7, 'Pareil, je ne m''y attendais pas du tout !', 'eeeeeeee-1111-0000-0000-000000000001');
select 'fil épisode 7 : ' || string_agg(username || (case when reply_to is not null then ' (réponse)' else '' end), ', ' order by created_at) from public.episode_thread(21, 7); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
select 'Hugo notifié : ' || string_agg(kind || ' ' || ref, ',') from public.notifications where kind = 'episode_reply'; rollback;
begin; set local role anon; select 'visiteur lit : ' || count(*) from public.episode_thread(21, 7); select 'compteurs : ' || string_agg(episode || '=' || posts, ',') from public.episode_counts(21); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
insert into public.episode_posts (anime_id, episode, body) values (21, 7, 'Trop bien'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
insert into public.episode_posts (anime_id, episode, body) values (21, 8, 'Es una serie muy buena pero el final es triste'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
insert into public.reports (post_id, reason) values ('eeeeeeee-1111-0000-0000-000000000001', 'test'); select 'message signalé : ' || excerpt from public.reports where post_id is not null; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
delete from public.episode_posts where id = 'eeeeeeee-1111-0000-0000-000000000001'; select 'Inès supprime le message d''Hugo : ' || count(*) || ' restant(s)' from public.episode_posts where id = 'eeeeeeee-1111-0000-0000-000000000001'; rollback;
