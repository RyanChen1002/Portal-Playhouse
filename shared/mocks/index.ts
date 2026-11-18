// In-memory PortalClient for frontend work before the backend exists (spec §5.5, §8.1).
// Same interface, validation, uniqueness rules and error codes as the real client.
// The world runs the real World engine in-process (shared/mocks/world.ts); results are kept
// in memory and make winsTotal and getMyResults real.
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
  PlayerCard,
  PortalClient,
  Profile,
  Result,
  SessionState,
  WorldConnection,
} from '../contracts/index';
import { openWorldConnection, validateResultsQuery } from '../client/world';
import { World } from '../world/index';
import { openMockSocket, resultsFor, type MockResult } from './world';

export type { MockResult } from './world';

interface MockAccount {
  email: string; // lowercased, like Supabase Auth
  password: string;
  profile: Profile;
}

/**
 * Shared "database" and world. Several clients on one store simulate several players.
 * `world` is the in-process World engine (also a test hook); `results` are the saved rounds.
 */
export interface MockStore {
  readonly accountsById: Map<string, MockAccount>;
  readonly idsByEmail: Map<string, string>;
  readonly world: World;
  readonly results: MockResult[];
  cardFor(playerId: string): PlayerCard | undefined;
}

export function createMockStore(): MockStore {
  const accountsById = new Map<string, MockAccount>();
  return {
    accountsById,
    idsByEmail: new Map(),
    world: new World({ now: () => Date.now(), newId: () => crypto.randomUUID() }),
    results: [],
    cardFor(playerId) {
      const p = accountsById.get(playerId)?.profile;
      return p ? { id: p.id, displayName: p.displayName, avatarId: p.avatarId } : undefined;
    },
  };
}

const ok = <T>(data: T): Result<T> => ({ data, error: null });

function fail<T>(code: ErrorCode, message: string, field?: ErrorField): Result<T> {
  const error: AppError = field === undefined ? { code, message } : { code, message, field };
  return { data: null, error };
}

const failWith = <T>(error: AppError): Result<T> => ({ data: null, error: { ...error } });

/** A copy of the profile with winsTotal counted from saved results (one per winning session). */
function profileOf(store: MockStore, p: Profile): Profile {
  const wins = store.results.filter((r) => r.round.outcome === 'win' && r.round.playerIds.includes(p.id)).length;
  return { id: p.id, displayName: p.displayName, avatarId: p.avatarId, winsTotal: wins };
}

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

  let world: WorldConnection | null = null;
  let connecting: Promise<Result<WorldConnection>> | null = null;

  async function connect(): Promise<Result<WorldConnection>> {
    if (world && world.state !== 'closed') {
      // Only ever hand back a connection that belongs to the signed-in player.
      if (world.playerId === currentId) return ok(world);
      await world.leaveWorld();
    }
    world = null;
    if (currentId === null) return fail('UNAUTHORIZED', UNAUTHORIZED_MESSAGE);
    const r = await openWorldConnection({
      openSocket: () => openMockSocket(store),
      // A mock token is the player id.
      getToken: async () => currentId,
      refreshToken: async () => currentId,
    });
    if (r.data) world = r.data;
    return r;
  }

  return {
    async signUp(input) {
      // Sign-up always starts signed out, like the real client.
      if (currentId !== null) setSession(null);
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
      return ok(profileOf(store, profile));
    },

    async signIn(input) {
      const { email, password } = input ?? ({} as typeof input);
      const id = typeof email === 'string' ? store.idsByEmail.get(emailKey(email)) : undefined;
      const account = id === undefined ? undefined : store.accountsById.get(id);
      if (!account || account.password !== password) {
        return fail('INVALID_CREDENTIALS', 'The email or password is incorrect.');
      }
      setSession(account.profile.id);
      return ok(profileOf(store, account.profile));
    },

    async signOut() {
      // Leave the world first, so the slot is freed at once (spec §5.2 item 9).
      if (world && world.state !== 'closed') await world.leaveWorld();
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
        cb({ ...s }); // a copy, like the real client
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
      return ok(profileOf(store, account.profile));
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
      return ok(profileOf(store, account.profile));
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

    async connectWorld() {
      // Concurrent calls share one attempt.
      connecting ??= connect().finally(() => {
        connecting = null;
      });
      return connecting;
    },

    async getMyResults(input) {
      if (currentId === null) return fail('UNAUTHORIZED', UNAUTHORIZED_MESSAGE);
      const q = validateResultsQuery(input);
      if (!q.ok) return failWith(q.error);
      let all = resultsFor(store, currentId);
      if (q.cursor !== null) {
        const after = decodeCursor(q.cursor);
        if (!after) return fail('VALIDATION_ERROR', 'The cursor is not valid.');
        // Strictly after the cursor in newest-first order.
        all = all.filter(
          (r) => r.completedAt < after.completedAt || (r.completedAt === after.completedAt && r.id < after.id),
        );
      }
      const page = all.slice(0, q.limit);
      const last = page[page.length - 1];
      const nextCursor = all.length > q.limit && last ? encodeCursor(last.completedAt, last.id) : null;
      return ok({ results: page, nextCursor });
    },
  };
}

// Opaque cursor: base64 of "<completedAt>|<result id>", like get_my_results.
function encodeCursor(completedAt: string, id: string): string {
  return btoa(`${completedAt}|${id}`);
}

function decodeCursor(cursor: string): { completedAt: string; id: string } | null {
  try {
    const [completedAt, id, ...rest] = atob(cursor).split('|');
    if (!completedAt || !id || rest.length > 0 || Number.isNaN(Date.parse(completedAt))) return null;
    return { completedAt, id };
  } catch {
    return null;
  }
}

let mockPlayerCounter = 0;

/**
 * Adds `count` simulated players to the store's world for local demos: each gets an account
 * and a connection, standing in the lobby. Throws only if the world rejects one (for example,
 * when it is full).
 */
export async function createMockPlayers(store: MockStore, count: number): Promise<WorldConnection[]> {
  const out: WorldConnection[] = [];
  for (let i = 0; i < count; i++) {
    const client = createMockPortalClient({ store });
    const name = `bot${(mockPlayerCounter++).toString(36)}${crypto.randomUUID().slice(0, 4)}`;
    const signUp = await client.signUp({
      email: `${name}@example.test`,
      password: 'sample-password-1',
      displayName: name,
    });
    if (signUp.error) throw new Error(`createMockPlayers: sign-up failed (${signUp.error.code})`);
    const conn = await client.connectWorld();
    if (conn.error) throw new Error(`createMockPlayers: connect failed (${conn.error.code})`);
    out.push(conn.data);
  }
  return out;
}
