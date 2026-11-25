import type { RoomId, Vec3 } from '../contracts';
import { PORTAL_PARTNERS } from './games/portal-partners';
import { POWER_UP_WORKSHOP } from './games/power-up-workshop';
import type { GameModule } from './games/types';

/** A game room: where it is in the courtyard and which game it runs (name and gameType come from `game`). */
export interface GameRoomConfig {
  id: RoomId;
  game: GameModule;
  minPlayers: 2;
  maxPlayers: 2;
  entrance: Vec3;
  joinRadius: number;
}

export interface WorldConfig {
  worldLimit: number;
  graceMs: number;
  idleMs: number;
  /** Test-only override applied to every game's round length; each game's own `roundMs` otherwise. */
  roundMs?: number;
  rooms: GameRoomConfig[];
}

// Admission and connection limits
export const WORLD_LIMIT = 16;
export const GRACE_MS = 20_000;
export const AUTH_DEADLINE_MS = 10_000;
export const IDLE_MS = 600_000;
export const PENDING_AUTH_CAP = 32;
export const MAX_MESSAGE_BYTES = 4096;
export const MAX_MOVES_PER_SECOND = 20;
export const INVALID_MESSAGE_LIMIT = 100;
export const INVALID_MESSAGE_WINDOW_MS = 10_000;

// Courtyard
export const COURTYARD_SPEED = 4.8;
export const COURTYARD_RADIUS = 23;
export const COURTYARD_SPAWN: Vec3 = { x: 0, y: 0, z: 4 };
export const COURTYARD_SPAWN_ROTATION = 0;

// Portal Partners room
export const PORTAL_ROOM: GameRoomConfig = {
  id: 'portal',
  game: PORTAL_PARTNERS,
  minPlayers: 2,
  maxPlayers: 2,
  entrance: { x: -10.5, y: 0, z: 0 },
  joinRadius: 3.2,
};

// Power-Up Workshop room: the fifth slot on the courtyard ring (angle 198 degrees)
export const WORKSHOP_ROOM: GameRoomConfig = {
  id: 'workshop',
  game: POWER_UP_WORKSHOP,
  minPlayers: 2,
  maxPlayers: 2,
  entrance: { x: -3.24, y: 0, z: -9.99 },
  joinRadius: 3.2,
};

// Movement budget
export const BUDGET_REFILL_FACTOR = 1.25;
export const BUDGET_SLACK = 0.5;
export const Y_MIN = 0;
export const Y_MAX = 3;

// Result-save retry timing lives in runtime/src/results.ts (the engine does not save results).

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  worldLimit: WORLD_LIMIT,
  graceMs: GRACE_MS,
  idleMs: IDLE_MS,
  rooms: [PORTAL_ROOM, WORKSHOP_ROOM],
};
