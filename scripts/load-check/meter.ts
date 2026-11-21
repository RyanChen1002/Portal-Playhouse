// Counts what goes over each client's socket during a scenario, and measures move delivery
// delay: an outgoing `player.move` is matched to the `player.updated` other clients receive,
// by sending player and `sequence`. All clients share one process, so they share one clock.
import type { SocketLike } from '../../shared/client/index';

export interface MeterCounts {
  sent: number;
  received: number;
  moves: number;
  delaysMs: number[];
  corrections: number;
  requestErrors: number;
  startedAt: number | null;
  endedAt: number | null;
}

function parse(data: unknown): { type?: unknown; payload?: Record<string, unknown> } | null {
  if (typeof data !== 'string') return null;
  try {
    const msg: unknown = JSON.parse(data);
    return typeof msg === 'object' && msg !== null ? (msg as { type?: unknown; payload?: Record<string, unknown> }) : null;
  } catch {
    return null;
  }
}

export class Meter {
  private running = false;
  private readonly tagOf = new Map<string, string>();
  private readonly sentAt = new Map<string, number>();
  private readonly c: MeterCounts = {
    sent: 0,
    received: 0,
    moves: 0,
    delaysMs: [],
    corrections: 0,
    requestErrors: 0,
    startedAt: null,
    endedAt: null,
  };

  constructor(private readonly now: () => number = Date.now) {}

  registerPlayer(tag: string, playerId: string): void {
    this.tagOf.set(playerId, tag);
  }

  start(): void {
    this.running = true;
    this.c.startedAt = this.now();
  }

  stop(): void {
    this.running = false;
    this.c.endedAt = this.now();
  }

  onSend(tag: string, data: string): void {
    if (!this.running) return;
    this.c.sent++;
    const msg = parse(data);
    if (msg?.type !== 'player.move') return;
    this.c.moves++;
    const seq = msg.payload?.sequence;
    if (typeof seq === 'number') this.sentAt.set(`${tag}:${seq}`, this.now());
  }

  onReceive(tag: string, data: unknown): void {
    if (!this.running) return;
    this.c.received++;
    const msg = parse(data);
    if (msg?.type === 'player.corrected') this.c.corrections++;
    else if (msg?.type === 'request.error') this.c.requestErrors++;
    else if (msg?.type === 'player.updated') {
      const from = this.tagOf.get(String(msg.payload?.playerId));
      const sentAt = from && from !== tag ? this.sentAt.get(`${from}:${String(msg.payload?.sequence)}`) : undefined;
      if (sentAt !== undefined) this.c.delaysMs.push(this.now() - sentAt);
    }
  }

  counts(): MeterCounts {
    return { ...this.c, delaysMs: [...this.c.delaysMs] };
  }
}

type Handlers = Pick<SocketLike, 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;

/**
 * Wraps a socket so the current meter (if any) sees every message. Handlers the client sets
 * on the wrapper, before or after it opens, are installed on the inner socket.
 */
export function instrumentSocket(inner: SocketLike, tag: string, meter: () => Meter | null): SocketLike {
  const own: Handlers = { onopen: null, onmessage: null, onclose: null, onerror: null };
  return {
    send(data: string) {
      meter()?.onSend(tag, data);
      inner.send(data);
    },
    close(code?: number, reason?: string) {
      inner.close(code, reason);
    },
    get onopen() {
      return own.onopen;
    },
    set onopen(fn) {
      own.onopen = fn;
      inner.onopen = fn;
    },
    get onmessage() {
      return own.onmessage;
    },
    set onmessage(fn) {
      own.onmessage = fn;
      inner.onmessage = fn
        ? (ev) => {
            meter()?.onReceive(tag, ev?.data);
            fn(ev);
          }
        : null;
    },
    get onclose() {
      return own.onclose;
    },
    set onclose(fn) {
      own.onclose = fn;
      inner.onclose = fn;
    },
    get onerror() {
      return own.onerror;
    },
    set onerror(fn) {
      own.onerror = fn;
      inner.onerror = fn;
    },
  };
}
