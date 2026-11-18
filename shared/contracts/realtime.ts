import type { AvatarId, ErrorCode, Result } from './types';

export type Vec3 = { x: number; y: number; z: number };
export type RoomId = string; // 'lobby' | 'portal' in this release
export type PortalPartnersTarget = 'lever' | 'crystal-a' | 'crystal-b' | 'exit';
export type Outcome = 'win' | 'loss' | 'cancelled';
export type CancelReason = 'left' | 'disconnected';
export type PersistenceStatus = 'pending' | 'saved' | 'failed';
export type CorrectionReason = 'rejected' | 'bridgeClosed';

export interface PlayerCard {
  id: string;
  displayName: string;
  avatarId: AvatarId;
}
export interface Presence extends PlayerCard {
  position: Vec3 | null;
  rotation: number;
  connected: boolean;
  ready: boolean;
}
export interface RoomSummary {
  id: RoomId;
  name: string;
  gameType: 'portal-partners';
  minPlayers: number;
  maxPlayers: number;
  status: 'waiting' | 'playing';
  players: PlayerCard[];
  sessionId: string | null;
  startedAt: string | null;
  durationSeconds: number;
  score: number | null;
  revision: number;
}
export interface PortalPartnersState {
  bridgeOpen: boolean;
  latched: boolean;
  crystals: [boolean, boolean];
  startedAt: string;
  durationSeconds: number;
  serverTime: string;
}
export interface GameFinished {
  sessionId: string;
  outcome: Outcome;
  score: number;
  persistenceStatus: PersistenceStatus;
  reason?: CancelReason;
}
export interface RoomSnapshot {
  roomId: RoomId;
  summary: RoomSummary | null; // null for the lobby
  players: Presence[];
  session: (PortalPartnersState & { sessionId: string }) | null;
  revision: number;
}
export interface WorldSnapshot {
  self: { playerId: string; roomId: RoomId; position: Vec3 | null; rotation: number };
  room: RoomSnapshot;
  board: RoomSummary[];
  lastFinished: GameFinished | null;
}

export type ClientMessage =
  | { type: 'auth'; requestId: string; payload: { token: string } }
  | { type: 'auth.refresh'; requestId: string; payload: { token: string } }
  | { type: 'player.move'; requestId?: undefined; payload: { sequence: number; position: Vec3; rotation: number } }
  | { type: 'room.join'; requestId: string; payload: { roomId: RoomId } }
  | { type: 'room.leave'; requestId: string; payload: Record<string, never> }
  | { type: 'game.ready'; requestId: string; payload: { ready: boolean } }
  | { type: 'game.interact'; requestId: string; payload: { sessionId: string; actionId: string; target: PortalPartnersTarget } }
  | { type: 'world.leave'; requestId: string; payload: Record<string, never> };

export type ServerMessage =
  | { type: 'request.accepted'; requestId: string; payload: unknown }
  | { type: 'request.error'; requestId: string | null; error: { code: ErrorCode; message: string } }
  | { type: 'world.snapshot'; payload: WorldSnapshot }
  | { type: 'room.snapshot'; payload: RoomSnapshot }
  | { type: 'player.joined'; payload: { player: Presence; revision: number } }
  | { type: 'player.left'; payload: { playerId: string; reason: 'moved' | 'left' | 'disconnected' | 'idle'; revision: number } }
  | { type: 'player.updated'; payload: { playerId: string; position: Vec3; rotation: number; sequence: number; revision: number } }
  | { type: 'player.connection'; payload: { playerId: string; connected: boolean; revision: number } }
  | { type: 'player.ready'; payload: { playerId: string; ready: boolean; revision: number } }
  | { type: 'player.corrected'; payload: { sequence: number; position: Vec3; rotation: number; reason: CorrectionReason } }
  | { type: 'room.updated'; payload: { room: RoomSummary } }
  | { type: 'game.state'; payload: { sessionId: string; revision: number; state: PortalPartnersState } }
  | { type: 'game.finished'; payload: GameFinished }
  | { type: 'result.saved'; payload: { sessionId: string; resultId: string } }
  | { type: 'session.replaced'; payload: Record<string, never> };

export interface GameResult {
  id: string;
  sessionId: string;
  gameType: 'portal-partners';
  outcome: Outcome;
  cancelReason: CancelReason | null;
  score: number;
  startedAt: string;
  completedAt: string;
  durationSeconds: number;
  players: PlayerCard[];
}

const TARGETS: readonly string[] = ['lever', 'crystal-a', 'crystal-b', 'exit'];

function invalid(message: string): Result<ClientMessage> {
  return { data: null, error: { code: 'VALIDATION_ERROR', message } };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function str(x: unknown, max: number): string | null {
  return typeof x === 'string' && x.length >= 1 && x.length <= max ? x : null;
}

function num(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null;
}

function vec3(x: unknown): Vec3 | null {
  if (!isRecord(x)) return null;
  const px = num(x.x);
  const py = num(x.y);
  const pz = num(x.z);
  return px === null || py === null || pz === null ? null : { x: px, y: py, z: pz };
}

/** Validates a raw text frame from a client. Never throws. */
export function parseClientMessage(raw: string): Result<ClientMessage> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return invalid('Message is not valid JSON.');
  }
  if (!isRecord(value)) return invalid('Message must be a JSON object.');
  const { type } = value;
  if (typeof type !== 'string') return invalid('Message type is missing.');

  const payload = value.payload;
  if (!isRecord(payload)) return invalid('Message payload must be an object.');

  if (type === 'player.move') {
    const sequence = payload.sequence;
    const position = vec3(payload.position);
    const rotation = num(payload.rotation);
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) {
      return invalid('Move sequence is invalid.');
    }
    if (!position) return invalid('Move position is invalid.');
    if (rotation === null) return invalid('Move rotation is invalid.');
    return { data: { type, payload: { sequence, position, rotation } }, error: null };
  }

  const requestId = str(value.requestId, 64);
  if (requestId === null) return invalid('A request id of 1 to 64 characters is required.');

  switch (type) {
    case 'auth':
    case 'auth.refresh': {
      const token = str(payload.token, 4096);
      if (token === null) return invalid('Token is invalid.');
      return { data: { type, requestId, payload: { token } }, error: null };
    }
    case 'room.join': {
      const roomId = str(payload.roomId, 64);
      if (roomId === null) return invalid('Room id is invalid.');
      return { data: { type, requestId, payload: { roomId } }, error: null };
    }
    case 'room.leave':
    case 'world.leave':
      return { data: { type, requestId, payload: {} }, error: null };
    case 'game.ready': {
      if (typeof payload.ready !== 'boolean') return invalid('Ready must be true or false.');
      return { data: { type, requestId, payload: { ready: payload.ready } }, error: null };
    }
    case 'game.interact': {
      const sessionId = str(payload.sessionId, 64);
      const actionId = str(payload.actionId, 64);
      const target = payload.target;
      if (sessionId === null || actionId === null) return invalid('Session or action id is invalid.');
      if (typeof target !== 'string' || !TARGETS.includes(target)) return invalid('Interaction target is invalid.');
      return {
        data: { type, requestId, payload: { sessionId, actionId, target: target as PortalPartnersTarget } },
        error: null,
      };
    }
    default:
      return invalid('Unknown message type.');
  }
}
