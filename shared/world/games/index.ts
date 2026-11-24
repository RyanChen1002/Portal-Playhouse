import type { GameType } from '../../contracts';
import { PORTAL_PARTNERS } from './portal-partners';
import type { GameModule } from './types';

export * from './types';
export { PORTAL_PARTNERS } from './portal-partners';

// Modules are stored widened to the default type parameters.
export const GAMES: readonly GameModule[] = [PORTAL_PARTNERS as unknown as GameModule];

export function gameModule(gameType: GameType): GameModule {
  const found = GAMES.find((g) => g.gameType === gameType);
  if (!found) throw new Error(`Unknown game type: ${gameType}`);
  return found;
}
