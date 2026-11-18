// The world contract suite against the real client, the local runtime and local Supabase.
// Requires the local stack (`npm run db:start`); the runtime is started here.
import { afterAll, beforeAll } from 'vitest';
import { signedInRuntimeClient, startLocalRuntime, type LocalRuntime } from './runtime-env';
import { describeWorldContract } from './world-contract-suite';

let runtime: LocalRuntime;

beforeAll(async () => {
  runtime = await startLocalRuntime();
}, 120_000);

afterAll(async () => {
  await runtime?.stop();
});

describeWorldContract('real', {
  newSignedInClient: async () => (await signedInRuntimeClient(runtime)).client,
});
