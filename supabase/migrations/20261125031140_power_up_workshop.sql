-- Power-Up Workshop: the second game type, and the `error` cancel reason.
--
-- A round the engine cancels because game code threw is stored as cancelled with reason 'error'.
-- Widens game_results_cancel_reason_rule and record_game_result's check to allow it; the function
-- keeps its signature, owner, security definer, search_path and grants.

insert into private.game_types (game_type, score_max) values ('power-up-workshop', 6);

alter table private.game_results drop constraint game_results_cancel_reason_rule;
alter table private.game_results add constraint game_results_cancel_reason_rule
  check ((outcome = 'cancelled') = (cancel_reason is not null and cancel_reason in ('left', 'disconnected', 'error')));

-- Idempotent by session_id across all games: the unique constraint guarantees one row even under
-- concurrent retries. A replay returns the existing result id and writes nothing.
create or replace function public.record_game_result(
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
         and record_game_result.cancel_reason is distinct from 'disconnected'
         and record_game_result.cancel_reason is distinct from 'error')
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
