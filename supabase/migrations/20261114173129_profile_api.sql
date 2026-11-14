-- Task 5: the profile API. Clients reach the hidden `private` tables only through these
-- three SECURITY DEFINER functions in `public`, called with supabase.rpc:
--   public.get_me()                                  -> authenticated
--   public.update_me(display_name, avatar_id)        -> authenticated
--   public.check_display_name(display_name)          -> anon, authenticated
--
-- Security rules (spec section 5.4):
--   * SECURITY DEFINER only to reach `private`; every function sets search_path = ''.
--   * The user comes only from auth.uid(); no function takes an id parameter, and
--     update_me writes only the row where id = auth.uid().
--   * user_metadata / raw_user_meta_data is never read here.
--   * EXECUTE is revoked from PUBLIC, anon and authenticated, then granted explicitly.
--     service_role keeps EXECUTE (Supabase default privileges) for admin tooling.
--
-- Error transport (pinned): errcode PT400/PT401/PT409/PT503, message = bare contract code,
-- detail = human text, hint = field name ('displayName' / 'avatarId') when the error is
-- about one input. PostgREST maps PTxyz to HTTP status xyz.
--
-- update_me check order: auth -> at least one field -> name validity -> avatar validity
-- -> name taken. Validation (400) is reported before conflict (409), and the name before
-- the avatar within each class. Nothing is written until every check passes.
-- A NULL argument means "omitted, unchanged" (PostgREST sends JSON null as the default);
-- the client layer rejects explicit nulls. Empty or whitespace-only strings are invalid.
--
-- Database advisors: the local `supabase db advisors` (CLI 3.1.0, all types, level info)
-- reports no finding for these functions. Exposing exactly these three SECURITY DEFINER
-- functions to anon/authenticated (check_display_name) and authenticated (get_me,
-- update_me) is intended: it is the only path to `private`. If a hosted linter flags them
-- as executable by anon/authenticated, that finding is accepted for these three only.

-- ---------------------------------------------------------------------------
-- Shared return shape
-- ---------------------------------------------------------------------------

create function private.profile_json(p private.profiles)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', p.id::text,
    'displayName', p.display_name,
    'avatarId', p.avatar_id,
    'winsTotal', 0
  );
$$;

revoke execute on function private.profile_json(private.profiles) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- get_me
-- ---------------------------------------------------------------------------

create function public.get_me()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  me private.profiles;
begin
  if uid is null then
    raise exception using errcode = 'PT401', message = 'UNAUTHORIZED',
      detail = 'You must be signed in.';
  end if;

  select * into me from private.profiles p where p.id = uid;

  if not found then
    raise warning 'get_me: no profile row for user %', uid;
    raise exception using errcode = 'PT503', message = 'SERVICE_UNAVAILABLE',
      detail = 'Your profile is unavailable. Please try again later.';
  end if;

  return private.profile_json(me);
end;
$$;

-- ---------------------------------------------------------------------------
-- update_me
-- ---------------------------------------------------------------------------

create function public.update_me(display_name text default null, avatar_id text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_name text;
  me private.profiles;
begin
  if uid is null then
    raise exception using errcode = 'PT401', message = 'UNAUTHORIZED',
      detail = 'You must be signed in.';
  end if;

  if update_me.display_name is null and update_me.avatar_id is null then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'Provide a display name, an avatar, or both.';
  end if;

  -- 1. Name validity
  if update_me.display_name is not null then
    new_name := private.normalize_display_name(update_me.display_name);
    if not private.is_valid_display_name(new_name) then
      raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
        detail = 'Display name must be 1 to 24 characters with no invisible or control characters.',
        hint = 'displayName';
    end if;
  end if;

  -- 2. Avatar validity
  if update_me.avatar_id is not null
     and not exists (select 1 from private.avatars a where a.id = update_me.avatar_id) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'Unknown avatar.',
      hint = 'avatarId';
  end if;

  -- 3. Name taken by another user (advisory; the unique index is authoritative)
  if new_name is not null
     and exists (
       select 1 from private.profiles p
       where pg_catalog.lower(p.display_name) = pg_catalog.lower(new_name)
         and p.id <> uid
     ) then
    raise exception using errcode = 'PT409', message = 'DISPLAY_NAME_TAKEN',
      detail = 'That display name is already taken.',
      hint = 'displayName';
  end if;

  begin
    update private.profiles p
    set display_name = coalesce(new_name, p.display_name),
        avatar_id = coalesce(update_me.avatar_id, p.avatar_id)
    where p.id = uid
    returning p.* into me;
  exception when unique_violation then
    raise exception using errcode = 'PT409', message = 'DISPLAY_NAME_TAKEN',
      detail = 'That display name is already taken.',
      hint = 'displayName';
  end;

  if me.id is null then
    raise warning 'update_me: no profile row for user %', uid;
    raise exception using errcode = 'PT503', message = 'SERVICE_UNAVAILABLE',
      detail = 'Your profile is unavailable. Please try again later.';
  end if;

  return private.profile_json(me);
end;
$$;

-- ---------------------------------------------------------------------------
-- check_display_name
-- ---------------------------------------------------------------------------

create function public.check_display_name(display_name text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  normalized text := private.normalize_display_name(check_display_name.display_name);
begin
  if not private.is_valid_display_name(normalized) then
    raise exception using errcode = 'PT400', message = 'VALIDATION_ERROR',
      detail = 'Display name must be 1 to 24 characters with no invisible or control characters.',
      hint = 'displayName';
  end if;

  -- IS DISTINCT FROM: a signed-out caller (uid null) sees every match as unavailable.
  return pg_catalog.jsonb_build_object('available', not exists (
    select 1 from private.profiles p
    where pg_catalog.lower(p.display_name) = pg_catalog.lower(normalized)
      and p.id is distinct from uid
  ));
end;
$$;

-- ---------------------------------------------------------------------------
-- Privileges
-- ---------------------------------------------------------------------------

revoke execute on function public.get_me() from public, anon, authenticated;
revoke execute on function public.update_me(text, text) from public, anon, authenticated;
revoke execute on function public.check_display_name(text) from public, anon, authenticated;

grant execute on function public.get_me() to authenticated;
grant execute on function public.update_me(text, text) to authenticated;
grant execute on function public.check_display_name(text) to anon, authenticated;
