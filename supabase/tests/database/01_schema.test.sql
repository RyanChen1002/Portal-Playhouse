-- Task 3: private profile schema and the display-name rule.
-- Special characters are written only as U&'\XXXX' escapes (no literal invisible characters).
begin;
create extension if not exists pgtap with schema extensions;

select plan(47);

-- Tables
select has_table('private', 'profiles', 'private.profiles exists');
select has_table('private', 'avatars', 'private.avatars exists');

-- Avatar catalog
select is((select count(*) from private.avatars), 20::bigint, '20 avatars seeded');
select is((select min(id) from private.avatars), 'avatar-01', 'first avatar is avatar-01');
select is((select max(id) from private.avatars), 'avatar-20', 'last avatar is avatar-20');

-- Normalization
select is(private.normalize_display_name(U&'  Ada  \0009 Lovelace  '), 'Ada Lovelace', 'normalize: trims and collapses whitespace');
select is(private.normalize_display_name(U&'a\00A0\3000b'), 'a b', 'normalize: NBSP + ideographic space run');
select is(private.normalize_display_name(U&'\0085a\0085b '), 'a b', 'normalize: U+0085 at edges and inside');
select is(private.normalize_display_name(U&'a\0085b'), 'a b', 'normalize: internal U+0085');
select is(private.normalize_display_name(U&'a\00A0b'), 'a b', 'normalize: internal U+00A0');
select is(private.normalize_display_name('  Ada   L '), 'Ada L', 'normalize: returns normalized value');

-- Validity (always checked on the normalized value, as in TS validateDisplayName)
select ok(private.is_valid_display_name(private.normalize_display_name(repeat(U&'\+01F642', 24))), '24 emoji valid');
select ok(not private.is_valid_display_name(private.normalize_display_name(repeat(U&'\+01F642', 25))), '25 emoji invalid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'e\0301')), 'e + combining acute valid');
select ok(not private.is_valid_display_name(private.normalize_display_name('')), 'empty invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name('   ')), 'spaces only invalid');
select ok(private.is_valid_display_name(private.normalize_display_name(repeat('a', 24))), '24 chars valid');
select ok(not private.is_valid_display_name(private.normalize_display_name(repeat('a', 25))), '25 chars invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\200Bb')), 'zero-width space invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\202Eb')), 'RTL override invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'\FEFFab')), 'BOM invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\0007b')), 'BEL invalid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'Zo\00EB')), 'Zoe with diaeresis valid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'\5C71\7530')), 'CJK valid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'\0085a\0085b ')), 'W/D overlap: U+0085 edges valid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'a\0085b')), 'W/D overlap: internal U+0085 valid');
select ok(private.is_valid_display_name(private.normalize_display_name(U&'a\00A0b')), 'internal U+00A0 valid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\00ADb')), 'U+00AD invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\061Cb')), 'U+061C invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\180Eb')), 'U+180E invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\2060b')), 'U+2060 invalid');
select ok(not private.is_valid_display_name(private.normalize_display_name(U&'a\FFF9b')), 'U+FFF9 invalid');
select ok(private.is_valid_display_name('Ada Lovelace'), 'plain name valid');
select ok(not private.is_valid_display_name(null), 'null is not valid');

-- Constraints
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1@example.test'),
  ('00000000-0000-0000-0000-0000000000a2', 'a2@example.test'),
  ('00000000-0000-0000-0000-0000000000a3', 'a3@example.test');

select lives_ok(
  $$insert into private.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a1', 'Alex')$$,
  'insert profile with default avatar');
select is((select avatar_id from private.profiles where id = '00000000-0000-0000-0000-0000000000a1'), 'avatar-01', 'default avatar is avatar-01');
select throws_ok(
  $$insert into private.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a2', 'alex')$$,
  '23505', null, 'display name unique case-insensitively');
select throws_ok(
  $$insert into private.profiles (id, display_name, avatar_id) values ('00000000-0000-0000-0000-0000000000a2', 'Blake', 'avatar-21')$$,
  '23503', null, 'unknown avatar rejected');
select throws_ok(
  $$insert into private.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a2', ' Blake ')$$,
  '23514', null, 'non-normalized display name rejected');
select throws_ok(
  $$insert into private.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a2', U&'Bl\200Bake')$$,
  '23514', null, 'disallowed character rejected');

-- updated_at trigger (now() is fixed inside a transaction, so set an old value first)
update private.profiles set updated_at = '2000-01-01' where id = '00000000-0000-0000-0000-0000000000a1';
update private.profiles set avatar_id = 'avatar-02' where id = '00000000-0000-0000-0000-0000000000a1';
select is((select updated_at from private.profiles where id = '00000000-0000-0000-0000-0000000000a1'), now(), 'updated_at maintained on update');

-- RLS and privileges
select ok((select relrowsecurity from pg_class where oid = 'private.profiles'::regclass), 'RLS enabled on profiles');
select ok((select relrowsecurity from pg_class where oid = 'private.avatars'::regclass), 'RLS enabled on avatars');
select ok(not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage'),
  'anon/authenticated have no usage on private');
select ok(
  not has_table_privilege('anon', 'private.profiles', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.profiles', 'select,insert,update,delete')
  and not has_table_privilege('anon', 'private.avatars', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.avatars', 'select,insert,update,delete'),
  'anon/authenticated have no table privileges in private');

-- service_role keeps working (the check constraint calls private functions as the caller)
set local role service_role;
select lives_ok(
  $$insert into private.profiles (id, display_name) values ('00000000-0000-0000-0000-0000000000a3', 'Sam')$$,
  'service_role can insert a profile');
select lives_ok(
  $$update private.profiles set display_name = 'Samuel' where id = '00000000-0000-0000-0000-0000000000a3'$$,
  'service_role can update a profile');
reset role;

select * from finish();
rollback;
