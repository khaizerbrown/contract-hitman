import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import { filler } from './helpers.js';

function threePlayers() {
  return Game.forTest({
    players: [
      { id: 'a', name: 'A', hand: ['PEEK'] },
      { id: 'b', name: 'B', hand: ['SKIP', 'MIMIC'] },
      { id: 'c', name: 'C', hand: ['STEAL'] },
    ],
    deck: ['HITMAN', ...filler(20)],
  });
}

describe('What each player is allowed to see', () => {
  it('shows you your own hand', () => {
    const g = threePlayers();
    expect(g.viewFor('b').you?.hand.map((c) => c.type)).toEqual(['SKIP', 'MIMIC']);
  });

  it('never sends anyone else a living player\'s cards', () => {
    const g = threePlayers();
    const bsCardIds = g.player('b').hand.map((c) => c.id);
    const seenByA = JSON.stringify(g.viewFor('a'));
    for (const id of bsCardIds) expect(seenByA).not.toContain(id);
  });

  it('shows only how many cards other players hold', () => {
    const g = threePlayers();
    const view = g.viewFor('a');
    const b = view.players.find((p) => p.id === 'b');
    expect(b?.handCount).toBe(2);
    expect(b).not.toHaveProperty('hand');
  });

  it('cuts an eliminated player off from every hand while they watch', () => {
    const g = threePlayers();
    g.draw('a'); // A draws the Hitman with no Angel and is out
    expect(g.player('a').alive).toBe(false);

    const view = g.viewFor('a');
    expect(view.you?.hand).toEqual([]);
    const dump = JSON.stringify(view);
    for (const p of ['b', 'c']) {
      for (const card of g.player(p).hand) expect(dump).not.toContain(card.id);
    }
  });

  it('gives a pure spectator no hand at all', () => {
    const g = threePlayers();
    const view = g.viewFor(null);
    expect(view.you).toBeNull();
    const dump = JSON.stringify(view);
    for (const p of ['a', 'b', 'c']) {
      for (const card of g.player(p).hand) expect(dump).not.toContain(card.id);
    }
  });

  it('never sends the deck order to anybody', () => {
    const g = threePlayers();
    const dump = JSON.stringify(g.viewFor('a'));
    for (const card of g.state.deck) expect(dump).not.toContain(card.id);
  });

  it('stops an eliminated player playing cards', () => {
    const g = threePlayers();
    g.draw('a');
    expect(() => g.play('a', 'anything')).toThrow();
  });
});
