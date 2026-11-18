import { exportJWK, generateKeyPair, SignJWT, type CryptoKey, type JWK, type JWTPayload } from 'jose';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTokenVerifier, type TokenVerifier } from '../src/auth';

const SUPABASE_URL = 'http://127.0.0.1:54321';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const JWKS_URL = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
const NOW_MS = Date.UTC(2026, 10, 17, 12, 0, 0);
const NOW_S = NOW_MS / 1000;
const SUB = '6f1c2a4e-1d1b-4c1f-9a51-3f2b8f6f0a11';

interface KeyPair { privateKey: CryptoKey; publicJwk: JWK }

let es256: KeyPair;
let rs256: KeyPair;
let es384: KeyPair; // published, but not on the allow-list
let stranger: KeyPair; // never published in the JWKS

async function makeKey(alg: 'ES256' | 'RS256' | 'ES384', kid: string): Promise<KeyPair> {
  const { privateKey, publicKey } = await generateKeyPair(alg, { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg, use: 'sig' };
  return { privateKey, publicJwk };
}

function claims(overrides: Partial<JWTPayload> & Record<string, unknown> = {}): JWTPayload {
  return {
    iss: ISSUER,
    aud: 'authenticated',
    role: 'authenticated',
    sub: SUB,
    iat: NOW_S - 60,
    exp: NOW_S + 3600,
    ...overrides,
  };
}

function sign(payload: JWTPayload, key: CryptoKey | Uint8Array, header: { alg: string; kid?: string }) {
  return new SignJWT(payload).setProtectedHeader(header).sign(key);
}

function signEs256(payload: JWTPayload = claims()) {
  return sign(payload, es256.privateKey, { alg: 'ES256', kid: es256.publicJwk.kid! });
}

function b64url(value: unknown): string {
  return btoa(JSON.stringify(value)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

let fetchCalls: string[];
let verifier: TokenVerifier;
let clock: number; // injected now(), ms
let published: JWK[]; // the key set the fake Supabase serves

const jwksFetch: typeof fetch = async (input) => {
  const url = input instanceof Request ? input.url : String(input);
  fetchCalls.push(url);
  return new Response(JSON.stringify({ keys: published }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

beforeAll(async () => {
  es256 = await makeKey('ES256', 'es-key-1');
  rs256 = await makeKey('RS256', 'rs-key-1');
  es384 = await makeKey('ES384', 'es384-key-1');
  stranger = await makeKey('ES256', 'es-key-1'); // same kid as the real key, different key material
});

beforeEach(() => {
  fetchCalls = [];
  clock = NOW_MS;
  published = [es256.publicJwk, rs256.publicJwk, es384.publicJwk];
  verifier = createTokenVerifier({ supabaseUrl: SUPABASE_URL, fetch: jwksFetch, now: () => clock });
});

async function expectUnauthorized(token: string) {
  const result = await verifier.verify(token);
  expect(result.data).toBeNull();
  expect(result.error?.code).toBe('UNAUTHORIZED');
  return result.error!.message;
}

describe('createTokenVerifier', () => {
  it('accepts a valid ES256 token and returns the player ID and the effective deadline (exp + 30 s) in ms', async () => {
    const exp = NOW_S + 1800;
    const result = await verifier.verify(await signEs256(claims({ exp })));
    expect(result).toEqual({ data: { playerId: SUB, expiresAt: (exp + 30) * 1000 }, error: null });
    expect(fetchCalls).toEqual([JWKS_URL]);
  });

  it('accepts a valid RS256 token', async () => {
    const token = await sign(claims(), rs256.privateKey, { alg: 'RS256', kid: rs256.publicJwk.kid! });
    const result = await verifier.verify(token);
    expect(result.data?.playerId).toBe(SUB);
  });

  it('accepts a token expired by 29 s (clock tolerance)', async () => {
    const result = await verifier.verify(await signEs256(claims({ exp: NOW_S - 29 })));
    expect(result.data?.playerId).toBe(SUB);
    expect(result.data!.expiresAt - clock).toBe(1000);
  });

  it('rejects every bad token with UNAUTHORIZED and the same message', async () => {
    const { sub: _omit, ...withoutSub } = claims();
    const valid = await signEs256();
    const [header, payload] = valid.split('.');
    const otherSig = (await sign(claims(), stranger.privateKey, { alg: 'ES256', kid: 'es-key-1' })).split('.')[2];

    const cases: Record<string, string> = {
      'wrong issuer': await signEs256(claims({ iss: 'http://evil.example/auth/v1' })),
      "aud 'anon'": await signEs256(claims({ aud: 'anon' })),
      "role 'anon'": await signEs256(claims({ role: 'anon' })),
      "role 'service_role'": await signEs256(claims({ role: 'service_role' })),
      'missing role': await signEs256(claims({ role: undefined })),
      'missing sub': await signEs256(withoutSub),
      'empty sub': await signEs256(claims({ sub: '' })),
      'expired by 31 s': await signEs256(claims({ exp: NOW_S - 31 })),
      "alg 'none'": `${b64url({ alg: 'none', typ: 'JWT' })}.${payload}.`,
      HS256: await sign(claims(), new TextEncoder().encode('legacy-shared-jwt-secret-0123456789'), {
        alg: 'HS256',
        kid: 'es-key-1',
      }),
      'ES384 (not allow-listed)': await sign(claims(), es384.privateKey, { alg: 'ES384', kid: 'es384-key-1' }),
      'bad signature': `${header}.${payload}.${otherSig}`,
      garbage: 'not-a-token',
      empty: '',
    };

    const messages = new Set<string>();
    for (const [name, token] of Object.entries(cases)) {
      const result = await verifier.verify(token);
      expect(result.data, name).toBeNull();
      expect(result.error?.code, name).toBe('UNAUTHORIZED');
      messages.add(result.error!.message);
    }
    expect(messages.size).toBe(1);
  });

  it('gives UNAUTHORIZED, without throwing, when the key set cannot be fetched', async () => {
    const down = createTokenVerifier({
      supabaseUrl: SUPABASE_URL,
      fetch: async () => {
        throw new TypeError('network down');
      },
      now: () => NOW_MS,
    });
    const result = await down.verify(await signEs256());
    expect(result.error?.code).toBe('UNAUTHORIZED');
    expect(result.error?.message).toBe(await expectUnauthorized('garbage'));
  });

  it('refetches the key set at most once per 60 s for unknown key IDs', async () => {
    expect((await verifier.verify(await signEs256())).data?.playerId).toBe(SUB);
    expect(fetchCalls).toHaveLength(1);

    for (let i = 0; i < 10; i += 1) {
      const token = await sign(claims(), stranger.privateKey, { alg: 'ES256', kid: `unknown-${i}` });
      await expectUnauthorized(token);
    }
    expect(fetchCalls.length - 1).toBeLessThanOrEqual(1);
    expect(fetchCalls.every((url) => url === JWKS_URL)).toBe(true);
  });

  it('makes at most one fetch for 10 concurrent unknown-kid tokens', async () => {
    expect((await verifier.verify(await signEs256())).data?.playerId).toBe(SUB);
    clock += 61_000;
    const tokens = await Promise.all(
      Array.from({ length: 10 }, (_, i) => sign(claims(), stranger.privateKey, { alg: 'ES256', kid: `unknown-${i}` })),
    );
    const results = await Promise.all(tokens.map((t) => verifier.verify(t)));
    expect(results.every((r) => r.error?.code === 'UNAUTHORIZED')).toBe(true);
    expect(fetchCalls).toHaveLength(2);
  });

  it('makes 10 concurrent first verifies share one initial fetch', async () => {
    const token = await signEs256();
    const results = await Promise.all(Array.from({ length: 10 }, () => verifier.verify(token)));
    expect(results.every((r) => r.data?.playerId === SUB)).toBe(true);
    expect(fetchCalls).toHaveLength(1);
  });

  it('fetches at most once per 60 s window while the key set cannot be fetched', async () => {
    let attempts = 0;
    const failing = createTokenVerifier({
      supabaseUrl: SUPABASE_URL,
      fetch: async () => {
        attempts += 1;
        return new Response('unavailable', { status: 503 });
      },
      now: () => clock,
    });
    const token = await signEs256();
    for (let i = 0; i < 5; i += 1) expect((await failing.verify(token)).error?.code).toBe('UNAUTHORIZED');
    expect(attempts).toBe(1);
    clock += 59_999;
    for (let i = 0; i < 5; i += 1) await failing.verify(token);
    expect(attempts).toBe(1);
    clock += 1;
    for (let i = 0; i < 5; i += 1) await failing.verify(token);
    expect(attempts).toBe(2);
  });

  it('accepts a rotated-in key on the first unknown-kid token after 60 s', async () => {
    published = [es256.publicJwk];
    expect((await verifier.verify(await signEs256())).data?.playerId).toBe(SUB);
    expect(fetchCalls).toHaveLength(1);

    const rotated = await makeKey('ES256', 'es-key-2');
    published = [es256.publicJwk, rotated.publicJwk];
    const token = await sign(claims({ exp: NOW_S + 7200 }), rotated.privateKey, { alg: 'ES256', kid: 'es-key-2' });

    clock += 30_000;
    await expectUnauthorized(token);
    expect(fetchCalls).toHaveLength(1);

    clock += 30_000;
    expect((await verifier.verify(token)).data?.playerId).toBe(SUB);
    expect(fetchCalls).toHaveLength(2);
  });
});
