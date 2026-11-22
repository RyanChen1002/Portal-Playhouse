// Keep account creation behind the existing shared client contract.
export async function authenticate(client, mode, { email, password, displayName }) {
  const result = mode === 'signup'
    ? await client.signUp({ email, password, displayName })
    : await client.signIn({ email, password });
  if (result.error) {
    const messages = {
      DISPLAY_NAME_TAKEN: 'That display name is taken. Please choose another.',
      EMAIL_TAKEN: 'An account already uses this email. Switch to Sign in.',
      WEAK_PASSWORD: 'Use a password with at least 8 characters and no more than 72 UTF-8 bytes.',
      RATE_LIMITED: 'Too many attempts. Please wait a little before trying again.',
      INVALID_CREDENTIALS: 'The email or password is incorrect.',
      SERVICE_UNAVAILABLE: 'We could not reach the account service. Please try again later.',
    };
    const missingSession = mode === 'signup' && result.error.code === 'SERVICE_UNAVAILABLE'
      && result.error.message?.includes('did not return a session');
    const message = missingSession
      ? 'Sign-up did not complete sign-in. If confirmation is required, check your email, then return here and sign in. Otherwise, contact the project team.'
      : messages[result.error.code] || result.error.message || 'Unable to sign in. Please try again.';
    throw Object.assign(new Error(message), { code: result.error.code, field: result.error.field });
  }
  if (!result.data) throw new Error('No account profile was returned. Please try signing in.');
  return result.data;
}
