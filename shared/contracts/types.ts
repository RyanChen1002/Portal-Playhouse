export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'DISPLAY_NAME_TAKEN',
  'EMAIL_TAKEN',
  'INVALID_CREDENTIALS',
  'WEAK_PASSWORD',
  'RATE_LIMITED',
  'SERVICE_UNAVAILABLE',
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
  /** Always 0 in this milestone. */
  winsTotal: number;
}

export interface SessionState {
  signedIn: boolean;
  playerId: string | null;
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
}
