// Runs one load-check scenario: connect every client, let the first `movers` walk around the
// courtyard at `rateHz` for `durationMs`, and report what the meter saw.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { createMemoryStorage, createPortalClient, type SocketLike } from '../../shared/client/index';
import type { PortalClient, WorldConnection } from '../../shared/contracts/index';
import { Meter, instrumentSocket } from './meter';
import { EVENT_LOOP_RESOLUTION_MS, freeTierHoursPerDay, percentile, warningsFor, type ScenarioReport } from './report';
import { WALK_SPEED, createWalker } from './walker';

export type ScenarioName = 'baseline' | 'full' | 'quarter';

export const SCENARIOS: Record<ScenarioName, { players: number; movers: number }> = {
  baseline: { players: 2, movers: 2 },
  full: { players: 16, movers: 16 },
  quarter: { players: 16, movers: 4 },
};

/** Where the clients' sockets report; the runner sets a fresh meter for each scenario. */
export interface Probe {
  meter: Meter | null;
}

export interface LoadClient {
  tag: string;
  client: PortalClient;
}

/** Waits after the walkers stop so moves already in flight are delivered and counted. */
const SETTLE_MS = 500;
const PRESENCE_TIMEOUT_MS = 15_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createLoadClient(o: {
  tag: string;
  supabaseUrl: string;
  publishableKey: string;
  runtimeUrl: string;
  origin: string;
  probe: Probe;
}): LoadClient {
  const client = createPortalClient({
    url: o.supabaseUrl,
    publishableKey: o.publishableKey,
    storage: createMemoryStorage(),
    runtimeUrl: o.runtimeUrl,
    openSocket: (url) => {
      // Node's WebSocket (undici) accepts headers; the runtime checks Origin.
      const Ctor = WebSocket as unknown as new (u: string, init: { headers: Record<string, string> }) => SocketLike;
      return instrumentSocket(new Ctor(url, { headers: { Origin: o.origin } }), o.tag, () => o.probe.meter);
    },
  });
  return { tag: o.tag, client };
}

async function connectAll(clients: LoadClient[]): Promise<WorldConnection[]> {
  const results = await Promise.all(clients.map((c) => c.client.connectWorld()));
  const conns = results.flatMap((r) => (r.data ? [r.data] : []));
  const failed = results.flatMap((r, i) => (r.error ? [`${clients[i]!.tag} (${r.error.code})`] : []));
  if (failed.length > 0) {
    await Promise.all(conns.map((c) => c.leaveWorld()));
    throw new Error(`Could not connect: ${failed.join(', ')}. No numbers were recorded.`);
  }
  return conns;
}

/** Players in the lobby beyond the scenario's own, as any scenario client sees it. */
function othersInLobby(conns: WorldConnection[]): number {
  return Math.max(0, ...conns.map((c) => c.snapshot().room.players.length - conns.length));
}

async function waitForPresence(conns: WorldConnection[]): Promise<void> {
  const end = Date.now() + PRESENCE_TIMEOUT_MS;
  while (!conns.every((c) => c.snapshot().room.players.length >= conns.length)) {
    if (Date.now() > end) throw new Error('Timed out waiting for every player to see the others in the lobby.');
    await sleep(50);
  }
}

export async function runScenario(
  clients: LoadClient[],
  s: { name: string; movers: number; rateHz: number; durationMs: number },
  probe: Probe,
): Promise<ScenarioReport> {
  const meter = new Meter();
  probe.meter = meter;
  let conns: WorldConnection[] = [];
  const timers: Array<ReturnType<typeof setInterval>> = [];
  try {
    conns = await connectAll(clients);
    conns.forEach((c, i) => meter.registerPlayer(clients[i]!.tag, c.playerId));
    await waitForPresence(conns);
    let extraPlayers = othersInLobby(conns);

    let reconnects = 0;
    let walking = false;
    const closes: string[] = [];
    for (const c of conns) {
      c.onConnectionState((st) => {
        if (st === 'reconnecting') reconnects++;
        // A final close; closeReason is set before 'closed' is emitted. Our own leaveWorld comes after.
        if (st === 'closed' && walking) closes.push(c.closeReason ?? 'unknown');
      });
    }

    const loop = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS });
    loop.enable();
    meter.start();
    walking = true;
    for (const c of conns.slice(0, s.movers)) {
      const walker = createWalker(c.snapshot().self.position!, WALK_SPEED / s.rateHz);
      timers.push(
        setInterval(() => {
          const step = walker.next();
          c.sendMove(step.position, step.rotation);
        }, 1000 / s.rateHz),
      );
    }
    await sleep(s.durationMs);
    timers.splice(0).forEach(clearInterval);
    await sleep(SETTLE_MS);
    meter.stop();
    walking = false;
    loop.disable();
    extraPlayers = Math.max(extraPlayers, othersInLobby(conns));

    const k = meter.counts();
    const seconds = s.durationMs / 1000;
    const expectedDeliveries = k.moves * (conns.length - 1);
    const incomingPerSec = k.sent / seconds;
    const base: Omit<ScenarioReport, 'warnings'> = {
      name: s.name,
      players: conns.length,
      movers: Math.min(s.movers, conns.length),
      rateHz: s.rateHz,
      startedAt: new Date(k.startedAt!).toISOString(),
      endedAt: new Date(k.endedAt!).toISOString(),
      seconds,
      sent: k.sent,
      received: k.received,
      incomingPerSec,
      outgoingPerSec: k.received / seconds,
      delayMs: {
        p50: percentile(k.delaysMs, 50),
        p95: percentile(k.delaysMs, 95),
        // Not Math.max(...list): a full run has well over 100,000 deliveries.
        max: percentile(k.delaysMs, 100),
        count: k.delaysMs.length,
      },
      expectedDeliveries,
      deliveryRatio: expectedDeliveries > 0 ? k.delaysMs.length / expectedDeliveries : null,
      corrections: k.corrections,
      requestErrors: k.requestErrors,
      reconnects,
      extraPlayers,
      closes,
      eventLoopMs: { p99: loop.percentile(99) / 1e6, max: loop.max / 1e6 },
      freeTierHoursPerDay: freeTierHoursPerDay(incomingPerSec),
    };
    return { ...base, warnings: warningsFor(base) };
  } finally {
    timers.forEach(clearInterval);
    await Promise.all(conns.map((c) => c.leaveWorld()));
    probe.meter = null;
  }
}
