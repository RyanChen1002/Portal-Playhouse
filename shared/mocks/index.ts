// In-memory PortalClient for frontend work before the backend exists (spec §5.5).
// Same interface, validation, uniqueness rules and error codes as the real client.
// Passwords are kept in memory as plain sample data: never use real credentials here.
// Every method returns a Result and never throws.
import {
  DEFAULT_AVATAR_ID,
  displayNameKey,
  isAvatarId,
  validateCredentials,
  validateDisplayName,
} from '../contracts/index';
import type {
  AppError,
  AvatarId,
  ErrorCode,
  ErrorField,
  PortalClient,
  Profile,
  Result,
  SessionState,
} from '../contracts/index';

interface MockAccount {
  email: string; // lowercased, like Supabase Auth
  password: string;
  profile: Profile;
}

/** Shared "database". Several clients on one store simulate several players. */
export interface MockStore {
  readonly accountsById: Map<string, MockAccount>;
  readonly idsByEmail: Map<string, string>;
}

export function createMockStore(): MockStore {
  return { accountsById: new Map(), idsByEmail: new Map() };
}

const ok = <T>(data: T): Result<T> => ({ data, error: null });

function fail<T>(code: ErrorCode, message: string, field?: ErrorField): Result<T> {
  const error: AppError = field === undefined ? { code, message } : { code, message, field };
  return { data: null, error };
}

const failWith = <T>(error: AppError): Result<T> => ({ data: null, error: { ...error } });

const copy = (p: Profile): Profile => ({
  id: p.id,
  displayName: p.displayName,
  avatarId: p.avatarId,
  winsTotal: p.winsTotal,
});

const emailKey = (email: string) => email.toLowerCase();

function nameTaken(store: MockStore, normalized: string, exceptId: string | null): boolean {
  const key = displayNameKey(normalized);
  for (const account of store.accountsById.values()) {
    if (account.profile.id !== exceptId && displayNameKey(account.profile.displayName) === key) return true;
  }
  return false;
}

const UNAUTHORIZED_MESSAGE = 'Please sign in first.';

export function createMockPortalClient(options: { store?: MockStore } = {}): PortalClient {
  const store = options.store ?? createMockStore();
  let currentId: string | null = null;
  const listeners = new Set<(s: SessionState) => void>();

  const sessionState = (): SessionState =>
    currentId === null ? { signedIn: false, playerId: null } : { signedIn: true, playerId: currentId };

  function setSession(id: string | null) {
    currentId = id;
    for (const listener of [...listeners]) {
      try {
        listener(sessionState());
      } catch {
        // A faulty subscriber must not break the client.
      }
    }
  }

  const currentAccount = () => (currentId === null ? undefined : store.accountsById.get(currentId));

  return {
    async signUp(input) {
      const { email, password, displayName } = input ?? ({} as typeof input);
      if (typeof email !== 'string' || typeof password !== 'string') {
        return fail('VALIDATION_ERROR', 'Please enter a valid email address.', 'email');
      }
      const credentialError = validateCredentials({ email, password });
      if (credentialError) return failWith(credentialError);
      if (typeof displayName !== 'string') {
        return fail('VALIDATION_ERROR', 'Please enter a display name.', 'displayName');
      }
      const name = validateDisplayName(displayName);
      if (!name.ok) return failWith(name.error);
      // Mirrors the real client's pre-check, which runs before the account is created.
      if (nameTaken(store, name.value, null)) {
        return fail('DISPLAY_NAME_TAKEN', 'That display name is already taken.', 'displayName');
      }
      const key = emailKey(email);
      if (store.idsByEmail.has(key)) {
        return fail('EMAIL_TAKEN', 'An account with that email already exists.', 'email');
      }
      const profile: Profile = {
        id: crypto.randomUUID(),
        displayName: name.value,
        avatarId: DEFAULT_AVATAR_ID,
        winsTotal: 0,
      };
      store.accountsById.set(profile.id, { email: key, password, profile });
      store.idsByEmail.set(key, profile.id);
      setSession(profile.id);
      return ok(copy(profile));
    },

    async signIn(input) {
      const { email, password } = input ?? ({} as typeof input);
      const id = typeof email === 'string' ? store.idsByEmail.get(emailKey(email)) : undefined;
      const account = id === undefined ? undefined : store.accountsById.get(id);
      if (!account || account.password !== password) {
        return fail('INVALID_CREDENTIALS', 'The email or password is incorrect.');
      }
      setSession(account.profile.id);
      return ok(copy(account.profile));
    },

    async signOut() {
      if (currentId !== null) setSession(null);
      return ok(null);
    },

    async getSession() {
      return ok(sessionState());
    },

    onSessionChange(cb) {
      // Like supabase-js's INITIAL_SESSION: deliver the current state once, asynchronously,
      // then every change. Consecutive identical states are delivered only once.
      let last: SessionState | null = null;
      const listener = (s: SessionState) => {
        if (last !== null && last.signedIn === s.signedIn && last.playerId === s.playerId) return;
        last = s;
        cb(s);
      };
      listeners.add(listener);
      queueMicrotask(() => {
        if (!listeners.has(listener)) return;
        try {
          listener(sessionState());
        } catch {
          // A faulty subscriber must not break the client.
        }
      });
      return () => {
        listeners.delete(listener);
      };
    },

    async getMe() {
      const account = currentAccount();
      if (!account) return fail('UNAUTHORIZED', UNAUTHORIZED_MESSAGE);
      return ok(copy(account.profile));
    },

    async updateMe(input) {
      const account = currentAccount();
      if (!account) return fail('UNAUTHORIZED', UNAUTHORIZED_MESSAGE);
      const { displayName, avatarId } = (input ?? {}) as { displayName?: unknown; avatarId?: unknown };
      if (displayName === undefined && avatarId === undefined) {
        return fail('VALIDATION_ERROR', 'Nothing to update.');
      }

      // Validate everything before changing anything: display name first, then avatar.
      let nextName: string | undefined;
      if (displayName !== undefined) {
        if (typeof displayName !== 'string') {
          return fail('VALIDATION_ERROR', 'Please enter a display name.', 'displayName');
        }
        const name = validateDisplayName(displayName);
        if (!name.ok) return failWith(name.error);
        nextName = name.value;
      }
      let nextAvatar: AvatarId | undefined;
      if (avatarId !== undefined) {
        if (!isAvatarId(avatarId)) return fail('VALIDATION_ERROR', 'Please choose one of the avatars.', 'avatarId');
        nextAvatar = avatarId;
      }
      if (nextName !== undefined && nameTaken(store, nextName, account.profile.id)) {
        return fail('DISPLAY_NAME_TAKEN', 'That display name is already taken.', 'displayName');
      }

      if (nextName !== undefined) account.profile.displayName = nextName;
      if (nextAvatar !== undefined) account.profile.avatarId = nextAvatar;
      return ok(copy(account.profile));
    },

    async checkDisplayName(displayName) {
      if (typeof displayName !== 'string') {
        return fail('VALIDATION_ERROR', 'Please enter a display name.', 'displayName');
      }
      const name = validateDisplayName(displayName);
      if (!name.ok) return failWith(name.error);
      // Like check_display_name: the caller's own name (any case) counts as available.
      return ok({ available: !nameTaken(store, name.value, currentId) });
    },
  };
}
