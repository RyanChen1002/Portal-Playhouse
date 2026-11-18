import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('worker stub', () => {
  it('returns 404 for every request', async () => {
    const res = await exports.default.fetch('http://example.com/');
    expect(res.status).toBe(404);
  });
});
