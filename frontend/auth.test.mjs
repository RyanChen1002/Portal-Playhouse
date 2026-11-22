import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticate } from './auth.js';

test('registration passes the three contract fields and returns the server profile', async () => {
  const profile = { id: 'player', displayName: 'Player-123', avatarId: 'avatar-01' };
  const client = { signUp: async input => {
    assert.deepEqual(input, { email: 'player@example.test', password: 'password123', displayName: 'Explorer' });
    return { data: profile, error: null };
  } };
  assert.equal(await authenticate(client, 'signup', { email: 'player@example.test', password: 'password123', displayName: 'Explorer' }), profile);
});

test('sign in does not send registration-only fields', async () => {
  const client = { signIn: async input => {
    assert.deepEqual(input, { email: 'a@b.test', password: 'password123' });
    return { data: { id: 'a' }, error: null };
  } };
  assert.equal((await authenticate(client, 'signin', { email: 'a@b.test', password: 'password123', displayName: 'ignored' })).id, 'a');
});

for (const code of ['DISPLAY_NAME_TAKEN', 'EMAIL_TAKEN', 'WEAK_PASSWORD', 'RATE_LIMITED', 'SERVICE_UNAVAILABLE']) {
  test(`registration reports ${code} without accepting a profile`, async () => {
    const client = { signUp: async () => ({ data: null, error: { code, field: 'displayName', message: 'Backend details' } }) };
    await assert.rejects(authenticate(client, 'signup', {}), e => e.code === code && e.field === 'displayName' && e.message !== 'Backend details');
  });
}

test('a missing signup session explains confirmation without claiming success', async () => {
  const client = { signUp: async () => ({ data: null, error: { code: 'SERVICE_UNAVAILABLE', message: 'Sign-up did not return a session. Please try again later.' } }) };
  await assert.rejects(authenticate(client, 'signup', {}), /check your email.*sign in/i);
});
