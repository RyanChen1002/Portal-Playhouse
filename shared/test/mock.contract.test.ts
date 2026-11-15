import { randomUUID } from 'node:crypto';
import { createMockPortalClient, createMockStore } from '../mocks/index';
import { describeClientContract } from './contract-suite';

// One store for the whole file, like one persistent database shared by every player.
const store = createMockStore();
let counter = 0;
const nextToken = () => `m${(counter++).toString(36)}${randomUUID().replace(/-/g, '').slice(0, 6)}`;

describeClientContract('mock', {
  newClient: async () => createMockPortalClient({ store }),
  uniqueEmail: () => `${nextToken()}@example.test`,
  uniqueName: () => nextToken(),
});
