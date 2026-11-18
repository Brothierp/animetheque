-- Jeu et communauté : avis likés, notes de la communauté, top de la semaine, sondage de saison,
-- défi (quiz) de la semaine, objectif annuel, « adorés par tes amis » et compteurs pour les badges.
-- À exécuter après 20261117120000_push_service_grants.sql. Peut être relancé sans risque.
-- Les collections restent privées : seuls des totaux anonymes sont publiés (et seulement à partir de 3 membres).

-- ---------------------------------------------------------------------------
-- 1. Avis likés (« utile ») — un like par membre et par avis, notification à l'auteur
-- ---------------------------------------------------------------------------
create table if not exists public.comment_likes (
  comment_id uuid        not null references public.anime_comments (id) on delete cascade,
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
alter table public.comment_likes enable row level security;
revoke all on public.comment_likes from anon, authenticated;
grant select, insert, delete on public.comment_likes to authenticated;
drop policy if exists "likes avis: les siens" on public.comment_likes;
create policy "likes avis: les siens" on public.comment_likes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and exists (select 1 from public.anime_comments c where c.id = comment_id and c.user_id <> (select auth.uid())));

create or replace function public.comment_likes_notify() returns trigger
language plpgsql security definer set search_path = '' as $$
declare c public.anime_comments;
begin
  select * into c from public.anime_comments where id = new.comment_id;
  -- une seule notification par avis et par membre, même s'il retire puis remet son like
  if found and not public.is_blocked(c.user_id, new.user_id)
     and not exists (select 1 from public.notifications n where n.user_id = c.user_id and n.kind = 'comment_like' and n.actor = new.user_id and n.ref = c.anime_id::text) then
    perform public.notify(c.user_id, 'comment_like', new.user_id, c.anime_id::text);
  end if;
  return new;
end $$;
drop trigger if exists comment_likes_notify on public.comment_likes;
create trigger comment_likes_notify after insert on public.comment_likes for each row execute function public.comment_likes_notify();

-- Liste des avis : nombre de likes, « j'ai liké », les plus utiles d'abord (le tien en tête).
drop function if exists public.anime_comments_list(integer);
create function public.anime_comments_list(aid integer)
returns table (id uuid, body text, spoiler boolean, created_at timestamptz, updated_at timestamptz, user_id uuid, username text, mine boolean, likes bigint, liked boolean)
language sql stable security definer set search_path = '' as $$
  select c.id, c.body, c.spoiler, c.created_at, c.updated_at, c.user_id, coalesce(p.username, 'Membre'), c.user_id = (select auth.uid()),
         (select count(*) from public.comment_likes l where l.comment_id = c.id),
         exists (select 1 from public.comment_likes l where l.comment_id = c.id and l.user_id = (select auth.uid()))
  from public.anime_comments c left join public.profiles p on p.user_id = c.user_id
  where c.anime_id = aid
    and ((select auth.uid()) is null or not public.is_blocked((select auth.uid()), c.user_id))
  order by (c.user_id = (select auth.uid())) desc, 9 desc, c.created_at desc
  limit 200
$$;
revoke all on function public.anime_comments_list(integer) from public;
grant execute on function public.anime_comments_list(integer) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Notes de la communauté et top de la semaine (totaux anonymes)
-- ---------------------------------------------------------------------------
create or replace function public.community_stats(aid integer)
returns table (avg_rating numeric, ratings bigint, favorites bigint, members bigint)
language sql stable security definer set search_path = '' as $$
  select case when count(rating) >= 3 then round(avg(rating), 1) end,
         case when count(rating) >= 3 then count(rating) else 0 end,
         case when count(*) >= 3 then count(*) filter (where favorite) else 0 end,
         case when count(*) >= 3 then count(*) else 0 end
  from public.collection_entries where anime_id = aid
$$;
-- Les animés qui ont le plus bougé dans les collections ces 7 derniers jours (au moins 2 membres).
create or replace function public.community_top_week(p_limit integer default 20)
returns table (anime_id integer, members bigint, score bigint)
language sql stable security definer set search_path = '' as $$
  select anime_id, count(*), sum(1 + case when favorite then 3 else 0 end + case when rating >= 4 then 2 else 0 end
                                  + case when status in ('watching', 'watched') then 1 else 0 end)::bigint
  from public.collection_entries
  where updated_at > now() - interval '7 days'
  group by anime_id having count(*) >= 2
  order by 3 desc, 2 desc limit least(greatest(p_limit, 1), 50)
$$;
revoke all on function public.community_stats(integer), public.community_top_week(integer) from public;
grant execute on function public.community_stats(integer), public.community_top_week(integer) to anon, authenticated;

-- Adorés par tes amis : coups de cœur et notes 4-5 étoiles des amis qui partagent leur activité.
create or replace function public.friends_loved(p_limit integer default 20)
returns table (anime_id integer, friends bigint, names text)
language sql stable security definer set search_path = '' as $$
  select e.anime_id, count(distinct e.user_id), string_agg(distinct p.username, ', ')
  from public.collection_entries e join public.profiles p on p.user_id = e.user_id
  where (e.favorite or e.rating >= 4) and p.share_activity
    and e.user_id <> (select auth.uid()) and public.is_friend((select auth.uid()), e.user_id)
  group by e.anime_id
  order by 2 desc, max(e.updated_at) desc limit least(greatest(p_limit, 1), 50)
$$;
revoke all on function public.friends_loved(integer) from public;
grant execute on function public.friends_loved(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Sondage « animé de la saison » : un vote par membre et par saison, modifiable pendant la saison
-- ---------------------------------------------------------------------------
create or replace function public.current_season_key() returns text
language sql stable set search_path = '' as $$
  select to_char(now() at time zone 'Europe/Paris', 'YYYY') || '-' ||
         (array['WINTER', 'SPRING', 'SUMMER', 'FALL'])[(extract(month from now() at time zone 'Europe/Paris')::int - 1) / 3 + 1]
$$;
create table if not exists public.season_votes (
  season     text        not null check (season ~ '^\d{4}-(WINTER|SPRING|SUMMER|FALL)$'),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  anime_id   integer     not null check (anime_id > 0),
  created_at timestamptz not null default now(),
  primary key (season, user_id)
);
alter table public.season_votes enable row level security;
revoke all on public.season_votes from anon, authenticated;
grant select, insert, delete on public.season_votes to authenticated;
grant update (anime_id) on public.season_votes to authenticated;
drop policy if exists "votes: les siens" on public.season_votes;
create policy "votes: les siens" on public.season_votes for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and season = public.current_season_key() and public.old_enough((select auth.uid())));

create or replace function public.season_poll(p_season text)
returns table (anime_id integer, votes bigint)
language sql stable security definer set search_path = '' as $$
  select anime_id, count(*) from public.season_votes where season = p_season group by anime_id order by 2 desc, min(created_at) limit 30
$$;
revoke all on function public.season_poll(text) from public;
grant execute on function public.season_poll(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Défi de la semaine (quiz) : un essai par semaine, classement général et entre amis
-- ---------------------------------------------------------------------------
create or replace function public.current_week_key() returns text
language sql stable set search_path = '' as $$ select to_char(now() at time zone 'Europe/Paris', 'IYYY-"W"IW') $$;
create table if not exists public.quiz_scores (
  week       text        not null check (week ~ '^\d{4}-W\d{2}$'),
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  score      smallint    not null,
  total      smallint    not null check (total between 1 and 20),
  ms         integer     not null check (ms between 0 and 3600000),
  created_at timestamptz not null default now(),
  primary key (week, user_id),
  check (score between 0 and total)
);
alter table public.quiz_scores enable row level security;
revoke all on public.quiz_scores from anon, authenticated;
grant select, insert on public.quiz_scores to authenticated;
drop policy if exists "quiz: les siens" on public.quiz_scores;
drop policy if exists "quiz: un essai" on public.quiz_scores;
create policy "quiz: les siens" on public.quiz_scores for select to authenticated using (user_id = (select auth.uid()));
create policy "quiz: un essai" on public.quiz_scores for insert to authenticated
  with check (user_id = (select auth.uid()) and week = public.current_week_key());

-- Classement d'une semaine : les 20 meilleurs, plus toi et tes amis (pseudo uniquement).
create or replace function public.quiz_board(p_week text)
returns table (username text, score smallint, total smallint, ms integer, me boolean, friend boolean, rank bigint)
language sql stable security definer set search_path = '' as $$
  with r as (
    select q.user_id, coalesce(p.username, 'Membre') as username, q.score, q.total, q.ms,
           rank() over (order by q.score desc, q.ms) as rk
    from public.quiz_scores q left join public.profiles p on p.user_id = q.user_id
    where q.week = p_week)
  select username, score, total, ms, user_id = (select auth.uid()),
         (select auth.uid()) is not null and public.is_friend((select auth.uid()), user_id), rk
  from r
  where rk <= 20 or user_id = (select auth.uid()) or ((select auth.uid()) is not null and public.is_friend((select auth.uid()), user_id))
  order by rk, username limit 60
$$;
revoke all on function public.quiz_board(text) from public;
grant execute on function public.quiz_board(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Objectif annuel (« voir 50 animés en 2027 »)
-- ---------------------------------------------------------------------------
create table if not exists public.user_goals (
  user_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  year       smallint    not null check (year between 2020 and 2100),
  target     smallint    not null check (target between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (user_id, year)
);
alter table public.user_goals enable row level security;
revoke all on public.user_goals from anon, authenticated;
grant select, insert, delete on public.user_goals to authenticated;
grant update (target, updated_at) on public.user_goals to authenticated;
drop policy if exists "objectifs: les siens" on public.user_goals;
create policy "objectifs: les siens" on public.user_goals for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- 6. Compteurs pour les badges (ce que la collection seule ne dit pas)
-- ---------------------------------------------------------------------------
create or replace function public.my_achievements() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'reviews',  (select count(*) from public.anime_comments where user_id = (select auth.uid())),
    'likes',    (select count(*) from public.comment_likes l join public.anime_comments c on c.id = l.comment_id where c.user_id = (select auth.uid())),
    'fanarts',  (select count(*) from public.fanarts where user_id = (select auth.uid()) and status = 'approved'),
    'posts',    (select count(*) from public.episode_posts where user_id = (select auth.uid())),
    'friends',  (select count(*) from public.friendships where (select auth.uid()) in (user_a, user_b) and status = 'accepted'),
    'quizzes',  (select count(*) from public.quiz_scores where user_id = (select auth.uid())),
    'perfect',  (select count(*) from public.quiz_scores where user_id = (select auth.uid()) and score = total),
    'votes',    (select count(*) from public.season_votes where user_id = (select auth.uid())))
$$;
revoke all on function public.my_achievements() from public;
grant execute on function public.my_achievements() to authenticated;

-- La fonction « push » lit les notifications « like » comme les autres (droits déjà donnés en 20261117120000).
