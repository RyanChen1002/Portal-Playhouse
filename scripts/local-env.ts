import { execFile } from 'node:child_process';

export interface LocalSupabaseEnv {
  url: string;
  publishableKey: string;
  secretKey: string;
}

export type StatusRunner = () => Promise<{ stdout: string; exitCode: number }>;

const NOT_RUNNING = 'Local Supabase is not running. Run: npx supabase start';
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost']);

export function assertLocalUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Refusing to run: not a valid URL.');
  }
  if (
    (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
    !LOCAL_HOSTNAMES.has(parsed.hostname)
  ) {
    throw new Error(
      `Refusing to run against non-local host "${parsed.hostname}". Only 127.0.0.1 and localhost are allowed.`,
    );
  }
}

export const defaultStatusRunner: StatusRunner = () =>
  new Promise((resolve, reject) => {
    execFile(
      'npx',
      ['supabase', 'status', '-o', 'json'],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          const code = (error as { code?: unknown }).code;
          if (typeof code === 'number') {
            resolve({ stdout: String(stdout), exitCode: code });
          } else {
            reject(error);
          }
          return;
        }
        resolve({ stdout: String(stdout), exitCode: 0 });
      },
    );
  });

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

export async function getLocalSupabaseEnv(
  run: StatusRunner = defaultStatusRunner,
): Promise<LocalSupabaseEnv> {
  let result: { stdout: string; exitCode: number };
  try {
    result = await run();
  } catch {
    throw new Error(NOT_RUNNING);
  }
  if (result.exitCode !== 0) throw new Error(NOT_RUNNING);

  let json: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    json = parsed as Record<string, unknown>;
  } catch {
    throw new Error(NOT_RUNNING);
  }

  const url = str(json.API_URL);
  const publishableKey = str(json.PUBLISHABLE_KEY) ?? str(json.ANON_KEY);
  const secretKey = str(json.SECRET_KEY) ?? str(json.SERVICE_ROLE_KEY);
  if (!url || !publishableKey || !secretKey) throw new Error(NOT_RUNNING);

  assertLocalUrl(url);
  return { url, publishableKey, secretKey };
}
