import { DurableObject } from 'cloudflare:workers';

/** Placeholder so the `WORLD` binding and `v1` migration resolve. Task 9 replaces it. */
export class WorldObject extends DurableObject<Env> {}

export default {
  async fetch(): Promise<Response> {
    return new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
