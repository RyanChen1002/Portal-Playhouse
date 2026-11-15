-- Task 5: privileges and hardening of the profile API functions and private tables.
begin;
create extension if not exists pgtap with schema extensions;

select plan(43);

-- Functions exist with the expected signatures
select has_function('public', 'get_me', array[]::text[], 'public.get_me() exists');
select has_function('public', 'update_me', array['text', 'text'], 'public.update_me(text, text) exists');
select has_function('public', 'check_display_name', array['text'], 'public.check_display_name(text) exists');

-- SECURITY DEFINER with an empty search_path
select is((select prosecdef from pg_proc where oid = 'public.get_me()'::regprocedure), true, 'get_me is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.update_me(text, text)'::regprocedure), true, 'update_me is SECURITY DEFINER');
select is((select prosecdef from pg_proc where oid = 'public.check_display_name(text)'::regprocedure), true, 'check_display_name is SECURITY DEFINER');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.get_me()'::regprocedure),
  'get_me has an empty search_path');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.update_me(text, text)'::regprocedure),
  'update_me has an empty search_path');
select ok((select 'search_path=""' = any (proconfig) from pg_proc where oid = 'public.check_display_name(text)'::regprocedure),
  'check_display_name has an empty search_path');

-- Execute grants: PUBLIC revoked, explicit grants only
select ok(not exists (select 1 from pg_proc p, aclexplode(p.proacl) a
                      where p.oid in ('public.get_me()'::regprocedure, 'public.update_me(text, text)'::regprocedure,
                                      'public.check_display_name(text)'::regprocedure)
                        and a.grantee = 0),
  'PUBLIC has no execute on the API functions');
select ok(not has_function_privilege('anon', 'public.get_me()', 'execute'), 'anon cannot execute get_me');
select ok(not has_function_privilege('anon', 'public.update_me(text, text)', 'execute'), 'anon cannot execute update_me');
select ok(has_function_privilege('anon', 'public.check_display_name(text)', 'execute'), 'anon can execute check_display_name');
select ok(has_function_privilege('authenticated', 'public.get_me()', 'execute'), 'authenticated can execute get_me');
select ok(has_function_privilege('authenticated', 'public.update_me(text, text)', 'execute'), 'authenticated can execute update_me');
select ok(has_function_privilege('authenticated', 'public.check_display_name(text)', 'execute'), 'authenticated can execute check_display_name');

-- No private helper function is executable by client roles
select is(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private'
      and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))),
  0::bigint, 'anon and authenticated cannot execute any private function');
select ok(not has_schema_privilege('anon', 'private', 'usage'), 'anon has no usage on private');
select ok(not has_schema_privilege('authenticated', 'private', 'usage'), 'authenticated has no usage on private');

-- Test user
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'd1@example.test', '{"display_name":"Dana"}');

-- ===========================================================================
-- As anon (signed out)
-- ===========================================================================
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select throws_ok('select public.get_me()', '42501', null, 'anon: get_me is denied');
select throws_ok($$select public.update_me(avatar_id => 'avatar-02')$$, '42501', null, 'anon: update_me is denied');
select throws_ok('select public.update_me()', '42501', null, 'anon: update_me() is denied');
select lives_ok($$select public.check_display_name('x')$$, 'anon: check_display_name succeeds');
select is(public.check_display_name('DANA'), '{"available": false}'::jsonb, 'anon: taken name is unavailable');
select is(public.check_display_name('Free Name'), '{"available": true}'::jsonb, 'anon: free name is available');
select throws_ok('select * from private.profiles', '42501', null, 'anon: select private.profiles is denied');
select throws_ok('select * from private.avatars', '42501', null, 'anon: select private.avatars is denied');
select throws_ok($$update private.profiles set avatar_id = 'avatar-02'$$, '42501', null, 'anon: update private.profiles is denied');
select throws_ok($$select private.normalize_display_name('x')$$, '42501', null, 'anon: private functions are denied');

-- ===========================================================================
-- As authenticated (Dana)
-- ===========================================================================
reset role;
set local role authenticated;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-0000-0000-0000000000d1', 'role', 'authenticated')::text, true);

select throws_ok('select * from private.profiles', '42501', null, 'authenticated: select private.profiles is denied');
select throws_ok($$update private.profiles set avatar_id = 'avatar-02' where id = auth.uid()$$, '42501', null,
  'authenticated: update private.profiles is denied');
select throws_ok($$insert into private.profiles (id, display_name) values (auth.uid(), 'x')$$, '42501', null,
  'authenticated: insert private.profiles is denied');
select throws_ok('delete from private.profiles', '42501', null, 'authenticated: delete private.profiles is denied');
select throws_ok('select * from private.avatars', '42501', null, 'authenticated: select private.avatars is denied');
select throws_ok($$insert into private.avatars (id) values ('avatar-99')$$, '42501', null,
  'authenticated: insert private.avatars is denied');
select throws_ok($$select private.normalize_display_name('x')$$, '42501', null,
  'authenticated: private functions are denied');
select lives_ok('select public.get_me()', 'authenticated: get_me succeeds');

-- Users cannot change their ID or wins: update_me has no such parameters
select throws_ok($$select public.update_me(id => gen_random_uuid())$$, '42883', null,
  'update_me has no id parameter');
select throws_ok($$select public.update_me(wins_total => 5)$$, '42883', null,
  'update_me has no wins parameter');
select is(public.update_me(avatar_id => 'avatar-03') ->> 'id', '00000000-0000-0000-0000-0000000000d1',
  'update_me keeps the caller id');
select is((public.update_me(avatar_id => 'avatar-04') -> 'winsTotal')::int, 0, 'winsTotal is always 0');

reset role;
select is((select count(*) from private.profiles where id = '00000000-0000-0000-0000-0000000000d1'), 1::bigint,
  'caller still has exactly one profile');
select is((select avatar_id from private.profiles where id = '00000000-0000-0000-0000-0000000000d1'), 'avatar-04',
  'only the permitted function changed the row');

select * from finish();
rollback;
