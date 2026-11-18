\echo '--- jeu et communauté'
-- Hugo et Inès : majeurs et amis ; Hugo : majeure ; Gabin : 13 ans
\set X 'abababab-0000-0000-0000-000000000008'
\set Y 'cdcdcdcd-0000-0000-0000-000000000009'
\set Z 'aaaaaaaa-0000-0000-0000-000000000001'
\set M '99999999-9999-0000-0000-000000000007'
-- avis likés
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.anime_comments (id, anime_id, body) values ('77777777-0000-0000-0000-000000000001', 5114, 'Un chef-d''œuvre, la fin est parfaite.'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.comment_likes (comment_id) values ('77777777-0000-0000-0000-000000000001'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.comment_likes (comment_id) values ('77777777-0000-0000-0000-000000000001');
delete from public.comment_likes where comment_id = '77777777-0000-0000-0000-000000000001';
insert into public.comment_likes (comment_id) values ('77777777-0000-0000-0000-000000000001');
select 'avis vu par Inès : ' || likes || ' like(s), liké=' || liked from public.anime_comments_list(5114); commit;
select 'notifications « like » pour Hugo : ' || count(*) from public.notifications where user_id = :'X' and kind = 'comment_like';
begin; set local role anon; select 'avis vu sans compte : ' || likes || ' like(s), liké=' || liked from public.anime_comments_list(5114); rollback;

-- notes de la communauté (3 membres minimum)
insert into public.collection_entries (user_id, anime_id, favorite, rating, status) values
  (:'X', 5114, true, 5, 'watched'), (:'Y', 5114, false, 4, 'watched');
select 'stats à 2 membres : note=' || coalesce(avg_rating::text, 'masquée') || ' membres=' || members from public.community_stats(5114);
insert into public.collection_entries (user_id, anime_id, favorite, rating, status) values (:'Z', 5114, true, 3, 'watching');
select 'stats à 3 membres : note=' || avg_rating || ' (' || ratings || ' notes, ' || favorites || ' cœurs)' from public.community_stats(5114);
select 'top de la semaine : ' || string_agg(anime_id || ' (' || members || ' membres)', ', ') from public.community_top_week(5);

-- adorés par les amis (Hugo et Inès sont amis) : seulement si l'ami partage son activité
update public.profiles set share_activity = false where user_id = :'X';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
select 'Inès, amis (partage désactivé) : ' || count(*) from public.friends_loved(); rollback;
update public.profiles set share_activity = true where user_id = :'X';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
select 'Inès, amis (partage activé) : ' || string_agg(anime_id || ' par ' || names, ', ') from public.friends_loved(); rollback;

-- sondage de saison
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.season_votes (season, anime_id) values (public.current_season_key(), 154587);
update public.season_votes set anime_id = 21 where user_id = :'X'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.season_votes (season, anime_id) values (public.current_season_key(), 21); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.season_votes (season, anime_id) values ('2001-WINTER', 21); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'M', true);
insert into public.season_votes (season, anime_id) values (public.current_season_key(), 21); rollback;
begin; set local role anon; select 'sondage : ' || string_agg(anime_id || '=' || votes, ', ') from public.season_poll(public.current_season_key()); rollback;

-- quiz de la semaine
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.quiz_scores (week, score, total, ms) values (public.current_week_key(), 8, 10, 95000); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.quiz_scores (week, score, total, ms) values (public.current_week_key(), 10, 10, 1000); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.quiz_scores (week, score, total, ms) values ('2001-W01', 10, 10, 1000); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.quiz_scores (week, score, total, ms) values (public.current_week_key(), 12, 10, 1000); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.quiz_scores (week, score, total, ms) values (public.current_week_key(), 10, 10, 120000); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
select 'classement : ' || string_agg(rank || '. ' || username || ' ' || score || '/' || total || case when me then ' (moi)' when friend then ' (ami)' else '' end, ' | ' order by rank) from public.quiz_board(public.current_week_key()); rollback;

-- objectif annuel et badges
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'X', true);
insert into public.user_goals (year, target) values (2027, 50);
update public.user_goals set target = 60 where year = 2027;
select 'objectif 2027 : ' || target from public.user_goals;
select 'badges Hugo : ' || public.my_achievements()::text; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
select 'objectifs vus par Inès : ' || count(*) from public.user_goals; rollback;
