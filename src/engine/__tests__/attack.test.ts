import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { filler, playAndResolve } from './helpers.js';

function table(hands: Record<string, CardType[]>, deck: CardType[]) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('Attack', () => {
  it('makes the target take two turns in a row instead of one', () => {
    const g = table({ a: ['ATTACK'], b: [], c: [] }, filler(20));
    playAndResolve(g, 'a', 'ATTACK', { targetPlayerId: 'b' });
    g.draw('a');

    expect(g.currentPlayerId()).toBe('b');
    expect(g.state.currentTurnsRemaining).toBe(2);

    g.draw('b');
    expect(g.currentPlayerId()).toBe('b');

    g.draw('b');
    expect(g.currentPlayerId()).toBe('c');
  });

  it('cannot be aimed at yourself', () => {
    const g = table({ a: ['ATTACK'], b: [], c: [] }, filler(20));
    const card = g.player('a').hand[0];
    expect(() => g.play('a', card.id, { targetPlayerId: 'a' })).toThrow();
  });
});

describe('Full Attack', () => {
  it('makes everyone except the person who played it take two turns', () => {
    const g = table({ a: ['FULL_ATTACK'], b: [], c: [] }, filler(20));
    playAndResolve(g, 'a', 'FULL_ATTACK');
    g.draw('a');

    expect(g.currentPlayerId()).toBe('b');
    expect(g.state.currentTurnsRemaining).toBe(2);
    g.draw('b');
    g.draw('b');

    expect(g.currentPlayerId()).toBe('c');
    expect(g.state.currentTurnsRemaining).toBe(2);
  });

  it('does not punish the player who played it', () => {
    const g = table({ a: ['FULL_ATTACK'], b: [], c: [] }, filler(20));
    playAndResolve(g, 'a', 'FULL_ATTACK');
    g.draw('a');
    g.draw('b');
    g.draw('b');
    g.draw('c');
    g.draw('c');
    expect(g.currentPlayerId()).toBe('a');
    expect(g.state.currentTurnsRemaining).toBe(1);
  });
});

describe('A Hitman on the table wipes every Attack', () => {
  it('frees everyone still owed extra turns, not just the player who drew it', () => {
    const g = table(
      { a: ['FULL_ATTACK'], b: ['ANGEL'], c: [], d: [] },
      ['PEEK', 'HITMAN', ...filler(20)],
    );
    playAndResolve(g, 'a', 'FULL_ATTACK');
    g.draw('a'); // A takes the harmless top card, B is up with two turns owed

    expect(g.currentPlayerId()).toBe('b');
    expect(g.state.currentTurnsRemaining).toBe(2);

    g.draw('b'); // B draws the Hitman, the Angel saves them
    g.choose('b', 'bottom');

    // B's second turn is gone, and so are C's and D's extra turns.
    expect(g.currentPlayerId()).toBe('c');
    expect(g.state.currentTurnsRemaining).toBe(1);
    expect(g.state.attackEffects.length).toBe(0);

    g.draw('c');
    expect(g.currentPlayerId()).toBe('d');
    expect(g.state.currentTurnsRemaining).toBe(1);
  });

  it('also cancels extra turns when the drawn Hitman eliminates someone', () => {
    const g = table(
      { a: ['FULL_ATTACK'], b: [], c: [], d: [] },
      ['PEEK', 'HITMAN', ...filler(20)],
    );
    playAndResolve(g, 'a', 'FULL_ATTACK');
    g.draw('a');
    g.draw('b'); // B has no Angel and is out

    expect(g.player('b').alive).toBe(false);
    expect(g.currentPlayerId()).toBe('c');
    expect(g.state.currentTurnsRemaining).toBe(1);
  });
});
