import { createLocalJWKSet, errors, jwtVerify, type JSONWebKeySet } from 'jose';
import type { AppError, Result } from '../../shared/contracts/types';

export interface VerifiedIdentity {
  playerId: string;
  /** Token expiry, epoch milliseconds. */
  expiresAt: number;
}

export interface TokenVerifier {
  /** Never throws. Every failure gives the same `UNAUTHORIZED` error. */
  verify(token: string): Promise<Result<VerifiedIdentity>>;
}

export interface TokenVerifierOptions {
  supabaseUrl: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Only Supabase's asymmetric algorithms; never `none` or a symmetric one. */
const ALGORITHMS = ['ES256', 'RS256'];
const AUDIENCE = 'authenticated';
const ROLE = 'authenticated';
const CLOCK_TOLERANCE_S = 30;
/** Minimum time between key-set fetches, so invented key IDs cannot make us call Supabase repeatedly. */
const JWKS_COOLDOWN_MS = 60_000;
const JWKS_FETCH_TIMEOUT_MS = 5_000;

/** Identical for every failure; it never says which check failed. */
const UNAUTHORIZED: Result<VerifiedIdentity> = Object.freeze({
  data: null,
  error: Object.freeze<AppError>({ code: 'UNAUTHORIZED', message: 'Your session is not valid. Please sign in again.' }),
});

type KeySet = ReturnType<typeof createLocalJWKSet>;

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const base = opts.supabaseUrl.replace(/\/+$/, '');
  const issuer = `${base}/auth/v1`;
  const jwksUrl = `${issuer}/.well-known/jwks.json`;
  const now = opts.now ?? Date.now;
  const fetchImpl: typeof fetch = opts.fetch ?? ((input, init) => fetch(input, init));

  let keys: KeySet | null = null;
  let lastAttempt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<void> | null = null;

  /**
   * Fetches the key set unless a fetch is already running (join it) or the last attempt,
   * successful or not, was under 60 s ago (skip). A failed fetch keeps the previous keys.
   */
  function refreshKeys(): Promise<void> {
    if (inFlight) return inFlight;
    if (now() - lastAttempt < JWKS_COOLDOWN_MS) return Promise.resolve();
    lastAttempt = now();
    inFlight = (async () => {
      try {
        const res = await fetchImpl(jwksUrl, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return;
        keys = createLocalJWKSet((await res.json()) as JSONWebKeySet);
      } catch {
        // Keep the previous keys; the cooldown limits the next attempt.
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  async function check(token: string, keySet: KeySet): Promise<Result<VerifiedIdentity>> {
    const { payload } = await jwtVerify(token, keySet, {
      algorithms: ALGORITHMS,
      issuer,
      audience: AUDIENCE,
      clockTolerance: CLOCK_TOLERANCE_S,
      currentDate: new Date(now()),
      requiredClaims: ['exp', 'sub'],
    });
    if (payload.role !== ROLE) return UNAUTHORIZED;
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) return UNAUTHORIZED;
    if (typeof payload.exp !== 'number') return UNAUTHORIZED;
    // Effective deadline: the token is accepted until exp + tolerance.
    return { data: { playerId: payload.sub, expiresAt: (payload.exp + CLOCK_TOLERANCE_S) * 1000 }, error: null };
  }

  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length === 0) return UNAUTHORIZED;
      try {
        if (!keys) await refreshKeys();
        const current = keys;
        if (!current) return UNAUTHORIZED;
        try {
          return await check(token, current);
        } catch (err) {
          if (!(err instanceof errors.JWKSNoMatchingKey)) return UNAUTHORIZED;
          await refreshKeys();
          if (!keys || keys === current) return UNAUTHORIZED;
          return await check(token, keys);
        }
      } catch {
        // Deliberately no logging: the error may describe the token.
        return UNAUTHORIZED;
      }
    },
  };
}
