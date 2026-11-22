import { describe, expect, it } from 'vitest';
import type { SocketLike } from '../../shared/client/index';
import { Meter, instrumentSocket } from './meter';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  closed: Array<[number | undefined, string | undefined]> = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number, reason?: string) {
    this.closed.push([code, reason]);
  }
}

const move = (sequence: number) =>
  JSON.stringify({ type: 'player.move', payload: { sequence, position: { x: 0, y: 0, z: 0 }, rotation: 0 } });
const updated = (playerId: string, sequence: number) =>
  JSON.stringify({ type: 'player.updated', payload: { playerId, sequence, position: { x: 0, y: 0, z: 0 }, rotation: 0, revision: 1 } });

function setup() {
  let t = 1_000;
  const meter = new Meter(() => t);
  meter.registerPlayer('a', 'id-a');
  meter.registerPlayer('b', 'id-b');
  return { meter, at: (ms: number) => (t = ms) };
}

describe('Meter', () => {
  it('counts nothing before start or after stop', () => {
    const { meter } = setup();
    meter.onSend('a', move(1));
    meter.onReceive('b', updated('id-a', 1));
    meter.start();
    meter.stop();
    meter.onSend('a', move(2));
    meter.onReceive('b', updated('id-a', 2));
    const c = meter.counts();
    expect([c.sent, c.received, c.moves, c.delaysMs.length]).toEqual([0, 0, 0, 0]);
  });

  it('counts sent and received messages while started', () => {
    const { meter } = setup();
    meter.start();
    meter.onSend('a', move(1));
    meter.onSend('a', JSON.stringify({ type: 'room.join', requestId: 'r', payload: { roomId: 'portal' } }));
    meter.onReceive('b', JSON.stringify({ type: 'room.updated', payload: {} }));
    const c = meter.counts();
    expect([c.sent, c.moves, c.received]).toEqual([2, 1, 1]);
  });

  it("matches a move to another player's player.updated by player and sequence", () => {
    const { meter, at } = setup();
    meter.start();
    at(1_000);
    meter.onSend('a', move(7));
    at(1_040);
    meter.onReceive('b', updated('id-a', 7));
    expect(meter.counts().delaysMs).toEqual([40]);
  });

  it('ignores player.updated with no recorded send, or from an unregistered player', () => {
    const { meter } = setup();
    meter.start();
    meter.onSend('a', move(1));
    meter.onReceive('b', updated('id-a', 2));
    meter.onReceive('b', updated('id-x', 1));
    const c = meter.counts();
    expect(c.delaysMs).toEqual([]);
    expect(c.received).toBe(2);
  });

  it('counts player.corrected and request.error', () => {
    const { meter } = setup();
    meter.start();
    meter.onReceive('a', JSON.stringify({ type: 'player.corrected', payload: { sequence: 1 } }));
    meter.onReceive('a', JSON.stringify({ type: 'request.error', requestId: 'r', error: { code: 'ROOM_FULL' } }));
    meter.onReceive('a', 'not json');
    const c = meter.counts();
    expect([c.corrections, c.requestErrors, c.received]).toEqual([1, 1, 3]);
  });

  it('records the start and end times', () => {
    const { meter, at } = setup();
    at(5_000);
    meter.start();
    at(9_000);
    meter.stop();
    expect([meter.counts().startedAt, meter.counts().endedAt]).toEqual([5_000, 9_000]);
  });
});

describe('instrumentSocket', () => {
  it('forwards send, close and every handler the client sets after wrapping', () => {
    const { meter } = setup();
    meter.start();
    const inner = new FakeSocket();
    const ws = instrumentSocket(inner, 'a', () => meter);
    const seen: unknown[] = [];
    let opened = 0;
    let errored = 0;
    let closedWith: unknown = null;
    ws.onopen = () => opened++;
    ws.onmessage = (ev) => seen.push(ev.data);
    ws.onerror = () => errored++;
    ws.onclose = (ev) => (closedWith = ev);

    ws.send(move(1));
    ws.close(1000, 'left');
    inner.onopen?.();
    inner.onmessage?.({ data: 'hello' });
    inner.onerror?.();
    inner.onclose?.({ code: 1006, reason: '' });

    expect(inner.sent).toEqual([move(1)]);
    expect(inner.closed).toEqual([[1000, 'left']]);
    expect([opened, errored]).toEqual([1, 1]);
    expect(seen).toEqual(['hello']);
    expect(closedWith).toEqual({ code: 1006, reason: '' });
    expect([meter.counts().sent, meter.counts().received]).toEqual([1, 1]);
  });

  it('clears a handler on the inner socket when the client sets it to null', () => {
    const inner = new FakeSocket();
    const ws = instrumentSocket(inner, 'a', () => null);
    ws.onmessage = () => {};
    ws.onmessage = null;
    expect(inner.onmessage).toBeNull();
    expect(ws.onmessage).toBeNull();
  });

  it('works with no meter', () => {
    const inner = new FakeSocket();
    const ws = instrumentSocket(inner, 'a', () => null);
    const seen: unknown[] = [];
    ws.onmessage = (ev) => seen.push(ev.data);
    ws.send('x');
    inner.onmessage?.({ data: 'y' });
    expect(inner.sent).toEqual(['x']);
    expect(seen).toEqual(['y']);
  });
});
