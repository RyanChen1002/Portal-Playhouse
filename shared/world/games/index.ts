import type { GameType } from '../../contracts';
import { PORTAL_PARTNERS } from './portal-partners';
import type { GameModule } from './types';

export * from './types';
export { PORTAL_PARTNERS } from './portal-partners';

export const GAMES: readonly GameModule[] = [PORTAL_PARTNERS];

export function gameModule(gameType: GameType): GameModule {
  const found = GAMES.find((g) => g.gameType === gameType);
  if (!found) throw new Error(`Unknown game type: ${gameType}`);
  return found;
}
