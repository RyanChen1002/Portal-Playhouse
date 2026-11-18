import type { PortalPartnersTarget, Vec3 } from '../contracts';
import {
  ARENA_BRIDGE_HALF_X,
  ARENA_GAP_HALF_Z,
  ARENA_SETBACK_Z,
  ARENA_SPAWNS,
  CRYSTAL_A,
  CRYSTAL_B,
  EXIT,
  EXIT_RADIUS,
  INTERACT_RADIUS,
  LEVER,
  PLATE,
  PLATE_RADIUS,
} from './config';
import type { Barrier } from './movement';

export type InteractResult =
  | { ok: true }
  | { ok: false; code: 'INVALID_ACTION' | 'NOT_IN_GAME'; message: string };

export interface PPRound {
  sessionId: string;
  playerIds: [string, string];
  startedAt: number;
  latched: boolean;
  crystals: [boolean, boolean];
  ended: boolean;
  actionResults: Map<string, InteractResult>; // by actionId, for duplicates
}

const SAMPLE_STEP = 0.1;

export function startRound(sessionId: string, playerIds: [string, string], now: number): PPRound {
  return {
    sessionId,
    playerIds,
    startedAt: now,
    latched: false,
    crystals: [false, false],
    ended: false,
    actionResults: new Map(),
  };
}

export function spawnPositions(): [Vec3, Vec3] {
  return [{ ...ARENA_SPAWNS[0] }, { ...ARENA_SPAWNS[1] }];
}

function dist2d(p: Vec3, o: { x: number; z: number }): number {
  return Math.hypot(p.x - o.x, p.z - o.z);
}

export function bridgeOpen(r: PPRound, positions: Vec3[]): boolean {
  return r.latched || positions.some((p) => dist2d(p, PLATE) <= PLATE_RADIUS);
}

export function arenaBarrier(r: PPRound, positions: Vec3[]): Barrier {
  return (from, to) => {
    const open = bridgeOpen(r, positions);
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = from.x + (to.x - from.x) * t;
      const z = from.z + (to.z - from.z) * t;
      if (Math.abs(z) < ARENA_GAP_HALF_Z && (!open || Math.abs(x) > ARENA_BRIDGE_HALF_X)) return true;
    }
    return false;
  };
}

function targetPoint(target: PortalPartnersTarget): { x: number; z: number } {
  switch (target) {
    case 'lever':
      return LEVER;
    case 'crystal-a':
      return CRYSTAL_A;
    case 'crystal-b':
      return CRYSTAL_B;
    case 'exit':
      return EXIT;
  }
}

const invalid = (message: string): InteractResult => ({ ok: false, code: 'INVALID_ACTION', message });

export function interact(
  r: PPRound,
  playerId: string,
  actionId: string,
  target: PortalPartnersTarget,
  positions: Map<string, Vec3>,
  connected: Map<string, boolean>,
): InteractResult & { won?: boolean } {
  const prior = r.actionResults.get(actionId);
  if (prior) return prior;

  const result = evaluate(r, playerId, target, positions, connected);
  r.actionResults.set(actionId, result);
  return result;
}

function evaluate(
  r: PPRound,
  playerId: string,
  target: PortalPartnersTarget,
  positions: Map<string, Vec3>,
  connected: Map<string, boolean>,
): InteractResult & { won?: boolean } {
  if (r.ended || !r.playerIds.includes(playerId)) {
    return { ok: false, code: 'NOT_IN_GAME', message: 'You are not in this game.' };
  }
  const me = positions.get(playerId);
  if (!me || dist2d(me, targetPoint(target)) > INTERACT_RADIUS) {
    return invalid('Move closer to interact.');
  }
  switch (target) {
    case 'lever':
      if (r.latched) return invalid('The lever is already pulled.');
      r.latched = true;
      return { ok: true };
    case 'crystal-a':
    case 'crystal-b': {
      const i = target === 'crystal-a' ? 0 : 1;
      if (r.crystals[i]) return invalid('That crystal is already collected.');
      r.crystals[i] = true;
      return { ok: true };
    }
    case 'exit': {
      if (!r.crystals[0] || !r.crystals[1]) return invalid('Collect both crystals first.');
      const [p1, p2] = r.playerIds;
      if (connected.get(p1) !== true || connected.get(p2) !== true) {
        return invalid('Both players must be connected.');
      }
      const a = positions.get(p1);
      const b = positions.get(p2);
      if (!a || !b || dist2d(a, EXIT) > EXIT_RADIUS || dist2d(b, EXIT) > EXIT_RADIUS) {
        return invalid('Both players must be at the exit.');
      }
      r.ended = true;
      return { ok: true, won: true };
    }
  }
}

export function setBack(position: Vec3, lastOutside: Vec3): Vec3 {
  return { x: position.x, y: position.y, z: lastOutside.z > 0 ? ARENA_SETBACK_Z : -ARENA_SETBACK_Z };
}

export function score(r: PPRound): number {
  return r.crystals.filter(Boolean).length;
}

export function timeUp(r: PPRound, now: number, roundMs: number): boolean {
  return now - r.startedAt >= roundMs;
}
