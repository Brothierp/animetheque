\echo '--- fausses dates de naissance'
\set A 'aaaaaaaa-0000-0000-0000-000000000001'
\set X 'abababab-0000-0000-0000-000000000008'
\set Y 'cdcdcdcd-0000-0000-0000-000000000009'
-- détection des indices d'âge
select 'indices : ' || string_agg(t || '=' || public.age_hint(t), ' | ' order by n) from (values
  (1, 'J''ai 13 ans et j''adore Frieren'), (2, 'jai 14ans mdr'), (3, 'Je suis en 4ème au collège'), (4, 'I''m 15 years old'),
  (5, 'J''ai 15 ans de retard sur cet anime'), (6, 'Quand j''avais 13 ans je regardais Naruto'), (7, 'I''m 15 minutes late'),
  (8, 'Je révise le brevet ce soir'), (9, 'Épisode 13 : les 100 ans de Frieren')) v(n, t);
-- un membre déclaré majeur écrit un indice : signalement automatique (un seul ouvert à la fois)
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
insert into public.messages (recipient, body) values (:'X', 'Au fait j''ai 14 ans, je suis en 3e');
insert into public.episode_posts (anime_id, episode, body) values (154587, 2, 'trop bien, au collège tout le monde regarde'); commit;
select 'signalements indice d''âge pour Inès : ' || count(*) || ' (' || string_agg(left(excerpt, 14), ', ') || ')' from public.reports where target_user = :'Y' and category = 'indice_age';
-- un membre ne peut pas se retirer le statut lui-même
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
update public.profiles set age_flag = null where user_id = :'Y'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'Y', true);
select public.admin_set_age_flag(:'X', 'minor'); rollback;
-- la modération (Alice, admin) traite Inès comme mineure
update public.profiles set public_profile = true where user_id = :'Y';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'Inès majeure avant : ' || (select adult from public.admin_age_flags(array[:'Y'::uuid]));
select public.admin_set_age_flag(:'Y', 'minor');
select 'après : majeure=' || (select adult from public.admin_age_flags(array[:'Y'::uuid])) || ' 15 ans et plus=' || public.old_enough(:'Y');
select 'état vu par la modération : ' || age_flag || ' majeure=' || adult from public.admin_age_flags(array[:'Y'::uuid]); commit;
select 'profil public d''Inès : ' || public_profile from public.profiles where user_id = :'Y';
select 'amitié Hugo / Inès (majeur / mineure) : ' || count(*) from public.friendships where :'Y' in (user_a, user_b) and :'X' in (user_a, user_b);
select 'notification à Inès : ' || kind || ' ' || ref from public.notifications where user_id = :'Y' and kind like 'age_flag%';
select 'nouvel indice (déjà traitée comme mineure) : ' || count(*) from public.reports where target_user = :'Y' and category = 'indice_age';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select public.admin_set_age_flag(:'Y', 'under15');
select 'moins de 15 ans : 15 ans et plus=' || public.old_enough(:'Y');
select public.admin_set_age_flag(:'Y', null);
select 'statut retiré : majeure=' || (select adult from public.admin_age_flags(array[:'Y'::uuid])); commit;
