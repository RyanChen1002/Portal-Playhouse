import { createRemoteJWKSet, customFetch, jwtVerify } from 'jose';
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

/** Identical for every failure; it never says which check failed. */
const UNAUTHORIZED: Result<VerifiedIdentity> = Object.freeze({
  data: null,
  error: Object.freeze<AppError>({ code: 'UNAUTHORIZED', message: 'Your session is not valid. Please sign in again.' }),
});

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const base = opts.supabaseUrl.replace(/\/+$/, '');
  const issuer = `${base}/auth/v1`;
  const jwksUrl = new URL(`${issuer}/.well-known/jwks.json`);
  const now = opts.now ?? Date.now;
  const fetchImpl = opts.fetch;

  const jwks = createRemoteJWKSet(jwksUrl, {
    cooldownDuration: JWKS_COOLDOWN_MS,
    ...(fetchImpl ? { [customFetch]: (url: string, init: RequestInit) => fetchImpl(url, init) } : {}),
  });

  return {
    async verify(token) {
      if (typeof token !== 'string' || token.length === 0) return UNAUTHORIZED;
      try {
        const { payload } = await jwtVerify(token, jwks, {
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
        return { data: { playerId: payload.sub, expiresAt: payload.exp * 1000 }, error: null };
      } catch {
        // Deliberately no logging: the error may describe the token.
        return UNAUTHORIZED;
      }
    },
  };
}
