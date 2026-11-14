-- Task 4: create a complete profile for every new auth user.
-- Sign-up must never fail because of the display name: a missing, invalid, non-string
-- or already-taken name falls back to 'Player-' plus 6 random lowercase hex characters.
-- raw_user_meta_data is user-supplied; it is used only as the initial display name.

create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate text;
  attempt int := 0;
begin
  -- jsonb_typeof guards against non-string values (numbers, objects, arrays);
  -- a non-object metadata value yields null here, so it counts as missing.
  if pg_catalog.jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string' then
    candidate := private.normalize_display_name(new.raw_user_meta_data ->> 'display_name');
    if private.is_valid_display_name(candidate) then
      begin
        insert into private.profiles (id, display_name) values (new.id, candidate);
        return new;
      exception when unique_violation then
        null; -- name taken: fall through to the generated name
      end;
    end if;
  end if;

  loop
    attempt := attempt + 1;
    candidate := 'Player-' || pg_catalog.encode(extensions.gen_random_bytes(3), 'hex');
    begin
      insert into private.profiles (id, display_name) values (new.id, candidate);
      return new;
    exception when unique_violation then
      if attempt >= 10 then
        raise exception 'could not generate a unique display name for user % after % attempts', new.id, attempt;
      end if;
    end;
  end loop;
end;
$$;

-- Functions in `private` get PUBLIC execute by default; only the trigger needs this.
revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();
