// Real PortalClient over supabase-js (spec §5.5). Same behavior as shared/mocks: same
// validation, error codes and fields. It knows function names, never table names: profile
// data goes only through rpc('get_me' | 'update_me' | 'check_display_name').
// Every public method returns a Result and never throws.
import { createClient } from '@supabase/supabase-js';
import type { Session, SupabaseClient, SupportedStorage } from '@supabase/supabase-js';
import { isAvatarId, validateCredentials, validateDisplayName } from '../contracts/index';
import type { AppError, AvatarId, PortalClient, Profile, Result, SessionState } from '../contracts/index';
import { appError, mapAuthError, mapRpcError } from './errors';

export { mapAuthError, mapRpcError } from './errors';

export interface PortalClientConfig {
  url: string;
  publishableKey: string;
  /**
   * Where the session is kept. Defaults to a fresh in-memory store, so every instance has its
   * own session. In a browser, pass `window.localStorage` together with a stable `storageKey`
   * to keep players signed in across page loads.
   */
  storage?: SupportedStorage;
  /** Storage key for the session. Defaults to a key unique to this instance. */
  storageKey?: string;
}

/** A minimal synchronous in-memory SupportedStorage. */
export function createMemoryStorage(): SupportedStorage & {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
} {
  const items = new Map<string, string>();
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value);
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}

let instanceCounter = 0;
const uniqueStorageKey = () =>
  `portal-playhouse-auth-${(instanceCounter++).toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const ok = <T>(data: T): Result<T> => ({ data, error: null });
const failWith = <T>(error: AppError): Result<T> => ({ data: null, error });
const fail = <T>(...args: Parameters<typeof appError>): Result<T> => failWith(appError(...args));

const toState = (session: Session | null | undefined): SessionState =>
  session?.user?.id ? { signedIn: true, playerId: session.user.id } : { signedIn: false, playerId: null };

function toProfile(data: unknown): Profile | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (
    typeof d.id !== 'string' ||
    typeof d.displayName !== 'string' ||
    !isAvatarId(d.avatarId) ||
    typeof d.winsTotal !== 'number'
  ) {
    return null;
  }
  return { id: d.id, displayName: d.displayName, avatarId: d.avatarId, winsTotal: d.winsTotal };
}

/** Runs a method body, turning any unexpected exception into SERVICE_UNAVAILABLE. */
async function guard<T>(body: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await body();
  } catch {
    return fail('SERVICE_UNAVAILABLE');
  }
}

export function createPortalClient(config: PortalClientConfig): PortalClient {
  const supabase: SupabaseClient = createClient(config.url, config.publishableKey, {
    auth: {
      storage: config.storage ?? createMemoryStorage(),
      storageKey: config.storageKey ?? uniqueStorageKey(),
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  async function currentSession(): Promise<Result<Session | null>> {
    const { data, error } = await supabase.auth.getSession();
    // A failed refresh of a stored session is reported as an error, and supabase-js drops the
    // session: the player is simply signed out. Only a network failure is an outage.
    if (error && (error.name === 'AuthRetryableFetchError' || error.status === 0)) {
      return fail('SERVICE_UNAVAILABLE');
    }
    return ok(data?.session ?? null);
  }

  async function getMe(): Promise<Result<Profile>> {
    const session = await currentSession();
    if (session.error) return failWith(session.error);
    if (!session.data) return fail('UNAUTHORIZED');
    const { data, error, status } = await supabase.rpc('get_me');
    if (error) return failWith(mapRpcError({ ...error, status }));
    const profile = toProfile(data);
    return profile ? ok(profile) : fail('SERVICE_UNAVAILABLE');
  }

  return {
    signUp: (input) =>
      guard(async () => {
        const { email, password, displayName } = (input ?? {}) as {
          email?: unknown;
          password?: unknown;
          displayName?: unknown;
        };
        if (typeof email !== 'string' || typeof password !== 'string') {
          return fail('VALIDATION_ERROR', 'email', 'Please enter a valid email address.');
        }
        const credentialError = validateCredentials({ email, password });
        if (credentialError) return failWith(credentialError);
        if (typeof displayName !== 'string') {
          return fail('VALIDATION_ERROR', 'displayName', 'Please enter a display name.');
        }
        const name = validateDisplayName(displayName);
        if (!name.ok) return failWith(name.error);

        // Advisory pre-check so a taken name never creates an account (spec §5.3).
        const check = await supabase.rpc('check_display_name', { display_name: name.value });
        if (check.error) return failWith(mapRpcError({ ...check.error, status: check.status }));
        if (!isAvailability(check.data)) return fail('SERVICE_UNAVAILABLE');
        if (!check.data.available) return fail('DISPLAY_NAME_TAKEN', 'displayName');

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { display_name: name.value } },
        });
        if (error) return failWith(mapAuthError(error));
        // Local Supabase answers an existing email with a 422 'user_already_exists' error. If it
        // instead returns an obfuscated user (no session, or no identities), treat it the same.
        if (!data.session || (Array.isArray(data.user?.identities) && data.user.identities.length === 0)) {
          return fail('EMAIL_TAKEN', 'email');
        }
        return getMe();
      }),

    signIn: (input) =>
      guard(async () => {
        const { email, password } = (input ?? {}) as { email?: unknown; password?: unknown };
        if (typeof email !== 'string' || typeof password !== 'string' || email === '' || password === '') {
          return fail('INVALID_CREDENTIALS');
        }
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          const mapped = mapAuthError(error);
          // Sign-in never says which input was wrong (spec §5.4).
          return mapped.code === 'RATE_LIMITED' || mapped.code === 'SERVICE_UNAVAILABLE'
            ? failWith(mapped)
            : fail('INVALID_CREDENTIALS');
        }
        return getMe();
      }),

    signOut: () =>
      guard(async () => {
        // 'local' ends only this client's session, like the mock; other devices stay signed in.
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) return failWith(mapAuthError(error));
        return ok(null);
      }),

    getSession: () =>
      guard(async () => {
        const session = await currentSession();
        if (session.error) return failWith(session.error);
        return ok(toState(session.data));
      }),

    onSessionChange(cb) {
      try {
        let last: SessionState | null = null;
        // supabase-js first emits INITIAL_SESSION asynchronously, then every change.
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
          const state = toState(session);
          if (last !== null && last.signedIn === state.signedIn && last.playerId === state.playerId) return;
          last = state;
          try {
            cb({ ...state });
          } catch {
            // A faulty subscriber must not break the client.
          }
        });
        return () => {
          try {
            data.subscription.unsubscribe();
          } catch {
            // Never throw.
          }
        };
      } catch {
        return () => {};
      }
    },

    getMe: () => guard(getMe),

    updateMe: (input) =>
      guard(async () => {
        const session = await currentSession();
        if (session.error) return failWith(session.error);
        if (!session.data) return fail('UNAUTHORIZED');

        const { displayName, avatarId } = (input ?? {}) as { displayName?: unknown; avatarId?: unknown };
        if (displayName === undefined && avatarId === undefined) {
          return fail('VALIDATION_ERROR', undefined, 'Nothing to update.');
        }
        // Same checks and order as the mock and update_me: display name, then avatar.
        // Omitted fields are left out of the RPC arguments (SQL NULL means "unchanged").
        const args: { display_name?: string; avatar_id?: AvatarId } = {};
        if (displayName !== undefined) {
          if (typeof displayName !== 'string') {
            return fail('VALIDATION_ERROR', 'displayName', 'Please enter a display name.');
          }
          const name = validateDisplayName(displayName);
          if (!name.ok) return failWith(name.error);
          args.display_name = displayName; // the database normalizes and is authoritative
        }
        if (avatarId !== undefined) {
          if (!isAvatarId(avatarId)) {
            return fail('VALIDATION_ERROR', 'avatarId', 'Please choose one of the avatars.');
          }
          args.avatar_id = avatarId;
        }

        const { data, error, status } = await supabase.rpc('update_me', args);
        if (error) return failWith(mapRpcError({ ...error, status }));
        const profile = toProfile(data);
        return profile ? ok(profile) : fail('SERVICE_UNAVAILABLE');
      }),

    checkDisplayName: (displayName) =>
      guard(async () => {
        if (typeof displayName !== 'string') {
          return fail('VALIDATION_ERROR', 'displayName', 'Please enter a display name.');
        }
        const name = validateDisplayName(displayName);
        if (!name.ok) return failWith(name.error);
        const { data, error, status } = await supabase.rpc('check_display_name', { display_name: displayName });
        if (error) return failWith(mapRpcError({ ...error, status }));
        return isAvailability(data) ? ok({ available: data.available }) : fail('SERVICE_UNAVAILABLE');
      }),
  };
}

function isAvailability(x: unknown): x is { available: boolean } {
  return typeof x === 'object' && x !== null && typeof (x as { available?: unknown }).available === 'boolean';
}
