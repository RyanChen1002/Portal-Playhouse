-- Task 5: behavior of public.get_me, public.update_me and public.check_display_name.
-- Special characters are written only as U&'\XXXX' escapes.
-- Errors are pinned as sqlstate:message:hint via the test-local pg_temp.err_hint helper.
begin;
create extension if not exists pgtap with schema extensions;

select plan(46);

-- Runs sql and returns 'sqlstate:message:hint' for the error it raises, or 'no error'.
-- pg_temp functions are executable by the session, including after set local role.
create function pg_temp.err_hint(sql text)
returns text
language plpgsql
as $$
declare
  st text;
  msg text;
  h text;
begin
  execute sql;
  return 'no error';
exception when others then
  get stacked diagnostics st = returned_sqlstate, msg = message_text, h = pg_exception_hint;
  return st || ':' || msg || ':' || coalesce(h, '');
end;
$$;

-- Users (profiles come from the sign-up trigger)
-- A = Alex, B = Bea, C = Cy (never acted on), D = profile removed (SERVICE_UNAVAILABLE case)
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000c1', 'c1@example.test', '{"display_name":"Alex"}'),
  ('00000000-0000-0000-0000-0000000000c2', 'c2@example.test', '{"display_name":"Bea"}'),
  ('00000000-0000-0000-0000-0000000000c3', 'c3@example.test', '{"display_name":"Cy"}'),
  ('00000000-0000-0000-0000-0000000000c4', 'c4@example.test', '{"display_name":"Dee"}');
delete from private.profiles where id = '00000000-0000-0000-0000-0000000000c4';

-- Snapshot C's row to prove nobody else's update touches it.
create temp table c_before as
  select id, display_name, avatar_id, created_at from private.profiles
  where id = '00000000-0000-0000-0000-0000000000c3';
grant select on c_before to authenticated, anon;

-- ===========================================================================
-- As user A (Alex)
-- ===========================================================================
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);

select is(public.get_me(),
  jsonb_build_object('id', '00000000-0000-0000-0000-0000000000c1', 'displayName', 'Alex',
                     'avatarId', 'avatar-01', 'winsTotal', 0),
  'get_me returns the exact profile JSON for the caller');

select is(public.update_me(avatar_id => 'avatar-07'),
  jsonb_build_object('id', '00000000-0000-0000-0000-0000000000c1', 'displayName', 'Alex',
                     'avatarId', 'avatar-07', 'winsTotal', 0),
  'update_me(avatar_id) returns the updated profile');
select is(public.get_me(),
  jsonb_build_object('id', '00000000-0000-0000-0000-0000000000c1', 'displayName', 'Alex',
                     'avatarId', 'avatar-07', 'winsTotal', 0),
  'update_me(avatar_id) changes only the avatar');

-- Empty update
select throws_ok('select public.update_me()', 'PT400', 'VALIDATION_ERROR', 'update_me() is a validation error');
select is(pg_temp.err_hint('select public.update_me()'), 'PT400:VALIDATION_ERROR:',
  'update_me() carries no hint');
select is(pg_temp.err_hint('select public.update_me(display_name => null, avatar_id => null)'),
  'PT400:VALIDATION_ERROR:', 'update_me(null, null) is a validation error with no hint');

-- Invalid display names
select throws_ok($$select public.update_me(display_name => '')$$, 'PT400', 'VALIDATION_ERROR',
  'update_me(display_name => empty) is a validation error');
select is(pg_temp.err_hint($$select public.update_me(display_name => '')$$),
  'PT400:VALIDATION_ERROR:displayName', 'empty name: hint displayName');
select is(pg_temp.err_hint($$select public.update_me(display_name => '   ')$$),
  'PT400:VALIDATION_ERROR:displayName', 'whitespace-only name: hint displayName');
select is(pg_temp.err_hint(format('select public.update_me(display_name => %L)', U&'a\200Bb')),
  'PT400:VALIDATION_ERROR:displayName', 'zero-width space in name: hint displayName');
select is(pg_temp.err_hint(format('select public.update_me(display_name => %L)', repeat('a', 25))),
  'PT400:VALIDATION_ERROR:displayName', '25-character name: hint displayName');

-- Invalid avatar
select throws_ok($$select public.update_me(avatar_id => 'avatar-21')$$, 'PT400', 'VALIDATION_ERROR',
  'update_me(avatar_id => avatar-21) is a validation error');
select is(pg_temp.err_hint($$select public.update_me(avatar_id => 'avatar-21')$$),
  'PT400:VALIDATION_ERROR:avatarId', 'unknown avatar: hint avatarId');
select is(pg_temp.err_hint($$select public.update_me(avatar_id => '')$$),
  'PT400:VALIDATION_ERROR:avatarId', 'empty avatar: hint avatarId');

-- Review focus 1: changing the case of one's own name
select is(public.update_me(display_name => 'Alex') ->> 'displayName', 'Alex', 'owner can re-save own name');
select is(public.update_me(display_name => 'aLeX') ->> 'displayName', 'aLeX', 'owner can change case of own name');
select is(public.get_me() ->> 'displayName', 'aLeX', 'stored name becomes aLeX');

-- Review focus 2: nothing is partially applied
select is(pg_temp.err_hint($$select public.update_me(display_name => 'Fresh Name', avatar_id => 'avatar-99')$$),
  'PT400:VALIDATION_ERROR:avatarId', 'valid name + unknown avatar: hint avatarId');
select is(public.get_me(),
  jsonb_build_object('id', '00000000-0000-0000-0000-0000000000c1', 'displayName', 'aLeX',
                     'avatarId', 'avatar-07', 'winsTotal', 0),
  'failed update leaves name and avatar unchanged');
select is(pg_temp.err_hint($$select public.update_me(display_name => '', avatar_id => 'avatar-99')$$),
  'PT400:VALIDATION_ERROR:displayName', 'invalid name + unknown avatar: name is checked first');

-- Normalization on update
select is(public.update_me(display_name => U&'  Alex \3000  Smith ') ->> 'displayName', 'Alex Smith',
  'update_me stores the normalized name');

-- ===========================================================================
-- As user B (Bea)
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text, true);

select throws_ok($$select public.update_me(display_name => 'ALEX SMITH')$$, 'PT409', 'DISPLAY_NAME_TAKEN',
  'name owned by another user (different case) is taken');
select is(pg_temp.err_hint($$select public.update_me(display_name => 'ALEX SMITH')$$),
  'PT409:DISPLAY_NAME_TAKEN:displayName', 'taken name: hint displayName');
select is(pg_temp.err_hint($$select public.update_me(display_name => ' alex   smith ')$$),
  'PT409:DISPLAY_NAME_TAKEN:displayName', 'taken name is matched after normalizing');
select is(pg_temp.err_hint($$select public.update_me(display_name => 'alex smith', avatar_id => 'avatar-99')$$),
  'PT400:VALIDATION_ERROR:avatarId', 'taken name + unknown avatar: validation (400) before conflict (409)');
select is(public.get_me() ->> 'displayName', 'Bea', 'failed updates leave B unchanged');
select is(public.get_me() ->> 'avatarId', 'avatar-01', 'failed updates leave B avatar unchanged');

-- check_display_name
select is(public.check_display_name('  alex   smith '), '{"available": false}'::jsonb,
  'check_display_name: name held by another user is unavailable');
select is(public.check_display_name('Nobody Yet'), '{"available": true}'::jsonb,
  'check_display_name: unused name is available');
select is(public.check_display_name('BEA'), '{"available": true}'::jsonb,
  'check_display_name: own name (any case) is available');
select is(pg_temp.err_hint(format('select public.check_display_name(%L)', U&'a\200Bb')),
  'PT400:VALIDATION_ERROR:displayName', 'check_display_name: invalid name is a validation error');
select is(pg_temp.err_hint($$select public.check_display_name('')$$),
  'PT400:VALIDATION_ERROR:displayName', 'check_display_name: empty name is a validation error');
select is(pg_temp.err_hint('select public.check_display_name(null)'),
  'PT400:VALIDATION_ERROR:displayName', 'check_display_name: null is a validation error');

-- ===========================================================================
-- A renames; B can then claim the old name
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c1', 'role', 'authenticated')::text, true);
select is(public.check_display_name('ALEX smith'), '{"available": true}'::jsonb,
  'check_display_name: owner sees own name as available');
select is(public.update_me(display_name => 'Ada') ->> 'displayName', 'Ada', 'A renames to Ada');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c2', 'role', 'authenticated')::text, true);
select is(public.update_me(display_name => 'alex smith') ->> 'displayName', 'alex smith',
  'after the rename another user can claim the old name');

-- ===========================================================================
-- Signed in, but no usable identity / no profile
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
select is(pg_temp.err_hint('select public.get_me()'), 'PT401:UNAUTHORIZED:', 'get_me without sub: PT401');
select is(pg_temp.err_hint($$select public.update_me(avatar_id => 'avatar-02')$$), 'PT401:UNAUTHORIZED:',
  'update_me without sub: PT401');
select is(pg_temp.err_hint('select public.update_me()'), 'PT401:UNAUTHORIZED:',
  'update_me without sub: PT401 is checked before validation');
select is(public.check_display_name('ALEX SMITH'), '{"available": false}'::jsonb,
  'check_display_name without sub: any match is unavailable');

reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000c4', 'role', 'authenticated')::text, true);
select is(pg_temp.err_hint('select public.get_me()'), 'PT503:SERVICE_UNAVAILABLE:', 'get_me without profile: PT503');
select is(pg_temp.err_hint($$select public.update_me(avatar_id => 'avatar-02')$$), 'PT503:SERVICE_UNAVAILABLE:',
  'update_me without profile: PT503');

-- ===========================================================================
-- Isolation: other users' rows are never touched
-- ===========================================================================
reset role;
select is(
  (select row(display_name, avatar_id, created_at)::text from private.profiles
    where id = '00000000-0000-0000-0000-0000000000c3'),
  (select row(display_name, avatar_id, created_at)::text from c_before),
  'C row is unchanged by A and B updates');
select is(
  (select display_name || '/' || avatar_id from private.profiles where id = '00000000-0000-0000-0000-0000000000c1'),
  'Ada/avatar-07', 'A row holds only A''s own changes');
select is(
  (select display_name || '/' || avatar_id from private.profiles where id = '00000000-0000-0000-0000-0000000000c2'),
  'alex smith/avatar-01', 'B row holds only B''s own changes');
select is((select count(*) from private.profiles where id = '00000000-0000-0000-0000-0000000000c4'), 0::bigint,
  'update_me did not create a profile for a user without one');

select * from finish();
rollback;
