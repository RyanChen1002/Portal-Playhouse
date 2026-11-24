import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from './types';
import { parseClientMessage, type ClientMessage } from './realtime';

const pos = { x: 1, y: 0, z: -2 };
const samples: ClientMessage[] = [
  { type: 'auth', requestId: 'r1', payload: { token: 'tok' } },
  { type: 'auth.refresh', requestId: 'r2', payload: { token: 'tok2' } },
  { type: 'player.move', payload: { sequence: 3, position: pos, rotation: 1.5 } },
  { type: 'room.join', requestId: 'r3', payload: { roomId: 'portal' } },
  { type: 'room.leave', requestId: 'r4', payload: {} },
  { type: 'game.ready', requestId: 'r5', payload: { ready: true } },
  { type: 'game.interact', requestId: 'r6', payload: { sessionId: 's1', actionId: 'a1', target: 'lever' } },
  { type: 'world.leave', requestId: 'r7', payload: {} },
];

const move = (over: Record<string, unknown> = {}, p: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'player.move',
    payload: { sequence: 1, position: { x: 0, y: 0, z: 0 }, rotation: 0, ...over, ...p },
  });

const expectInvalid = (raw: string) => {
  const r = parseClientMessage(raw);
  expect(r.data).toBeNull();
  expect(r.error?.code).toBe('VALIDATION_ERROR');
};

describe('parseClientMessage', () => {
  it('parses each valid client message type', () => {
    for (const m of samples) {
      const r = parseClientMessage(JSON.stringify(m));
      expect(r.error).toBeNull();
      expect(r.data).toEqual(m);
    }
  });

  it('accepts any target matching the target rule', () => {
    for (const target of ['door', 'crystal-a', 'A1', 'x'.repeat(32)]) {
      const r = parseClientMessage(
        JSON.stringify({ type: 'game.interact', requestId: 'a', payload: { sessionId: 's', actionId: 'x', target } }),
      );
      expect(r.error).toBeNull();
      expect(r.data).toEqual({ type: 'game.interact', requestId: 'a', payload: { sessionId: 's', actionId: 'x', target } });
    }
  });

  it('rejects targets outside the target rule', () => {
    for (const target of ['', 'x'.repeat(33), 'crystal_a', 'lever!', 'two words', 7]) {
      expectInvalid(
        JSON.stringify({ type: 'game.interact', requestId: 'a', payload: { sessionId: 's', actionId: 'x', target } }),
      );
    }
  });

  it('drops unknown extra keys', () => {
    const r = parseClientMessage(
      JSON.stringify({ type: 'game.ready', requestId: 'a', extra: 1, payload: { ready: false, x: 1 } }),
    );
    expect(r.data).toEqual({ type: 'game.ready', requestId: 'a', payload: { ready: false } });
  });

  it('rejects non-finite numbers', () => {
    for (const bad of ['"NaN"', '"1"', '1e400', 'null']) {
      for (const axis of ['x', 'y', 'z']) {
        expectInvalid(
          `{"type":"player.move","payload":{"sequence":1,"position":{"x":0,"y":0,"z":0,"${axis}":${bad}},"rotation":0}}`,
        );
      }
      expectInvalid(`{"type":"player.move","payload":{"sequence":1,"position":{"x":0,"y":0,"z":0},"rotation":${bad}}}`);
      expectInvalid(`{"type":"player.move","payload":{"sequence":${bad},"position":{"x":0,"y":0,"z":0},"rotation":0}}`);
    }
    expectInvalid('{"type":"player.move","payload":{"sequence":1,"position":{"x":0,"y":0},"rotation":0}}');
  });

  it('rejects unknown type, missing requestId on commands, extra-long strings', () => {
    expectInvalid('{"type":"nope","payload":{}}');
    expectInvalid('{"type":"room.join","payload":{"roomId":"portal"}}');
    expectInvalid(JSON.stringify({ type: 'room.join', requestId: 'r'.repeat(65), payload: { roomId: 'portal' } }));
    expectInvalid(JSON.stringify({ type: 'room.join', requestId: '', payload: { roomId: 'portal' } }));
    expectInvalid(JSON.stringify({ type: 'auth', requestId: 'a', payload: { token: 't'.repeat(4097) } }));
    expectInvalid(JSON.stringify({ type: 'auth', requestId: 'a', payload: { token: '' } }));
    expect(parseClientMessage(JSON.stringify({ type: 'auth', requestId: 'a', payload: { token: 't'.repeat(4096) } })).error).toBeNull();
    expectInvalid(move({ sequence: 1.5 }));
    expectInvalid(move({ sequence: -1 }));
    expectInvalid(move({ sequence: Number.MAX_SAFE_INTEGER + 2 }));
    expectInvalid('{"type":"game.ready","requestId":"a","payload":{"ready":"yes"}}');
    expectInvalid('{"type":"room.join","requestId":"a"}');
  });

  it('rejects non-JSON and non-object input', () => {
    for (const raw of ['nope', '[]', 'null', '1', '"x"', '']) expectInvalid(raw);
  });
});

describe('ERROR_CODES', () => {
  it('contains the new codes', () => {
    for (const c of ['ROOM_NOT_FOUND', 'ROOM_FULL', 'ROOM_LOCKED', 'WORLD_FULL', 'NOT_IN_GAME', 'INVALID_ACTION', 'GAME_NOT_READY']) {
      expect(ERROR_CODES).toContain(c);
    }
  });
});
