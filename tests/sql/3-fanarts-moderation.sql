\echo '=== FAN ARTS'
\set E 'eeeeeeee-0000-0000-0000-000000000005'
\set F 'ffffffff-0000-0000-0000-000000000006'
\set A 'aaaaaaaa-0000-0000-0000-000000000001'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.fanarts (id, path, title, character_id, status) values ('99999999-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000006/11111111-2222-3333-4444-555555555555.webp', 'Frieren au coucher du soleil', 123, 'approved');
select 'F publie, statut forcé : ' || status from public.fanarts; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.fanarts (path, title) values ('eeeeeeee-0000-0000-0000-000000000005/11111111-2222-3333-4444-555555555555.webp', 'dossier d''un autre'); rollback;
begin; set local role anon; select 'anon voit (en attente) : ' || count(*) from public.fanarts; select 'anon liste : ' || count(*) from public.fanarts_list(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select 'E voit : ' || count(*) from public.fanarts; insert into public.fanart_likes (fanart_id) values ('99999999-0000-0000-0000-000000000001'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'F voit le sien via liste perso : ' || count(*) || ' ' || max(status) from public.fanarts_list(p_user => :'F');
update public.fanarts set status = 'approved'; select 'F tente de valider : ' || status from public.fanarts; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin file : ' || count(*) from public.admin_fanarts(); select 'badge : ' || public.admin_pending_fanarts();
update public.fanarts set status = 'approved'; select 'admin valide : ' || status || ' revu=' || (reviewed_at is not null) from public.fanarts; commit;
begin; set local role anon; select 'anon liste après validation : ' || count(*) || ' par ' || max(username) from public.fanarts_list(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.fanart_likes (fanart_id) values ('99999999-0000-0000-0000-000000000001');
select 'E aime : likes=' || likes || ' liked=' || liked from public.fanarts_list(p_sort => 'top');
insert into public.reports (fanart_id, reason) values ('99999999-0000-0000-0000-000000000001', 'test'); select 'signalé'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set title = 'Frieren et Fern'; select 'F modifie le titre → ' || status from public.fanarts; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set title = 'Una ilustración muy bonita de la serie que es mi favorita y es muy buena'; rollback;
\echo '--- partage dans un chat mixte'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.messages (recipient, body) values (:'E', '[[fanart:99999999-0000-0000-0000-000000000001]] [[perso:123456]] [[anime:154587]]'); select 'jetons acceptés dans chat mixte'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin_reports fanart : ' || count(*) filter (where fanart_id is not null) from public.admin_reports(); rollback;
\echo '--- faux positifs langue (tous null attendus)'
select coalesce(public.language_problem(x), 'ok') from unnest(array[
 'Il y a des moments où la série est vraiment lente mais la fin est géniale, je la conseille',
 'Mi-temps de la saison : tu as su que le studio allait changer ? Non mais sérieux',
 'I loved it, the animation is beautiful and the soundtrack by Hiroyuki Sawano is amazing',
 'Das ist la meilleure scène, Luffy est trop fort, la mise en scène est folle',
 'Attack on Titan (進撃の巨人) est un chef-d''œuvre absolu',
 'Mdr trop bien cet épisode 😂😂 vivement la suite',
 'Ok', 'lol', 'Sasuke kun ! Dattebayo !'
]) x;
\echo '--- crédit et pseudos décorés'
select 'langue « ˚˖𓍢ִ໋❀𝓜𝓪𝓴𝓸𝓽𝓸 » : ' || coalesce(public.language_problem('Dessin de ˚˖𓍢ִ໋❀𝓜𝓪𝓴𝓸𝓽𝓸'), 'ok');
select 'russe : ' || coalesce(public.language_problem('Очень хорошее аниме'), 'ok');
select 'mot interdit stylisé : ' || public.has_forbidden_word('𝓬𝓸𝓷𝓷𝓪𝓻𝓭');
select 'normalize : ' || public.normalize_text('𝓜𝓪𝓴𝓸𝓽𝓸 ｍａｋｏｔｏ');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set credit = '˚˖𓍢ִ໋❀𝓜𝓪𝓴𝓸𝓽𝓸'; select 'crédit enregistré : ' || credit || ' → ' || status from public.fanarts; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set credit = 'instagram.com/makoto'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'liste avec crédit : ' || count(credit is null) from public.fanarts_list(); rollback;
\echo '--- source'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set source_url = 'https://www.pinterest.fr/pin/123456/'; select 'source pinterest : ' || source_url || ' → ' || status from public.fanarts; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set source_url = 'https://www.deviantart.com/makoto/art/frieren-987'; select 'source deviantart OK'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set source_url = 'https://site-douteux.com/x'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set source_url = 'http://pinterest.com/x'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
update public.fanarts set source_url = 'https://evilpinterest.com/x'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.fanarts (id, path, title) values ('99999999-0000-0000-0000-000000000002', 'ffffffff-0000-0000-0000-000000000006/22222222-2222-3333-4444-555555555555.webp', 'Envoyé du chat');
select 'auteur voit son fan art en attente par id : ' || count(*) || ' ' || max(status) from public.fanarts_list(p_ids => array['99999999-0000-0000-0000-000000000002'::uuid]); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select 'destinataire ne le voit pas encore : ' || count(*) from public.fanarts_list(p_ids => array['99999999-0000-0000-0000-000000000002'::uuid]); rollback;
\echo '--- tags et 18+'
\set B 'bbbbbbbb-0000-0000-0000-000000000002'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.fanarts (id, path, title, tags, adult) values ('99999999-0000-0000-0000-0000000000a1', 'eeeeeeee-0000-0000-0000-000000000005/33333333-2222-3333-4444-555555555555.webp', 'Ecchi Nami', array['#Ecchi','One Piece','18+','one piece','x'], true);
select 'E (majeure) publie 18+ : tags=' || array_to_string(tags, '|') || ' adult=' || adult from public.fanarts where id = '99999999-0000-0000-0000-0000000000a1'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.fanarts (path, title, adult) values ('ffffffff-0000-0000-0000-000000000006/44444444-2222-3333-4444-555555555555.webp', 'mineur 18+', true); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
update public.fanarts set status = 'approved' where id = '99999999-0000-0000-0000-0000000000a1'; commit;
begin; set local role anon; select 'visiteur voit 18+ : ' || count(*) from public.fanarts where adult; select 'visiteur liste 18+ : ' || count(*) from public.fanarts_list(p_tag => '18+'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'mineur voit 18+ (table/liste/tags) : ' || (select count(*) from public.fanarts where adult) || '/' || (select count(*) from public.fanarts_list() where adult) || '/' || (select count(*) from public.fanart_tags_top() where tag = 'ecchi'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'majeur voit 18+ : ' || count(*) from public.fanarts_list(p_tag => '18+'); select 'filtre tag one piece : ' || count(*) from public.fanarts_list(p_tag => 'one piece'); select 'tags top : ' || string_agg(tag || '=' || uses, ',') from public.fanart_tags_top(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.messages (recipient, body) values (:'F', '[[fanart:99999999-0000-0000-0000-0000000000a1]]'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.fanart_likes (fanart_id) values ('99999999-0000-0000-0000-0000000000a1'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
update public.fanarts set adult = false where id = '99999999-0000-0000-0000-0000000000a1'; select 'retrait 18+ → ' || status from public.fanarts where id = '99999999-0000-0000-0000-0000000000a1'; rollback;
\echo '--- images de conversation'
-- A et E amis majeurs (B a bloqué A plus haut) ; E (majeure) et F (mineur) amis
insert into public.friendships values (least(:'A'::uuid, :'E'::uuid), greatest(:'A'::uuid, :'E'::uuid), :'A', 'accepted');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
insert into public.chat_images (id, recipient, path) values ('77777777-0000-0000-0000-000000000001', :'E', 'aaaaaaaa-0000-0000-0000-000000000001/77777777-0000-0000-0000-000000000001.webp');
select 'majeur → majeur : ' || status from public.chat_images where id = '77777777-0000-0000-0000-000000000001';
insert into public.messages (recipient, body) values (:'E', '[[image:77777777-0000-0000-0000-000000000001]]'); select 'message image envoyé'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
insert into public.chat_images (id, recipient, path, status) values ('77777777-0000-0000-0000-000000000002', :'F', 'eeeeeeee-0000-0000-0000-000000000005/77777777-0000-0000-0000-000000000002.webp', 'approved');
select 'majeur → mineur (statut forcé ignoré) : ' || status from public.chat_images where id = '77777777-0000-0000-0000-000000000002';
insert into public.messages (recipient, body) values (:'F', '[[image:77777777-0000-0000-0000-000000000002]]'); select 'jeton image accepté dans chat mixte'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'mineur voit la ligne : ' || count(*) || ', peut lire le fichier : ' || public.can_read_chat_image('eeeeeeee-0000-0000-0000-000000000005/77777777-0000-0000-0000-000000000002.webp') from public.chat_images where id = '77777777-0000-0000-0000-000000000002';
update public.chat_images set status = 'approved'; select 'mineur tente de valider : ' || status from public.chat_images where id = '77777777-0000-0000-0000-000000000002'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.messages (recipient, body) values (:'E', '[[image:77777777-0000-0000-0000-000000000002]]'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.chat_images (recipient, path) values (:'A', 'ffffffff-0000-0000-0000-000000000006/77777777-0000-0000-0000-000000000003.webp'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin file : ' || count(*) || ' (' || max(sender_name) || ' → ' || max(recipient_name) || ')' from public.admin_chat_images(); select 'badge : ' || public.admin_pending_chat_images();
update public.chat_images set status = 'approved' where id = '77777777-0000-0000-0000-000000000002'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'mineur après validation, fichier lisible : ' || public.can_read_chat_image('eeeeeeee-0000-0000-0000-000000000005/77777777-0000-0000-0000-000000000002.webp'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select 'E (destinataire) voit l''image de A : ' || count(*) || ' lisible ' || public.can_read_chat_image('aaaaaaaa-0000-0000-0000-000000000001/77777777-0000-0000-0000-000000000001.webp') from public.chat_images where id = '77777777-0000-0000-0000-000000000001';
select 'galerie contient des images de chat : ' || count(*) from public.fanarts_list() where path like '%77777777%'; rollback;
\echo '--- signalements manuels'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.reports (target_user, category, reason, with_context) values (:'E', 'contournement', 'Il m''a donné son pseudo d''un autre jeu en épelant', true);
select 'membre signalé avec contexte'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.reports (target_user, reason, auto, excerpt) values (:'E', 'faux auto', true, 'texte inventé'); select 'faux auto → auto=' || auto from public.reports where reason = 'faux auto'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
insert into public.reports (target_user, reason) values (:'F', 'moi-même'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin : urgent=' || urgent || ' contexte=' || with_context || ' motif=' || category || E'\n' || excerpt from public.admin_reports() where category = 'contournement';
select 'ordre : ' || string_agg(coalesce(category, '-') || (case when urgent then '!' else '' end), ', ') from (select * from public.admin_reports() where not handled limit 5) x; rollback;
\echo '--- âge minimum 15 ans'
\set G '99999999-9999-0000-0000-000000000007'
insert into auth.users (id, email, raw_user_meta_data) values (:'G', 'g@ex.com', '{"username":"Gabin","birth_year":"2013"}');
select 'inscription 13 ans : année enregistrée ? ' || count(birth_year) || ', pseudo gardé : ' || max(username) from public.profiles where user_id = :'G';
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
update public.profiles set birth_year = 2013 where user_id = :'G'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
update public.profiles set birth_year = 2011 where user_id = :'G'; select 'année 2011 (15 ans cette année) acceptée : ' || birth_year from public.profiles where user_id = :'G'; rollback;
-- compte existant de 13 ans (créé avant la règle)
alter table public.profiles disable trigger profiles_check;
delete from public.profiles where user_id = :'G';
insert into public.profiles (user_id, birth_year, username) values (:'G', 2013, 'Gabin');
alter table public.profiles enable trigger profiles_check;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
update public.profiles set username = 'Gabin2' where user_id = :'G'; select 'compte <15 change son pseudo : ' || username from public.profiles where user_id = :'G';
select 'peut ajouter E en ami : ' || allowed from public.find_member('Emma'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
insert into public.anime_comments (anime_id, body) values (5, 'Très bonne série vraiment'); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'G', true);
insert into public.collection_entries (user_id, anime_id, status) values (:'G', 1, 'watched'); select 'collection autorisée'; rollback;
\echo '--- modérateurs'
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select public.admin_set_moderator('Emma', true); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin nomme : ' || public.admin_set_moderator('emma', true); select public.admin_set_moderator('Felix', true); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select public.admin_set_moderator('emma', true); select 'liste : ' || string_agg(username, ',') from public.admin_moderators(); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select 'modo : staff=' || public.is_staff() || ' admin=' || public.is_admin();
select 'modo voit signalements : ' || count(*) || ', e-mails visibles : ' || count(reporter_email) from public.admin_reports();
select 'modo file fan arts : ' || count(*) from public.admin_fanarts('approved');
select 'modo images chat : ' || count(*) from public.admin_chat_images('approved');
select 'compteur signalements modo : ' || admin_reports || ', suggestions : ' || admin_feedback from public.my_counters(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select * from public.admin_list_users(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
select count(*) from public.admin_feedback(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'E', true);
update public.reports set handled = true; select 'modo traite : ' || count(*) || ' traités' from public.reports where handled; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'admin voit les e-mails : ' || count(reporter_email) from public.admin_reports(); select public.admin_set_moderator('emma', false); select 'retiré : ' || count(*) from public.admin_moderators(); commit;
\echo '--- notifications et activité'
\set H 'abababab-0000-0000-0000-000000000008'
\set I 'cdcdcdcd-0000-0000-0000-000000000009'
insert into auth.users (id, email, raw_user_meta_data) values (:'H', 'h@ex.com', '{"username":"Hugo","birth_year":"1992"}'), (:'I', 'i@ex.com', '{"username":"Ines","birth_year":"1994"}');
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true); select public.send_friend_request(:'I'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
select 'Inès notifiée : ' || string_agg(kind, ',') from public.notifications; select public.accept_friend(:'H'); commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'H', true);
select 'Hugo notifié : ' || string_agg(kind, ',') from public.notifications;
update public.notifications set read_at = now(); select 'lues : ' || count(read_at) from public.notifications;
insert into public.collection_entries (user_id, anime_id, status) values (:'H', 16498, 'watched'); select 'activité sans option : ' || count(*) from public.activity;
update public.profiles set share_activity = true where user_id = :'H';
insert into public.collection_entries (user_id, anime_id, status, rating, favorite) values (:'H', 21, 'watching', 5, true);
update public.collection_entries set status = 'watched' where anime_id = 21 and user_id = :'H';
select 'activité Hugo : ' || string_agg(kind || coalesce(':' || value, ''), ',' order by id) from public.activity; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'I', true);
select 'Inès voit : ' || string_agg(username || ' ' || kind, ', ') from public.friends_activity(); rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
select 'Alice (pas amie) voit : ' || count(*) from public.friends_activity(); select 'Alice lit les notifications d''Hugo : ' || count(*) from public.notifications where user_id = :'H'; rollback;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'A', true);
update public.fanarts set status = 'rejected' where id = '99999999-0000-0000-0000-000000000001'; commit;
begin; set local role authenticated; select set_config('request.jwt.claim.sub', :'F', true);
select 'Felix notifié : ' || string_agg(kind, ',') from public.notifications; rollback;
