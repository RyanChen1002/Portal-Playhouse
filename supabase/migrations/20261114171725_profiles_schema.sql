-- Task 3: private profile schema, avatar catalog, and the display-name rule.
--
-- The `private` schema is not in the Data API's exposed schemas (supabase/config.toml
-- [api].schemas), and anon/authenticated get no privileges on it. Later migrations add
-- the sign-up trigger and the SECURITY DEFINER API functions in `public`.
--
-- The display-name rule must match shared/contracts/display-name.ts exactly.
-- Special characters appear only as \uXXXX escapes inside regular expressions.

create schema if not exists private;

-- ---------------------------------------------------------------------------
-- Display-name rule
-- ---------------------------------------------------------------------------

-- Normalize: strip leading/trailing W, then collapse every run of W into one U+0020.
-- W = U+0009-U+000D, U+0020, U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029,
--     U+202F, U+205F, U+3000
create function private.normalize_display_name(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
    pg_catalog.regexp_replace(
      raw,
      '^[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+|[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+$',
      '',
      'g'
    ),
    '[\u0009-\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+',
    ' ',
    'g'
  );
$$;

-- Valid: 1-24 code points and no character from D (checked on the normalized value).
-- D = U+0000-U+001F, U+007F-U+009F, U+00AD, U+061C, U+180E, U+200B-U+200F,
--     U+202A-U+202E, U+2060-U+206F, U+FEFF, U+FFF9-U+FFFB
-- (U+0000 cannot occur in Postgres text, so the class starts at U+0001.)
create function private.is_valid_display_name(normalized text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(
    pg_catalog.char_length(normalized) between 1 and 24
    and normalized !~ '[\u0001-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]',
    false
  );
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table private.avatars (
  id text primary key
);

-- Seeded here (not in seed.sql) so hosted projects get the catalog too.
insert into private.avatars (id)
select 'avatar-' || pg_catalog.lpad(n::text, 2, '0')
from pg_catalog.generate_series(1, 20) as n;

create table private.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_id text not null default 'avatar-01' references private.avatars (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_display_name_rule check (
    display_name = private.normalize_display_name(display_name)
    and private.is_valid_display_name(display_name)
  )
);

-- Case-insensitive uniqueness; the database is authoritative.
create unique index profiles_display_name_key on private.profiles (lower(display_name));

-- Supports the avatar foreign key (deletes/updates on private.avatars).
create index profiles_avatar_id_idx on private.profiles (avatar_id);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on private.profiles
for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row level security and privileges
-- ---------------------------------------------------------------------------

-- RLS on, no policies: only roles that bypass RLS (postgres, service_role) or
-- SECURITY DEFINER functions owned by postgres can read or write rows.
alter table private.avatars enable row level security;
alter table private.profiles enable row level security;

revoke all on schema private from anon, authenticated, public;
revoke all on all tables in schema private from anon, authenticated, public;
revoke all on all functions in schema private from anon, authenticated, public;

-- service_role keeps server-side access (it bypasses RLS).
grant usage on schema private to service_role;
grant select, insert, update, delete on all tables in schema private to service_role;
-- Check constraints run their functions with the caller's privileges, so a role
-- that writes profiles must be able to execute the rule functions.
grant execute on function private.normalize_display_name(text) to service_role;
grant execute on function private.is_valid_display_name(text) to service_role;
