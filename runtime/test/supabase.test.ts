import { describe, expect, it } from 'vitest';
import type { FinishedRound } from '../../shared/world';
import { createSupabaseServer } from '../src/supabase';

const URL_BASE = 'http://127.0.0.1:54321';
const PLAYER = '6f1c2a4e-1d1b-4c1f-9a51-3f2b8f6f0a11';

function stub(respond: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = [];
  const f: typeof fetch = async (input, init) => {
    const req = new Request(input, init);
    calls.push(req.clone());
    return respond(req);
  };
  return { calls, server: createSupabaseServer({ url: `${URL_BASE}/`, secretKey: 'sb_secret_test', fetch: f }) };
}

const round: FinishedRound = {
  gameType: 'portal-partners',
  sessionId: '11111111-1111-4111-8111-111111111111',
  playerIds: [PLAYER, '22222222-2222-4222-8222-222222222222'],
  outcome: 'cancelled',
  cancelReason: 'left',
  score: 1,
  startedAt: '2026-11-17T12:00:00.000Z',
  completedAt: '2026-11-17T12:01:00.000Z',
};

describe('getRuntimeProfile', () => {
  it('posts player_id with the apikey header and returns the card', async () => {
    const { calls, server } = stub(() => Response.json({ id: PLAYER, displayName: 'Ada', avatarId: 'avatar-02' }));
    const r = await server.getRuntimeProfile(PLAYER);
    expect(r).toEqual({ data: { id: PLAYER, displayName: 'Ada', avatarId: 'avatar-02' }, error: null });
    const req = calls[0]!;
    expect(req.method).toBe('POST');
    expect(req.url).toBe(`${URL_BASE}/rest/v1/rpc/get_runtime_profile`);
    expect(req.headers.get('apikey')).toBe('sb_secret_test');
    expect(req.headers.get('content-type')).toBe('application/json');
    expect(await req.json()).toEqual({ player_id: PLAYER });
  });

  it('gives SERVICE_UNAVAILABLE for an HTTP error, a network error, or a malformed body', async () => {
    const failures = [
      () => Response.json({ code: 'PT503', message: 'SERVICE_UNAVAILABLE' }, { status: 503 }),
      () => {
        throw new TypeError('fetch failed');
      },
      () => Response.json({ id: PLAYER, displayName: 'Ada', avatarId: 'not-an-avatar' }),
      () => Response.json({ id: 'someone-else', displayName: 'Ada', avatarId: 'avatar-01' }),
      () => new Response('not json', { status: 200 }),
    ];
    for (const respond of failures) {
      const r = await stub(respond).server.getRuntimeProfile(PLAYER);
      expect(r.error?.code).toBe('SERVICE_UNAVAILABLE');
    }
  });
});

describe('recordResult', () => {
  it('posts the round in snake_case and returns the result id', async () => {
    const { calls, server } = stub(() => Response.json({ resultId: 'abc' }));
    expect(await server.recordResult(round)).toEqual({ data: { resultId: 'abc' }, error: null });
    const req = calls[0]!;
    expect(req.url).toBe(`${URL_BASE}/rest/v1/rpc/record_game_result`);
    expect(req.headers.get('apikey')).toBe('sb_secret_test');
    expect(await req.json()).toEqual({
      game_type: 'portal-partners',
      session_id: round.sessionId,
      player_ids: round.playerIds,
      outcome: 'cancelled',
      cancel_reason: 'left',
      score: 1,
      started_at: round.startedAt,
      completed_at: round.completedAt,
    });
  });

  it('maps a pinned error code, and anything else to SERVICE_UNAVAILABLE', async () => {
    const v = await stub(() => Response.json({ code: 'PT400', message: 'VALIDATION_ERROR' }, { status: 400 })).server.recordResult(round);
    expect(v.error?.code).toBe('VALIDATION_ERROR');
    const o = await stub(() => new Response('oops', { status: 500 })).server.recordResult(round);
    expect(o.error?.code).toBe('SERVICE_UNAVAILABLE');
  });
});
