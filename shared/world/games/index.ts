import type { GameType } from '../../contracts';
import { PORTAL_PARTNERS } from './portal-partners';
import { POWER_UP_WORKSHOP } from './power-up-workshop';
import type { GameModule } from './types';

export * from './types';
export { PORTAL_PARTNERS } from './portal-partners';
export { POWER_UP_WORKSHOP } from './power-up-workshop';

export const GAMES: readonly GameModule[] = [PORTAL_PARTNERS, POWER_UP_WORKSHOP];

export function gameModule(gameType: GameType): GameModule {
  const found = GAMES.find((g) => g.gameType === gameType);
  if (!found) throw new Error(`Unknown game type: ${gameType}`);
  return found;
}
