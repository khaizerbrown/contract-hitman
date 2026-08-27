import { describe, it, expect } from 'vitest';
import { BALANCE } from '../../config/balance.js';
import { buildBaseDeck, cardCount, hitmanCount, seedHitmen, makeCard } from '../deck.js';
import { Game } from '../game.js';

describe('Deck and setup', () => {
  it('puts 1 Hitman card in the deck for a 2-player game', () => {
    expect(hitmanCount(2)).toBe(1);
  });

  it('puts 4 Hitman cards in the deck for a 5-player game', () => {
    expect(hitmanCount(5)).toBe(4);
  });

  it('puts 9 Hitman cards in the deck for a 10-player game', () => {
    expect(hitmanCount(10)).toBe(9);
  });

  it('builds a bigger deck as more players join', () => {
    const two = buildBaseDeck(2).length;
    const five = buildBaseDeck(5).length;
    const ten = buildBaseDeck(10).length;
    expect(two).toBe(28);
    expect(five).toBe(52);
    expect(ten).toBe(104);
    expect(two).toBeLessThan(five);
    expect(five).toBeLessThan(ten);
  });

  it('leaves 21 cards to draw from in a 2-player game', () => {
    const g = Game.create({ players: [p('a'), p('b')], seed: 7 });
    expect(g.state.deck.length).toBe(21);
  });

  it('leaves 36 cards to draw from in a 5-player game', () => {
    const g = Game.create({ players: ['a', 'b', 'c', 'd', 'e'].map(p), seed: 7 });
    expect(g.state.deck.length).toBe(36);
  });

  it('leaves 73 cards to draw from in a 10-player game', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const g = Game.create({ players: ids.map(p), seed: 7 });
    expect(g.state.deck.length).toBe(73);
  });

  it('puts exactly one Mimic in the deck, at every table size', () => {
    for (let players = 2; players <= 12; players++) {
      expect(cardCount('MIMIC', players)).toBe(1);
    }
  });

  it('deals every player one Angel plus four more cards', () => {
    const g = Game.create({ players: ['a', 'b', 'c'].map(p), seed: 3 });
    for (const player of g.state.players) {
      expect(player.hand.length).toBe(5);
      expect(player.hand.filter((c) => c.type === 'ANGEL').length).toBeGreaterThanOrEqual(1);
    }
  });

  it('never hides a Hitman card in the top of the deck, so the game opens safe', () => {
    const holder = { rngState: 42 };
    const base = Array.from({ length: 100 }, () => makeCard('PEEK'));
    const seeded = seedHitmen(holder, base, 9);
    const safeTop = Math.floor(100 * BALANCE.hitmanSafeTopFraction);
    seeded.forEach((card, index) => {
      if (card.type === 'HITMAN') expect(index).toBeGreaterThanOrEqual(safeTop);
    });
  });

  it('refuses a match with fewer than 2 players', () => {
    expect(() => Game.create({ players: [p('a')] })).toThrow();
  });

  it('refuses a match with more than 12 players', () => {
    const many = Array.from({ length: 13 }, (_, i) => p(`p${i}`));
    expect(() => Game.create({ players: many })).toThrow();
  });
});

function p(id: string) {
  return { id, name: id.toUpperCase() };
}
