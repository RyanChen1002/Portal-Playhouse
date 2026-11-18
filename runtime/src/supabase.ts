import { ERROR_CODES, isAvatarId, type ErrorCode, type PlayerCard, type Result } from '../../shared/contracts';
import type { FinishedRound } from '../../shared/world';

/** Server-only calls to Supabase with the secret key. Never throws. */
export interface SupabaseServer {
  /** `SERVICE_UNAVAILABLE` on any failure, including a player with no profile. */
  getRuntimeProfile(playerId: string): Promise<Result<PlayerCard>>;
  recordResult(r: FinishedRound): Promise<Result<{ resultId: string }>>;
}

export interface SupabaseServerOptions {
  url: string;
  secretKey: string;
  fetch?: typeof fetch;
}

const TIMEOUT_MS = 5_000;

function fail<T>(code: ErrorCode): Result<T> {
  return { data: null, error: { code, message: code === 'SERVICE_UNAVAILABLE' ? 'The service is unavailable. Please try again later.' : code } };
}

export function createSupabaseServer(opts: SupabaseServerOptions): SupabaseServer {
  const base = opts.url.replace(/\/+$/, '');
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  /** POST to a database function. Resolves with the parsed body, or the pinned error code. */
  async function rpc(fn: string, body: unknown): Promise<Result<unknown>> {
    try {
      const res = await fetchImpl(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: { apikey: opts.secretKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const parsed: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        // Pinned error transport: the message is the bare code.
        const message = (parsed as { message?: unknown } | undefined)?.message;
        const code = (ERROR_CODES as readonly unknown[]).includes(message) ? (message as ErrorCode) : 'SERVICE_UNAVAILABLE';
        return fail(code);
      }
      if (parsed === undefined) return fail('SERVICE_UNAVAILABLE');
      return { data: parsed, error: null };
    } catch {
      return fail('SERVICE_UNAVAILABLE');
    }
  }

  return {
    async getRuntimeProfile(playerId) {
      const r = await rpc('get_runtime_profile', { player_id: playerId });
      if (r.error) return fail('SERVICE_UNAVAILABLE');
      const p = r.data as Partial<Record<keyof PlayerCard, unknown>> | null;
      // Never admit a player with blank or guessed profile data.
      if (
        !p ||
        p.id !== playerId ||
        typeof p.displayName !== 'string' ||
        p.displayName.length === 0 ||
        !isAvatarId(p.avatarId)
      ) {
        return fail('SERVICE_UNAVAILABLE');
      }
      return { data: { id: p.id, displayName: p.displayName, avatarId: p.avatarId }, error: null };
    },

    async recordResult(round) {
      const r = await rpc('record_portal_partners_result', {
        session_id: round.sessionId,
        player_ids: round.playerIds,
        outcome: round.outcome,
        cancel_reason: round.cancelReason,
        score: round.score,
        started_at: round.startedAt,
        completed_at: round.completedAt,
      });
      if (r.error) return { data: null, error: r.error };
      const resultId = (r.data as { resultId?: unknown } | null)?.resultId;
      if (typeof resultId !== 'string' || resultId.length === 0) return fail('SERVICE_UNAVAILABLE');
      return { data: { resultId }, error: null };
    },
  };
}
