-- Task 7: Portal Partners results tables, runtime functions, winsTotal and get_my_results.
-- Errors are pinned as sqlstate:message via the test-local pg_temp.err helper.
begin;
create extension if not exists pgtap with schema extensions;

select plan(57);

create function pg_temp.err(sql text)
returns text
language plpgsql
as $$
declare
  st text;
  msg text;
begin
  execute sql;
  return 'no error';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text;
  return st || ':' || msg;
end;
$$;

-- Users: A, B, C play; D has no results; X has a profile but is never a participant.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000e1', 'e1@example.test', '{"display_name":"Ann"}'),
  ('00000000-0000-0000-0000-0000000000e2', 'e2@example.test', '{"display_name":"Bob"}'),
  ('00000000-0000-0000-0000-0000000000e3', 'e3@example.test', '{"display_name":"Cat"}'),
  ('00000000-0000-0000-0000-0000000000e4', 'e4@example.test', '{"display_name":"Dan"}');

-- ---------------------------------------------------------------------------
-- Privileges and shape
-- ---------------------------------------------------------------------------
select has_table('private', 'portal_partners_results', 'results table exists');
select has_table('private', 'portal_partners_participants', 'participants table exists');
select has_function('public', 'get_runtime_profile', array['uuid'], 'get_runtime_profile exists');
select has_function('public', 'record_portal_partners_result',
  array['uuid', 'uuid[]', 'text', 'text', 'integer', 'timestamp with time zone', 'timestamp with time zone'],
  'record_portal_partners_result exists');
select has_function('public', 'get_my_results', array['integer', 'text'], 'get_my_results exists');

select ok((select relrowsecurity from pg_class where oid = 'private.portal_partners_results'::regclass),
  'RLS is enabled on results');
select ok((select relrowsecurity from pg_class where oid = 'private.portal_partners_participants'::regclass),
  'RLS is enabled on participants');
select ok(not has_table_privilege('anon', 'private.portal_partners_results', 'select'), 'anon cannot select results');
select ok(not has_table_privilege('authenticated', 'private.portal_partners_results', 'select'), 'authenticated cannot select results');
select ok(not has_table_privilege('anon', 'private.portal_partners_participants', 'select'), 'anon cannot select participants');
select ok(not has_table_privilege('authenticated', 'private.portal_partners_participants', 'select'), 'authenticated cannot select participants');

select ok(not has_function_privilege('anon', 'public.get_runtime_profile(uuid)', 'execute'), 'anon cannot execute get_runtime_profile');
select ok(not has_function_privilege('authenticated', 'public.get_runtime_profile(uuid)', 'execute'), 'authenticated cannot execute get_runtime_profile');
select ok(has_function_privilege('service_role', 'public.get_runtime_profile(uuid)', 'execute'), 'service_role can execute get_runtime_profile');
select ok(not has_function_privilege('anon',
  'public.record_portal_partners_result(uuid, uuid[], text, text, integer, timestamptz, timestamptz)', 'execute'),
  'anon cannot execute record_portal_partners_result');
select ok(not has_function_privilege('authenticated',
  'public.record_portal_partners_result(uuid, uuid[], text, text, integer, timestamptz, timestamptz)', 'execute'),
  'authenticated cannot execute record_portal_partners_result');
select ok(has_function_privilege('service_role',
  'public.record_portal_partners_result(uuid, uuid[], text, text, integer, timestamptz, timestamptz)', 'execute'),
  'service_role can execute record_portal_partners_result');
select ok(has_function_privilege('authenticated', 'public.get_my_results(integer, text)', 'execute'), 'authenticated can execute get_my_results');
select ok(not has_function_privilege('anon', 'public.get_my_results(integer, text)', 'execute'), 'anon cannot execute get_my_results');
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid in ('public.get_runtime_profile(uuid)'::regprocedure,
                                      'public.get_my_results(integer, text)'::regprocedure)
                        and a.grantee = 0),
  'PUBLIC has no execute on the new functions');

-- ---------------------------------------------------------------------------
-- get_runtime_profile (as service_role)
-- ---------------------------------------------------------------------------
set local role service_role;

select is(public.get_runtime_profile('00000000-0000-0000-0000-0000000000e1'),
  '{"id":"00000000-0000-0000-0000-0000000000e1","displayName":"Ann","avatarId":"avatar-01"}'::jsonb,
  'get_runtime_profile returns id, displayName and avatarId');
select is(pg_temp.err($$select public.get_runtime_profile('00000000-0000-0000-0000-00000000ffff')$$),
  'PT503:SERVICE_UNAVAILABLE', 'get_runtime_profile: unknown id is PT503');

-- ---------------------------------------------------------------------------
-- record_portal_partners_result: idempotency
-- ---------------------------------------------------------------------------
create temp table rec (n int, resp jsonb);
grant all on rec to service_role;

insert into rec select 1, public.record_portal_partners_result(
  '00000000-0000-0000-0000-00000000a001',
  array['00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e1']::uuid[],
  'win', null, 2, '2026-11-17T10:00:00Z', '2026-11-17T10:03:20.500Z');
insert into rec select 2, public.record_portal_partners_result(
  '00000000-0000-0000-0000-00000000a001',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[],
  'win', null, 2, '2026-11-17T10:00:00Z', '2026-11-17T10:03:20.500Z');

select ok((select resp ? 'resultId' and (select count(*) from jsonb_object_keys(resp)) = 1 from rec where n = 1),
  'first call returns {resultId}');
select is((select resp from rec where n = 2), (select resp from rec where n = 1), 'replay returns the same resultId');
select is((select count(*) from private.portal_partners_results where session_id = '00000000-0000-0000-0000-00000000a001'),
  1::bigint, 'replay leaves one result row');
select is((select count(*) from private.portal_partners_participants), 2::bigint, 'replay leaves two participant rows');

-- ---------------------------------------------------------------------------
-- record_portal_partners_result: validation
-- ---------------------------------------------------------------------------
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b001',
  array['00000000-0000-0000-0000-0000000000e1']::uuid[], 'win', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'one player is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b002',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e1']::uuid[], 'win', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'the same player twice is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b003',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000ffff']::uuid[], 'win', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'an unknown player is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b004',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'draw', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'outcome draw is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b005',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'cancelled', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'cancelled without a reason is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b006',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'win', 'left', 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'a win with a reason is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b007',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'win', null, 3, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'score 3 is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b008',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'win', null, 1,
  '2026-11-17T10:00:01Z', '2026-11-17T10:00:00Z')$$),
  'PT400:VALIDATION_ERROR', 'completion before start is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result('00000000-0000-0000-0000-00000000b009',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'cancelled', 'quit', 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'an unknown cancel reason is rejected');
select is(pg_temp.err($$select public.record_portal_partners_result(null,
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[], 'win', null, 1, now(), now())$$),
  'PT400:VALIDATION_ERROR', 'a null session id is rejected');
select is((select count(*) from private.portal_partners_results), 1::bigint, 'rejected calls wrote nothing');

-- ---------------------------------------------------------------------------
-- winsTotal: A+B win twice (a001, a002), lose once (a003), cancel once (a004).
-- B+C: one win (a005). D has nothing.
-- ---------------------------------------------------------------------------
select public.record_portal_partners_result('00000000-0000-0000-0000-00000000a002',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[],
  'win', null, 2, '2026-11-17T11:00:00Z', '2026-11-17T11:01:00Z');
select public.record_portal_partners_result('00000000-0000-0000-0000-00000000a003',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[],
  'loss', null, 1, '2026-11-17T12:00:00Z', '2026-11-17T12:02:00Z');
select public.record_portal_partners_result('00000000-0000-0000-0000-00000000a004',
  array['00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2']::uuid[],
  'cancelled', 'disconnected', 0, '2026-11-17T13:00:00Z', '2026-11-17T13:00:30Z');
select public.record_portal_partners_result('00000000-0000-0000-0000-00000000a005',
  array['00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000e3']::uuid[],
  'win', null, 2, '2026-11-17T14:00:00Z', '2026-11-17T14:01:00Z');

reset role;
set local role authenticated;

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);
select is(public.get_me() ->> 'winsTotal', '2', 'A: winsTotal counts two wins');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select is(public.get_me() ->> 'winsTotal', '3', 'B: winsTotal counts three wins, not the loss or cancellation');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e3","role":"authenticated"}', true);
select is(public.get_me() ->> 'winsTotal', '1', 'C: winsTotal is 1');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e4","role":"authenticated"}', true);
select is(public.get_me() ->> 'winsTotal', '0', 'D with no results has 0 wins');
select is(public.get_my_results(), '{"results": [], "nextCursor": null}'::jsonb, 'D has an empty history');

-- ---------------------------------------------------------------------------
-- get_my_results as A
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select is(jsonb_array_length(public.get_my_results() -> 'results'), 4, 'A sees four results (including the cancellation)');
select is((public.get_my_results() -> 'results' -> 0 ->> 'sessionId'), '00000000-0000-0000-0000-00000000a004',
  'newest result first');
select is((select jsonb_agg(r ->> 'sessionId') from jsonb_array_elements(public.get_my_results() -> 'results') r),
  '["00000000-0000-0000-0000-00000000a004","00000000-0000-0000-0000-00000000a003","00000000-0000-0000-0000-00000000a002","00000000-0000-0000-0000-00000000a001"]'::jsonb,
  'results are ordered newest first and exclude other players'' sessions');
select is(public.get_my_results() -> 'results' -> 0,
  jsonb_build_object(
    'id', public.get_my_results() -> 'results' -> 0 ->> 'id',
    'sessionId', '00000000-0000-0000-0000-00000000a004',
    'gameType', 'portal-partners',
    'outcome', 'cancelled',
    'cancelReason', 'disconnected',
    'score', 0,
    'startedAt', '2026-11-17T13:00:00.000Z',
    'completedAt', '2026-11-17T13:00:30.000Z',
    'durationSeconds', 30,
    'players', jsonb_build_array(
      jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e1', 'displayName', 'Ann', 'avatarId', 'avatar-01'),
      jsonb_build_object('id', '00000000-0000-0000-0000-0000000000e2', 'displayName', 'Bob', 'avatarId', 'avatar-01'))),
  'a result has the GameResult shape, ISO UTC timestamps and both player cards');
select is((public.get_my_results() -> 'results' -> 3 ->> 'durationSeconds'), '200',
  'durationSeconds is whole seconds (200.5 truncated)');
select is(public.get_my_results() -> 'results' -> 3 ->> 'cancelReason', null, 'cancelReason is null when not cancelled');
select is((public.get_my_results() -> 'nextCursor'), 'null'::jsonb, 'no nextCursor when everything fits');

create temp table pg1 as select public.get_my_results(1) as r;
select is(jsonb_array_length((select r -> 'results' from pg1)), 1, 'limit 1 returns one row');
select ok((select r ->> 'nextCursor' is not null from pg1), 'limit 1 returns a nextCursor');
select is(public.get_my_results(1, (select r ->> 'nextCursor' from pg1)) -> 'results' -> 0 ->> 'sessionId',
  '00000000-0000-0000-0000-00000000a003', 'following the cursor returns the next row');

select is(pg_temp.err($$select public.get_my_results(0)$$), 'PT400:VALIDATION_ERROR', 'limit 0 is rejected');
select is(pg_temp.err($$select public.get_my_results(51)$$), 'PT400:VALIDATION_ERROR', 'limit 51 is rejected');
select is(pg_temp.err($$select public.get_my_results(10, 'not-a-cursor')$$), 'PT400:VALIDATION_ERROR', 'a malformed cursor is rejected');

select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is(pg_temp.err($$select public.get_my_results()$$), 'PT401:UNAUTHORIZED', 'signed-out caller is PT401');
select is(pg_temp.err($$select * from private.portal_partners_results$$), '42501:permission denied for schema private',
  'authenticated cannot read results directly');

select * from finish();
rollback;
