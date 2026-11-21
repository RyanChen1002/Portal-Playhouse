// Hosted-dev load-check users: sign in, or sign up on the first run. Keeps auth calls low,
// because hosted Supabase limits sign-ins and sign-ups per IP (about 30 per 5 minutes).
import type { Result } from '../../shared/contracts/index';

export interface AuthClient {
  signIn(input: { email: string; password: string }): Promise<Result<unknown>>;
  signUp(input: { email: string; password: string; displayName: string }): Promise<Result<unknown>>;
}

/**
 * Signs each user in, in order. Once one sign-up succeeds (a first run), the rest go straight to
 * sign-up, so 16 new users cost 17 calls instead of 32; a sign-up that finds the email taken
 * (left by a partial earlier run) falls back to sign-in. Throws naming the tag and error code.
 */
export async function signInLoadUsers(
  users: Array<{ tag: string; client: AuthClient; email: string; displayName: string }>,
  password: string,
  onCreated: (email: string) => void,
): Promise<void> {
  let signingUp = false;
  for (const u of users) {
    if (!signingUp) {
      const r = await u.client.signIn({ email: u.email, password });
      if (!r.error) continue;
      if (r.error.code !== 'INVALID_CREDENTIALS') throw new Error(`${u.tag} could not sign in (${r.error.code}).`);
    }
    const up = await u.client.signUp({ email: u.email, password, displayName: u.displayName });
    if (!up.error) {
      signingUp = true;
      onCreated(u.email);
      continue;
    }
    if (signingUp && up.error.code === 'EMAIL_TAKEN') {
      const r = await u.client.signIn({ email: u.email, password });
      if (!r.error) continue;
      throw new Error(`${u.tag} could not sign in (${r.error.code}).`);
    }
    throw new Error(`${u.tag} could not sign in or sign up (${up.error.code}).`);
  }
}
