// Starts the local runtime (runtime/wrangler.jsonc) for integration tests with wrangler's
// test harness (`createTestHarness`, the successor of the deprecated `unstable_startWorker`).
// It runs against the local Supabase stack only and refuses any other Supabase URL.
import { fileURLToPath } from 'node:url';
import { createTestHarness, type TestHarness } from 'wrangler';
import { createTestAccounts, type TestAccount } from '../../scripts/create-test-accounts';
import { assertLocalUrl, type LocalSupabaseEnv } from '../../scripts/local-env';
import { createMemoryStorage, createPortalClient, type SocketLike } from '../client/index';
import type { PortalClient } from '../contracts/index';
import { localEnv } from './real-factory';

/** The local preview origin. Node clients send it so the Worker's Origin check passes. */
export const TEST_ORIGIN = 'http://127.0.0.1:4173';

const CONFIG_PATH = fileURLToPath(new URL('../../runtime/wrangler.jsonc', import.meta.url));

export interface LocalRuntime {
  /** The WebSocket URL, including `/connect`. */
  readonly runtimeUrl: string;
  readonly supabase: LocalSupabaseEnv;
  /**
   * Reloads the Worker with the base vars plus `vars` (for example `ROUND_MS`). The World
   * object restarts, so all live state and connections are lost.
   */
  restart(vars?: Record<string, string>): Promise<void>;
  stop(): Promise<void>;
}

/** Starts the runtime against the local Supabase stack. Throws for a non-local Supabase URL. */
export async function startLocalRuntime(vars: Record<string, string> = {}): Promise<LocalRuntime> {
  const supabase = await localEnv();
  assertLocalUrl(supabase.url);

  const options = (extra: Record<string, string>) => ({
    workers: [
      {
        configPath: CONFIG_PATH,
        vars: { SUPABASE_URL: supabase.url, ALLOWED_ORIGINS: TEST_ORIGIN, ...extra },
        secrets: { SUPABASE_SECRET_KEY: supabase.secretKey },
      },
    ],
  });
  const harness: TestHarness = createTestHarness(options(vars));
  let runtimeUrl = toWsUrl((await harness.listen()).url);

  return {
    get runtimeUrl() {
      return runtimeUrl;
    },
    supabase,
    async restart(next = {}) {
      await harness.update(options(next));
      runtimeUrl = toWsUrl((await harness.listen()).url);
    },
    stop: () => harness.close(),
  };
}

function toWsUrl(url: URL): string {
  const u = new URL('/connect', url);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

export interface RuntimeClient {
  client: PortalClient;
  account: TestAccount;
  /** Every socket this client opened, oldest first; tests close one to simulate a drop. */
  sockets: SocketLike[];
}

/**
 * A real client signed in to `account` (a new test account when omitted), connecting to the
 * runtime with the allowed Origin header.
 */
export async function signedInRuntimeClient(runtime: LocalRuntime, account?: TestAccount): Promise<RuntimeClient> {
  const { url, publishableKey } = runtime.supabase;
  const acc = account ?? (await createTestAccounts(1, runtime.supabase, { prefix: 'rw' }))[0]!;
  const sockets: SocketLike[] = [];
  const client = createPortalClient({
    url,
    publishableKey,
    storage: createMemoryStorage(),
    runtimeUrl: runtime.runtimeUrl,
    openSocket: () => {
      // The current URL, which may change when the runtime restarts.
      // Node's WebSocket (undici) accepts headers; browsers set Origin themselves.
      const Ctor = WebSocket as unknown as new (u: string, init: { headers: Record<string, string> }) => SocketLike;
      const ws = new Ctor(runtime.runtimeUrl, { headers: { Origin: TEST_ORIGIN } });
      sockets.push(ws);
      return ws;
    },
  });
  const signedIn = await client.signIn({ email: acc.email, password: acc.password });
  if (signedIn.error) throw new Error(`sign-in failed: ${signedIn.error.code}`);
  return { client, account: acc, sockets };
}
