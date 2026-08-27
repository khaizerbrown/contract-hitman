import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import { cardOf, filler, handTypes, passAll } from './helpers.js';

function twoPlayers(aHand: string[], bHand: string[], deck: string[]) {
  return Game.forTest({
    players: [
      { id: 'a', name: 'A', hand: aHand as never },
      { id: 'b', name: 'B', hand: bHand as never },
    ],
    deck: deck as never,
  });
}

describe('Drawing a Hitman', () => {
  it('eliminates a player who has no Angel', () => {
    const g = twoPlayers(['PEEK'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    expect(g.player('a').alive).toBe(false);
  });

  it('saves a player holding an Angel and uses the Angel up', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    expect(g.player('a').alive).toBe(true);
    expect(handTypes(g, 'a')).not.toContain('ANGEL');
  });

  it('lets the saved player put the Hitman back on top of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    g.choose('a', 'top');
    expect(g.state.deck[0].type).toBe('HITMAN');
  });

  it('lets the saved player bury the Hitman at the bottom of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    g.choose('a', 'bottom');
    expect(g.state.deck[g.state.deck.length - 1].type).toBe('HITMAN');
  });

  it('lets the saved player slide the Hitman into the middle of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(6)]);
    g.draw('a');
    g.choose('a', 'middle');
    const middle = Math.floor((g.state.deck.length - 1) / 2);
    expect(g.state.deck[middle].type).toBe('HITMAN');
  });

  it('passes play to the next person once the Hitman is put back', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    g.choose('a', 'top');
    expect(g.currentPlayerId()).toBe('b');
  });

  it('kills a player on their second Hitman, because the Angel is gone', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', 'PEEK', 'HITMAN', ...filler(4)]);
    g.draw('a'); // first Hitman - the Angel saves A
    g.choose('a', 'bottom');
    g.draw('b'); // B draws the harmless card on top
    g.draw('a'); // second Hitman - no Angel left
    expect(g.player('a').alive).toBe(false);
  });

  it('takes the Hitman out of the game once it has killed someone', () => {
    const g = twoPlayers(['PEEK'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    expect(g.state.deck.filter((c) => c.type === 'HITMAN').length).toBe(0);
  });

  it('puts a Hitman in the middle automatically if the placement timer runs out', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(6)]);
    g.draw('a');
    g.advance(6000);
    g.checkTimers();
    expect(g.state.pending).toBeNull();
    expect(g.state.deck.filter((c) => c.type === 'HITMAN').length).toBe(1);
  });

  it('shows everyone how many Hitman cards are still in the deck', () => {
    const g = twoPlayers(['PEEK'], ['PEEK'], ['PEEK', 'HITMAN', 'HITMAN', ...filler(4)]);
    expect(g.viewFor('b').hitmenRemaining).toBe(2);
  });
});

describe('You cannot Mirror your way to a free Angel', () => {
  function angelThenHitman() {
    // A is saved by their Angel and puts the Hitman back on top, so B draws it
    // on the very next turn while holding a Mirror.
    return Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['MIRROR'] },
        { id: 'c', name: 'C', hand: ['PEEK'] },
      ],
      deck: ['HITMAN', 'HITMAN', ...filler(8)],
    });
  }

  it('does not count an Angel firing as a card anyone played', () => {
    const g = angelThenHitman();
    g.draw('a');
    g.choose('a', 'top');
    expect(g.player('a').alive).toBe(true);
    expect(g.state.lastPlayedType).toBeNull();
  });

  it('opens no reflex window when a Hitman is drawn, so Mirror cannot be played', () => {
    const g = angelThenHitman();
    g.draw('a');
    g.choose('a', 'top');
    const mirror = cardOf(g, 'b', 'MIRROR');
    g.draw('b');
    expect(g.state.pending).toBeNull();
    expect(() => g.play('b', mirror.id)).toThrow();
  });

  it('kills the player who has no Angel, Mirror in hand or not', () => {
    const g = angelThenHitman();
    g.draw('a');
    g.choose('a', 'top');
    g.draw('b');
    expect(g.player('b').alive).toBe(false);
    expect(g.player('b').hand).toEqual([]);
  });

  it('never lets Mirror produce an Angel in an ordinary reflex window either', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['PEEK'] },
        { id: 'b', name: 'B', hand: ['MIRROR'] },
      ],
      deck: filler(10),
    });
    g.play('a', cardOf(g, 'a', 'PEEK').id);
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    passAll(g);
    expect(handTypes(g, 'b')).not.toContain('ANGEL');
    expect(handTypes(g, 'b')).toEqual([]);
  });
});

describe('Winning', () => {
  it('ends the match the moment one player is left standing', () => {
    const g = twoPlayers(['PEEK'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    expect(g.state.phase).toBe('ended');
    expect(g.state.winner).toBe('b');
  });

  it('keeps playing while two or more are still alive', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['PEEK'] },
        { id: 'b', name: 'B', hand: ['PEEK'] },
        { id: 'c', name: 'C', hand: ['PEEK'] },
      ],
      deck: ['HITMAN', ...filler(8)] as never,
    });
    g.draw('a');
    expect(g.state.phase).toBe('playing');
    expect(g.state.winner).toBeNull();
  });
});
