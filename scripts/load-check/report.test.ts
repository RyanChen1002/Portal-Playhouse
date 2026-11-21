import { describe, expect, it } from 'vitest';
import { formatReport, freeTierHoursPerDay, percentile, warningsFor, type ScenarioReport } from './report';

const clean: Omit<ScenarioReport, 'warnings'> = {
  name: 'full',
  players: 16,
  movers: 16,
  rateHz: 10,
  startedAt: '2026-11-21T17:00:00.000Z',
  endedAt: '2026-11-21T17:01:00.000Z',
  seconds: 60,
  sent: 9_600,
  received: 144_000,
  incomingPerSec: 160,
  outgoingPerSec: 2_400,
  delayMs: { p50: 12, p95: 30, max: 80, count: 144_000 },
  expectedDeliveries: 144_000,
  deliveryRatio: 1,
  corrections: 0,
  requestErrors: 0,
  reconnects: 0,
  extraPlayers: 0,
  closes: [],
  eventLoopMs: { p99: 5, max: 12 },
  freeTierHoursPerDay: 3.47,
};

describe('percentile', () => {
  it('uses the nearest rank on an unsorted list', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
  });

  it('is null for an empty list', () => {
    expect(percentile([], 50)).toBeNull();
  });
});

describe('freeTierHoursPerDay', () => {
  it('matches the research estimate for 160 messages per second', () => {
    expect(freeTierHoursPerDay(160)).toBeCloseTo(3.47, 2);
  });

  it('is null when nothing is sent', () => {
    expect(freeTierHoursPerDay(0)).toBeNull();
  });
});

describe('warningsFor', () => {
  it('has no warnings for a clean run', () => {
    expect(warningsFor(clean)).toEqual([]);
  });

  it('warns about rejected moves', () => {
    expect(warningsFor({ ...clean, corrections: 3 }).join('\n')).toContain('3 moves were rejected');
  });

  it('warns about request errors', () => {
    expect(warningsFor({ ...clean, requestErrors: 1 }).join('\n')).toContain('request error');
  });

  it('warns about reconnects', () => {
    expect(warningsFor({ ...clean, reconnects: 1 }).join('\n')).toContain('reconnect');
  });

  it('warns when other players were in the lobby', () => {
    expect(warningsFor({ ...clean, extraPlayers: 2 }).join('\n')).toContain('2 other players');
  });

  it('warns about connections that closed during the run, with their reasons', () => {
    const text = warningsFor({ ...clean, closes: ['idle', 'left'] }).join('\n');
    expect(text).toContain('2 connection(s) closed during the run');
    expect(text).toContain('idle, left');
  });

  it('blames closed connections, not the server, for missing moves when there were closes', () => {
    const delivery = warningsFor({ ...clean, closes: ['lost'], deliveryRatio: 0.93 }).find((w) => w.includes('delivery'));
    expect(delivery).toContain('connection(s) closed');
    expect(delivery).not.toContain('never reached other players');
  });

  it('warns when moves go missing', () => {
    expect(warningsFor({ ...clean, deliveryRatio: 0.95 }).join('\n')).toContain('delivery');
    expect(warningsFor({ ...clean, deliveryRatio: 0.99 })).toEqual([]);
  });

  it('warns when the load generator lags', () => {
    expect(warningsFor({ ...clean, eventLoopMs: { p99: 51, max: 60 } }).join('\n')).toContain('load generator');
    expect(warningsFor({ ...clean, eventLoopMs: { p99: 50, max: 60 } })).toEqual([]);
  });
});

describe('formatReport', () => {
  it('shows the numbers and says when there were no problems', () => {
    const text = formatReport({ ...clean, warnings: [] });
    for (const part of ['includes the 10 ms sampling interval', 'full', 'incoming 160.0/s', 'outgoing', 'p95', 'hours/day', clean.startedAt, clean.endedAt, 'No problems seen.']) {
      expect(text).toContain(part);
    }
  });

  it('lists each warning on its own line', () => {
    const text = formatReport({ ...clean, warnings: ['one', 'two'] });
    const lines = text.split('\n');
    expect(lines).toContain('WARNING: one');
    expect(lines).toContain('WARNING: two');
    expect(text).not.toContain('No problems seen.');
  });
});
