// Statistics, warnings and report text for one load-check scenario.

/** Cloudflare free tier: Durable Object requests per day (runtime research §6.2). */
export const FREE_REQUESTS_PER_DAY = 100_000;
/** Incoming WebSocket messages billed as one request (runtime research §6.2). */
export const MESSAGES_PER_REQUEST = 20;
/** Event-loop p99 above this (ms) means the load generator itself was slow. */
export const EVENT_LOOP_WARN_MS = 50;
/** Delivery ratio below this means moves went missing. */
export const DELIVERY_WARN_RATIO = 0.99;

export interface ScenarioReport {
  name: string;
  players: number;
  movers: number;
  rateHz: number;
  startedAt: string;
  endedAt: string;
  seconds: number;
  sent: number;
  received: number;
  incomingPerSec: number;
  outgoingPerSec: number;
  delayMs: { p50: number | null; p95: number | null; max: number | null; count: number };
  expectedDeliveries: number;
  deliveryRatio: number | null;
  corrections: number;
  requestErrors: number;
  reconnects: number;
  eventLoopMs: { p99: number; max: number };
  freeTierHoursPerDay: number | null;
  warnings: string[];
}

/** Nearest-rank percentile; null for an empty list. Does not modify `values`. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(rank, sorted.length) - 1]!;
}

/** Hours of play per day before the free request limit; null when nothing is sent. */
export function freeTierHoursPerDay(incomingPerSec: number): number | null {
  if (!(incomingPerSec > 0)) return null;
  return (FREE_REQUESTS_PER_DAY * MESSAGES_PER_REQUEST) / (incomingPerSec * 3600);
}

export function warningsFor(r: Omit<ScenarioReport, 'warnings'>): string[] {
  const w: string[] = [];
  if (r.corrections > 0) {
    w.push(`${r.corrections} moves were rejected by the server (player.corrected); the walk or the rules are off.`);
  }
  if (r.requestErrors > 0) w.push(`${r.requestErrors} request error(s) were received.`);
  if (r.reconnects > 0) w.push(`${r.reconnects} reconnect(s) happened during the run.`);
  if (r.deliveryRatio !== null && r.deliveryRatio < DELIVERY_WARN_RATIO) {
    w.push(`Move delivery was ${(r.deliveryRatio * 100).toFixed(1)}% of expected; some moves never reached other players.`);
  }
  if (r.eventLoopMs.p99 > EVENT_LOOP_WARN_MS) {
    w.push(`The load generator lagged (event-loop p99 ${fmt(r.eventLoopMs.p99)} ms); delays may be the client's, not the server's.`);
  }
  return w;
}

const fmt = (n: number | null): string => (n === null ? 'n/a' : n.toFixed(1));

export function formatReport(r: ScenarioReport): string {
  const lines = [
    `== ${r.name}: ${r.players} players, ${r.movers} moving, ${r.rateHz} Hz, ${fmt(r.seconds)} s ==`,
    `window      ${r.startedAt} to ${r.endedAt} (UTC)`,
    `messages    incoming ${fmt(r.incomingPerSec)}/s (${r.sent} total), outgoing ${fmt(r.outgoingPerSec)}/s (${r.received} total)`,
    `free tier   ${fmt(r.freeTierHoursPerDay)} hours/day of this load before the daily request limit`,
    `move delay  p50 ${fmt(r.delayMs.p50)} ms, p95 ${fmt(r.delayMs.p95)} ms, max ${fmt(r.delayMs.max)} ms (${r.delayMs.count} deliveries)`,
    `delivery    ${r.deliveryRatio === null ? 'n/a' : `${(r.deliveryRatio * 100).toFixed(1)}%`} of ${r.expectedDeliveries} expected`,
    `problems    corrections ${r.corrections}, request errors ${r.requestErrors}, reconnects ${r.reconnects}`,
    `generator   event-loop p99 ${fmt(r.eventLoopMs.p99)} ms, max ${fmt(r.eventLoopMs.max)} ms`,
  ];
  if (r.warnings.length === 0) lines.push('No problems seen.');
  else for (const w of r.warnings) lines.push(`WARNING: ${w}`);
  return lines.join('\n');
}
