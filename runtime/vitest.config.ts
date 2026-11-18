import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      // Tests never read runtime/.dev.vars; this placeholder satisfies `secrets.required`.
      miniflare: { bindings: { SUPABASE_SECRET_KEY: 'test-secret-key' } },
    }),
  ],
  test: {
    include: ['test/**/*.test.ts'],
  },
});
