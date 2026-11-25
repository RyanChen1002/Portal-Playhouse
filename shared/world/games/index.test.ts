import { describe, expect, it } from 'vitest';
import { GAME_TYPES, TARGET_PATTERN } from '../../contracts';
import { GAMES } from './index';

describe('game registration', () => {
  it('registers exactly the contract game types', () => {
    expect(GAMES.map((g) => g.gameType).sort()).toEqual([...GAME_TYPES].sort());
    expect(GAMES.map((g) => g.gameType).sort()).toEqual(['portal-partners', 'power-up-workshop']);
  });

  it('every module target is a valid interaction target', () => {
    for (const g of GAMES) {
      for (const t of g.targets) expect(TARGET_PATTERN.test(t), `${g.gameType}: ${t}`).toBe(true);
    }
  });
});
