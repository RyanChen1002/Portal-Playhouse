export { WorldObject } from './world-object';

/** The single World object's fixed name. */
const WORLD_NAME = 'world';

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

/**
 * Accepts WebSocket upgrades at GET /connect from an allowed frontend origin and forwards
 * them to the World object. No game logic here.
 */
export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/connect' || request.method !== 'GET') {
      return new Response('Not found', { status: 404 });
    }
    const origin = request.headers.get('Origin');
    if (origin === null || !allowedOrigins(env).includes(origin)) {
      return new Response('Forbidden', { status: 403 });
    }
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }
    return env.WORLD.getByName(WORLD_NAME).fetch(request);
  },
} satisfies ExportedHandler<Env>;
