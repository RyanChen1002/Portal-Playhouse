import type { RoomId, Vec3 } from '../contracts';

export type Location = 'courtyard' | 'arena';

export interface GameRoomConfig {
  id: RoomId;
  name: string;
  gameType: 'portal-partners';
  minPlayers: 2;
  maxPlayers: 2;
  entrance: Vec3;
  joinRadius: number;
}

export interface WorldConfig {
  worldLimit: number;
  graceMs: number;
  idleMs: number;
  roundMs: number;
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
  name: 'Portal Partners',
  gameType: 'portal-partners',
  minPlayers: 2,
  maxPlayers: 2,
  entrance: { x: -10.5, y: 0, z: 0 },
  joinRadius: 3.2,
};

// Arena
export const ARENA_SPEED = 4;
export const ARENA_HALF_X = 9.6;
export const ARENA_HALF_Z = 7.7;
export const ARENA_SPAWNS: readonly [Vec3, Vec3] = [
  { x: -3, y: 0, z: 6 },
  { x: 0, y: 0, z: 6 },
];
export const ARENA_GAP_HALF_Z = 1.25;
export const ARENA_BRIDGE_HALF_X = 1.2;
export const ARENA_SETBACK_Z = 1.35;

// Puzzle objects (x, z)
export const PLATE = { x: -5, z: 3 } as const;
export const PLATE_RADIUS = 1.3;
export const LEVER = { x: 2, z: -4 } as const;
export const CRYSTAL_A = { x: -6, z: -5 } as const;
export const CRYSTAL_B = { x: 6, z: -5 } as const;
export const EXIT = { x: 0, z: -7 } as const;
export const EXIT_RADIUS = 2.3;
export const INTERACT_RADIUS = 1.9;
export const ROUND_MS = 180_000;

// Movement budget
export const BUDGET_REFILL_FACTOR = 1.25;
export const BUDGET_SLACK = 0.5;
export const Y_MIN = 0;
export const Y_MAX = 3;

// Results persistence retries: 5 s, 30 s, 2 min, then every 10 min
export const RESULT_RETRY_DELAYS_MS: readonly number[] = [5_000, 30_000, 120_000];
export const RESULT_RETRY_REPEAT_MS = 600_000;
export const RESULT_FAILED_AFTER_MS = 3_600_000;

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  worldLimit: WORLD_LIMIT,
  graceMs: GRACE_MS,
  idleMs: IDLE_MS,
  roundMs: ROUND_MS,
  rooms: [PORTAL_ROOM],
};
