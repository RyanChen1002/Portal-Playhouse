// Contract factory for the real client against the local Supabase stack.
// Names and emails are random so reruns against the same database never collide.
import { randomBytes } from 'node:crypto';
import { getLocalSupabaseEnv, type LocalSupabaseEnv } from '../../scripts/local-env';
import { createMemoryStorage, createPortalClient } from '../client/index';
import type { ContractFactory } from './contract-suite';

let envPromise: Promise<LocalSupabaseEnv> | undefined;

/** Local stack URL and keys, read once per test file. */
export function localEnv(): Promise<LocalSupabaseEnv> {
  envPromise ??= getLocalSupabaseEnv();
  return envPromise;
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

export function realFactory(prefix: string): ContractFactory {
  return {
    async newClient() {
      const { url, publishableKey } = await localEnv();
      return createPortalClient({ url, publishableKey, storage: createMemoryStorage() });
    },
    uniqueEmail: () => `${prefix}-${hex(6)}@example.test`,
    // 'r' + 8 lowercase hex: ASCII, 9 code points, always contains a lowercase letter.
    uniqueName: () => `r${hex(4)}`,
  };
}
