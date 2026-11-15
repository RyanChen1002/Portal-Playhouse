-- Task 4: profile created automatically on sign-up; sign-up never fails over the name.
-- Special characters are written only as U&'\XXXX' escapes.
begin;
create extension if not exists pgtap with schema extensions;

select plan(15);

-- Trigger wiring and function hardening
select has_trigger('auth', 'users', 'on_auth_user_created', 'on_auth_user_created exists on auth.users');
select is(
  (select prosecdef from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
  true, 'handle_new_user is SECURITY DEFINER');
select ok(
  (select 'search_path=""' = any (proconfig) from pg_proc where oid = 'private.handle_new_user()'::regprocedure),
  'handle_new_user has an empty search_path');
select ok(not has_function_privilege('anon', 'private.handle_new_user()', 'execute'), 'anon cannot execute handle_new_user');
select ok(not has_function_privilege('authenticated', 'private.handle_new_user()', 'execute'), 'authenticated cannot execute handle_new_user');

-- Valid name is normalized
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'b1@example.test', '{"display_name":"  Grace   Hopper "}');
select is((select display_name from private.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'Grace Hopper', 'name is normalized');
select is((select avatar_id from private.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 'avatar-01', 'avatar defaults to avatar-01');

-- Missing metadata
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b2', 'b2@example.test');
select matches((select display_name from private.profiles where id = '00000000-0000-0000-0000-0000000000b2'), '^Player-[0-9a-f]{6}$', 'no metadata gives fallback name');

-- Invisible character in name
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b3', 'b3@example.test', jsonb_build_object('display_name', U&'a\200Bb'));
select matches((select display_name from private.profiles where id = '00000000-0000-0000-0000-0000000000b3'), '^Player-[0-9a-f]{6}$', 'invisible character gives fallback name');

-- Too long
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b4', 'b4@example.test', jsonb_build_object('display_name', repeat('a', 25)));
select matches((select display_name from private.profiles where id = '00000000-0000-0000-0000-0000000000b4'), '^Player-[0-9a-f]{6}$', 'too-long name gives fallback name');

-- Taken name (case-insensitive): auth user still created
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b5', 'b5@example.test', '{"display_name":"grace hopper"}');
select matches((select display_name from private.profiles where id = '00000000-0000-0000-0000-0000000000b5'), '^Player-[0-9a-f]{6}$', 'taken name gives fallback name');
select is((select count(*) from auth.users where id = '00000000-0000-0000-0000-0000000000b5'), 1::bigint, 'auth user still created when name is taken');

-- Non-string metadata values count as missing
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b6', 'b6@example.test', '{"display_name":12345}'),
  ('00000000-0000-0000-0000-0000000000b7', 'b7@example.test', '{"display_name":{"x":"y"}}'),
  ('00000000-0000-0000-0000-0000000000b8', 'b8@example.test', '"just a string"');
select is(
  (select count(*) from private.profiles
    where id in ('00000000-0000-0000-0000-0000000000b6','00000000-0000-0000-0000-0000000000b7','00000000-0000-0000-0000-0000000000b8')
      and display_name ~ '^Player-[0-9a-f]{6}$'),
  3::bigint, 'number, object and non-object metadata give fallback names');

-- Every user has a profile
select is(
  (select count(*) from auth.users u where u.id::text like '00000000-0000-0000-0000-0000000000b%'
     and not exists (select 1 from private.profiles p where p.id = u.id)),
  0::bigint, 'every new user has a profile');

-- Cascade
delete from auth.users where id = '00000000-0000-0000-0000-0000000000b1';
select is((select count(*) from private.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 0::bigint, 'deleting the auth user deletes the profile');

select * from finish();
rollback;
