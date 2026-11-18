import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorldConnection } from '../contracts/index';
import { createMockPlayers, createMockPortalClient, createMockStore } from '../mocks/index';
import { TEST_PASSWORD } from './contract-suite';
import { describeWorldContract, waitFor } from './world-contract-suite';

// One store for the whole file, like one world and one database shared by every player.
const store = createMockStore();
const token = () => `w${randomUUID().replace(/-/g, '').slice(0, 8)}`;

async function newSignedInClient() {
  const client = createMockPortalClient({ store });
  const name = token();
  const r = await client.signUp({ email: `${name}@example.test`, password: TEST_PASSWORD, displayName: name });
  if (r.error) throw new Error(`sign-up failed: ${r.error.code}`);
  return client;
}

describeWorldContract('mock', { newSignedInClient });

describe('mock world extras', () => {
  const open: WorldConnection[] = [];
  afterEach(async () => {
    await Promise.all(open.splice(0).map((c) => c.leaveWorld()));
  });

  it('createMockPlayers adds connected lobby players that another client sees', async () => {
    const bots = await createMockPlayers(store, 3);
    open.push(...bots);
    expect(bots).toHaveLength(3);
    for (const bot of bots) {
      expect(bot.state).toBe('connected');
      expect(bot.snapshot().self.roomId).toBe('lobby');
    }

    const client = await newSignedInClient();
    const conn = (await client.connectWorld()).data!;
    open.push(conn);
    const ids = conn.snapshot().room.players.map((p) => p.id);
    for (const bot of bots) expect(ids).toContain(bot.playerId);
    expect(store.world.slotsUsed()).toBeGreaterThanOrEqual(4);
  });

  it('signOut leaves the world first', async () => {
    const client = await newSignedInClient();
    const conn = (await client.connectWorld()).data!;
    const watcher = (await (await newSignedInClient()).connectWorld()).data!;
    open.push(watcher);
    await waitFor(() => watcher.snapshot().room.players.some((p) => p.id === conn.playerId), 'watcher to see player');
    expect((await client.signOut()).error).toBeNull();
    expect(conn.state).toBe('closed');
    await waitFor(
      () => !watcher.snapshot().room.players.some((p) => p.id === conn.playerId),
      'player to leave the world',
    );
  });

  it('connectWorld when signed out is UNAUTHORIZED', async () => {
    const client = createMockPortalClient({ store });
    const r = await client.connectWorld();
    expect(r.error?.code).toBe('UNAUTHORIZED');
    expect((await client.getMyResults()).error?.code).toBe('UNAUTHORIZED');
  });
});
