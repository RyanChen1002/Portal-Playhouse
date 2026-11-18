import type {
  GameResult,
  PortalPartnersTarget,
  RoomId,
  RoomSnapshot,
  ServerMessage,
  Vec3,
  WorldSnapshot,
} from './realtime';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'DISPLAY_NAME_TAKEN',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'WEAK_PASSWORD',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
  'ROOM_NOT_FOUND',
  'ROOM_FULL',
  'ROOM_LOCKED',
  'WORLD_FULL',
  'NOT_IN_GAME',
  'INVALID_ACTION',
  'GAME_NOT_READY',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorField = 'displayName' | 'avatarId' | 'email' | 'password';

export interface AppError {
  code: ErrorCode;
  /** Plain-language text suitable for showing to a player. */
  message: string;
  field?: ErrorField;
}

export type Result<T> = { data: T; error: null } | { data: null; error: AppError };

export const AVATAR_IDS = [
  'avatar-01', 'avatar-02', 'avatar-03', 'avatar-04', 'avatar-05',
  'avatar-06', 'avatar-07', 'avatar-08', 'avatar-09', 'avatar-10',
  'avatar-11', 'avatar-12', 'avatar-13', 'avatar-14', 'avatar-15',
  'avatar-16', 'avatar-17', 'avatar-18', 'avatar-19', 'avatar-20',
] as const;

export type AvatarId = (typeof AVATAR_IDS)[number];

export const DEFAULT_AVATAR_ID: AvatarId = 'avatar-01';

export function isAvatarId(x: unknown): x is AvatarId {
  return typeof x === 'string' && (AVATAR_IDS as readonly string[]).includes(x);
}

export interface Profile {
  id: string;
  displayName: string;
  avatarId: AvatarId;
  /** One per winning session the player took part in. */
  winsTotal: number;
}

export interface SessionState {
  signedIn: boolean;
  playerId: string | null;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'closed';
export type ServerEventType = Exclude<ServerMessage['type'], 'request.accepted' | 'request.error'>;
export type ServerEventPayload<K extends ServerEventType> = Extract<ServerMessage, { type: K }>['payload'];

/** A live connection to the shared world (spec §8.1). Methods never throw. */
export interface WorldConnection {
  readonly playerId: string;
  readonly state: ConnectionState;
  /** The latest world state, kept current from server events. Returns a copy. */
  snapshot(): WorldSnapshot;
  joinRoom(roomId: RoomId): Promise<Result<RoomSnapshot>>;
  leaveRoom(): Promise<Result<RoomSnapshot>>;
  setReady(ready: boolean): Promise<Result<null>>;
  /** Fills in the current round's sessionId and a fresh actionId. */
  interact(target: PortalPartnersTarget): Promise<Result<null>>;
  /** Frees the slot at once; the connection is then closed. Also called by signOut(). */
  leaveWorld(): Promise<Result<null>>;
  /** Not awaited; the sequence number is managed internally. Ignored while not connected. */
  sendMove(position: Vec3, rotation: number): void;
  /** Returns an unsubscribe function. */
  on<K extends ServerEventType>(type: K, cb: (p: ServerEventPayload<K>) => void): () => void;
  /** Returns an unsubscribe function. */
  onConnectionState(cb: (s: ConnectionState) => void): () => void;
}

export interface PortalClient {
  signUp(input: { email: string; password: string; displayName: string }): Promise<Result<Profile>>;
  signIn(input: { email: string; password: string }): Promise<Result<Profile>>;
  signOut(): Promise<Result<null>>;
  getSession(): Promise<Result<SessionState>>;
  /** Returns an unsubscribe function. */
  onSessionChange(cb: (s: SessionState) => void): () => void;
  getMe(): Promise<Result<Profile>>;
  updateMe(input: { displayName?: string; avatarId?: AvatarId }): Promise<Result<Profile>>;
  checkDisplayName(displayName: string): Promise<Result<{ available: boolean }>>;
  /** Opens the world connection; resolves after the first `world.snapshot`. */
  connectWorld(): Promise<Result<WorldConnection>>;
  /** The caller's results, newest first. `limit` 1 to 50, default 20. */
  getMyResults(input?: {
    limit?: number;
    cursor?: string;
  }): Promise<Result<{ results: GameResult[]; nextCursor: string | null }>>;
}
