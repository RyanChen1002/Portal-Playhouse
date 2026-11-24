-- Game framework: one shared results table for every game (design 2026-11-23 §7).
--
-- Replaces the Portal Partners result tables and save function with shared ones:
--   private.game_types                -> one row per game type and its maximum score
--   private.game_results              -> one row per finished session, any game type
--   private.game_result_participants  -> the two players of each result
--   public.record_game_result(...)    -> service_role only (runtime, secret key)
-- get_my_results and get_me's winsTotal keep their output; gameType now comes from the row.
-- Existing Portal Partners rows are copied with their ids before the old objects are dropped.
--
-- Error transport is the pinned scheme: errcode PT400/PT401/PT503, message = bare code.
-- All changes are in this migration; earlier migrations stay unchanged.

-- ---------------------------------------------------------------------------
-- 1. Game types
-- ---------------------------------------------------------------------------

create table private.game_types (
  game_type text primary key,
  score_max smallint not null check (score_max >= 0)
);

insert into private.game_types (game_type, score_max) values ('portal-partners', 2);

alter table private.game_types enable row level security;
revoke all on private.game_types from anon, authenticated, public;
grant select, insert, update, delete on private.game_types to service_role;

-- ---------------------------------------------------------------------------
-- 2. Results
-- ---------------------------------------------------------------------------

-- The score's upper bound depends on the game type, so it is checked in record_game_result.
create table private.game_results (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  game_type text not null references private.game_types (game_type),
  session_id uuid not null,
  outcome text not null check (outcome in ('win', 'loss', 'cancelled')),
  cancel_reason text,
  score smallint not null check (score >= 0),
  started_at timestamptz not null,
  completed_at timestamptz not null,
  constraint game_results_session_id_key unique (session_id),
  constraint game_results_cancel_reason_rule
    check ((outcome = 'cancelled') = (cancel_reason is not null and cancel_reason in ('left', 'disconnected'))),
  constraint game_results_time_order check (completed_at >= started_at)
);

-- History is paged newest first by (completed_at, id).
create index game_results_completed_idx
  on private.game_results (completed_at desc, id desc);

alter table private.game_results enable row level security;
revoke all on private.game_results from anon, authenticated, public;
grant select, insert, update, delete on private.game_results to service_role;

-- ---------------------------------------------------------------------------
-- 3. Participants
-- ---------------------------------------------------------------------------

create table private.game_result_participants (
  result_id uuid not null references private.game_results (id) on delete cascade,
  player_id uuid not null references private.profiles (id) on delete cascade,
  primary key (result_id, player_id)
);

-- Per-player lookups: wins and history.
create index game_result_participants_player_idx
  on private.game_result_participants (player_id);

alter table private.game_result_participants enable row level security;
revoke all on private.game_result_participants from anon, authenticated, public;
grant select, insert, update, delete on private.game_result_participants to service_role;

-- ---------------------------------------------------------------------------
-- 4. Copy existing Portal Partners results, keeping their ids
-- ---------------------------------------------------------------------------

insert into private.game_results
  (id, game_type, session_id, outcome, cancel_reason, score, started_at, completed_at)
select id, 'portal-partners', session_id, outcome, cancel_reason, score, started_at, completed_at
from private.portal_partners_results;

insert into private.game_result_participants (result_id, player_id)
select result_id, player_id
from private.portal_partners_participants;

-- ---------------------------------------------------------------------------
-- 5. Shared JSON shapes and get_my_results read the shared tables
-- ---------------------------------------------------------------------------

-- winsTotal is derived from results (one per winning session the player took part in, any game).
create or replace function private.profile_json(p private.profiles)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p.id::text,
    'displayName', p.display_name,
    'avatarId', p.avatar_id,
    'winsTotal', (
      select pg_catalog.count(*)::int
      from private.game_result_participants pp
      join private.game_results r on r.id = pp.result_id
      where pp.player_id = p.id and r.outcome = 'win'
    )
  );
$$;

revoke execute on function private.profile_json(private.profiles) from public, anon, authenticated;

-- One GameResult (wire shape), with both participants' current cards ordered by player id.
create function private.result_json(r private.game_results)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', r.id::text,
    'sessionId', r.session_id::text,
    'gameType', r.game_type,
    'outcome', r.outcome,
    'cancelReason', r.cancel_reason,
    'score', r.score,
    'startedAt', pg_catalog.to_char(r.started_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'completedAt', pg_catalog.to_char(r.completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'durationSeconds', pg_catalog.floor(pg_catalog.date_part('epoch', r.completed_at - r.started_at))::int,
    'players', (
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', pr.id::text, 'displayName', pr.display_name, 'avatarId', pr.avatar_id)
        order by pr.id)
      from private.game_result_participants pp
      join private.profiles pr on pr.id = pp.player_id
      where pp.result_id = r.id
    )
  );
$$;

revoke execute on function private.result_json(private.game_results) from public, anon, authenticated;

-- The cursor is opaque: base64 of "<completed_at UTC, microseconds>|<result id>".
create or replace function public.get_my_results(result_limit int default 20, page_cursor text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  cursor_at timestamptz;
  cursor_id uuid;
  decoded text;
  page jsonb;
  has_more boolean;
  last_at timestamptz;
  last_id uuid;
  next_cursor text;
begin
  if uid is null then
    raise exception using errcode = 'PT401', message = 'UNAUTHORIZED',
      detail = 'You must be signed in.';
  end if;

  if get_my_results.result_limit is null or get_my_results.result_limit not between 1 and 50 then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'The limit must be between 1 and 50.', hint = 'limit';
  end if;

  if get_my_results.page_cursor is not null then
    begin
      decoded := pg_catalog.convert_from(pg_catalog.decode(get_my_results.page_cursor, 'base64'), 'UTF8');
      cursor_at := (pg_catalog.split_part(decoded, '|', 1) || '+00')::timestamptz;
      cursor_id := pg_catalog.split_part(decoded, '|', 2)::uuid;
    exception when others then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
        detail = 'The cursor is not valid.', hint = 'cursor';
    end;
  end if;

  select
    coalesce(pg_catalog.jsonb_agg(private.result_json(n.r) order by n.rn) filter (where n.rn <= get_my_results.result_limit), '[]'::jsonb),
    coalesce(pg_catalog.bool_or(n.rn > get_my_results.result_limit), false),
    (pg_catalog.array_agg(n.completed_at order by n.rn) filter (where n.rn <= get_my_results.result_limit))[get_my_results.result_limit],
    (pg_catalog.array_agg(n.id order by n.rn) filter (where n.rn <= get_my_results.result_limit))[get_my_results.result_limit]
  into page, has_more, last_at, last_id
  from (
    select r, r.completed_at, r.id, pg_catalog.row_number() over (order by r.completed_at desc, r.id desc) as rn
    from private.game_results r
    where r.id in (select pp.result_id from private.game_result_participants pp where pp.player_id = uid)
      and (cursor_at is null or (r.completed_at, r.id) < (cursor_at, cursor_id))
    order by r.completed_at desc, r.id desc
    limit get_my_results.result_limit + 1
  ) n;

  if has_more then
    next_cursor := pg_catalog.replace(pg_catalog.encode(pg_catalog.convert_to(
      pg_catalog.to_char(last_at at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS.US') || '|' || last_id::text,
      'UTF8'), 'base64'), E'\n', '');
  end if;

  return pg_catalog.jsonb_build_object('results', page, 'nextCursor', next_cursor);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. record_game_result (runtime only)
-- ---------------------------------------------------------------------------

-- Idempotent by session_id across all games: the unique constraint guarantees one row even under
-- concurrent retries. A replay returns the existing result id and writes nothing.
create function public.record_game_result(
  game_type text,
  session_id uuid,
  player_ids uuid[],
  outcome text,
  cancel_reason text,
  score int,
  started_at timestamptz,
  completed_at timestamptz
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  type_score_max smallint;
  new_id uuid;
  existing_id uuid;
begin
  select gt.score_max into type_score_max
  from private.game_types gt
  where gt.game_type = record_game_result.game_type;

  if type_score_max is null
     or record_game_result.session_id is null
     or record_game_result.player_ids is null
     or pg_catalog.cardinality(record_game_result.player_ids) <> 2
     or pg_catalog.array_position(record_game_result.player_ids, null) is not null
     or record_game_result.player_ids[1] = record_game_result.player_ids[2]
     or record_game_result.outcome is null
     or record_game_result.outcome not in ('win', 'loss', 'cancelled')
     or (record_game_result.outcome = 'cancelled'
         and record_game_result.cancel_reason is distinct from 'left'
         and record_game_result.cancel_reason is distinct from 'disconnected')
     or (record_game_result.outcome <> 'cancelled'
         and record_game_result.cancel_reason is not null)
     or record_game_result.score is null
     or record_game_result.score not between 0 and type_score_max
     or record_game_result.started_at is null
     or record_game_result.completed_at is null
     or record_game_result.completed_at < record_game_result.started_at
     or (select pg_catalog.count(*) from private.profiles p
         where p.id = any (record_game_result.player_ids)) <> 2
  then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'The result is not a valid game result.';
  end if;

  insert into private.game_results as r
    (game_type, session_id, outcome, cancel_reason, score, started_at, completed_at)
  values
    (record_game_result.game_type, record_game_result.session_id, record_game_result.outcome,
     record_game_result.cancel_reason, record_game_result.score,
     record_game_result.started_at, record_game_result.completed_at)
  on conflict on constraint game_results_session_id_key do nothing
  returning r.id into new_id;

  if new_id is not null then
    insert into private.game_result_participants (result_id, player_id)
    select new_id, pid from pg_catalog.unnest(record_game_result.player_ids) as pid;
    return pg_catalog.jsonb_build_object('resultId', new_id::text);
  end if;

  select r.id into existing_id
  from private.game_results r
  where r.session_id = record_game_result.session_id;

  return pg_catalog.jsonb_build_object('resultId', existing_id::text);
end;
$$;

revoke execute on function public.record_game_result(text, uuid, uuid[], text, text, int, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.record_game_result(text, uuid, uuid[], text, text, int, timestamptz, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Drop the old Portal Partners objects
-- ---------------------------------------------------------------------------

drop function public.record_portal_partners_result(uuid, uuid[], text, text, int, timestamptz, timestamptz);
drop function private.result_json(private.portal_partners_results);
drop table private.portal_partners_participants;
drop table private.portal_partners_results;
