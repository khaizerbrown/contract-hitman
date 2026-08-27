import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import { BALANCE } from '../../config/balance.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, playAndResolve } from './helpers.js';

function table(hands: Record<string, CardType[]>, deck: CardType[] = filler(30)) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('Taking a turn', () => {
  it('lets you play as many cards as you like before drawing', () => {
    const g = table({ a: ['PEEK', 'PEEK', 'PEEK'], b: [] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'PEEK');
    expect(g.currentPlayerId()).toBe('a');
    expect(handTypes(g, 'a')).toEqual(['PEEK']);
  });

  it('ends your turn the moment you draw', () => {
    const g = table({ a: [], b: [] });
    g.draw('a');
    expect(g.currentPlayerId()).toBe('b');
  });

  it('refuses a card played out of turn', () => {
    const g = table({ a: [], b: ['PEEK'] });
    expect(() => g.play('b', cardOf(g, 'b', 'PEEK').id)).toThrow();
  });

  it('never lets a Hitman card be played from a hand', () => {
    const g = table({ a: ['HITMAN'], b: [] });
    expect(() => g.play('a', cardOf(g, 'a', 'HITMAN').id)).toThrow();
  });

  it('never lets an Angel be played by hand - it only works when drawn on', () => {
    const g = table({ a: ['ANGEL'], b: [] });
    expect(() => g.play('a', cardOf(g, 'a', 'ANGEL').id)).toThrow();
  });
});

describe('The 15-second turn clock', () => {
  it('draws for you and ends your turn when it runs out', () => {
    const g = table({ a: [], b: [] });
    const deckBefore = g.state.deck.length;
    g.advance(BALANCE.turnSeconds * 1000);
    g.checkTimers();
    expect(g.player('a').hand.length).toBe(1);
    expect(g.state.deck.length).toBe(deckBefore - 1);
    expect(g.currentPlayerId()).toBe('b');
  });

  it('does not reset when you play a card', () => {
    const g = table({ a: ['PEEK'], b: [] });
    const deadline = g.state.turnDeadline;
    g.advance(5000);
    playAndResolve(g, 'a', 'PEEK');
    expect(g.state.turnDeadline).toBe(deadline);
  });
});

describe('Skip', () => {
  it('ends your turn straight away with no draw', () => {
    const g = table({ a: ['SKIP'], b: [] });
    const deckBefore = g.state.deck.length;
    playAndResolve(g, 'a', 'SKIP');
    expect(g.currentPlayerId()).toBe('b');
    expect(g.state.deck.length).toBe(deckBefore);
    expect(g.player('a').hand.length).toBe(0);
  });
});

describe('Bottom Pull', () => {
  it('takes your card from the bottom of the deck instead of the top', () => {
    const g = table({ a: ['BOTTOM_PULL'], b: [] }, ['PEEK', 'PEEK', 'MIMIC']);
    playAndResolve(g, 'a', 'BOTTOM_PULL');
    g.draw('a');
    expect(handTypes(g, 'a')).toEqual(['MIMIC']);
    expect(g.state.deck.length).toBe(2);
  });
});

describe('Peek', () => {
  it('shows you the top 3 cards and nobody else', () => {
    const g = table({ a: ['PEEK'], b: [] }, ['SKIP', 'MIMIC', 'STEAL', 'PEEK']);
    playAndResolve(g, 'a', 'PEEK');
    const seen = g.viewFor('a').privateInfo;
    expect(seen.length).toBe(1);
    expect(seen[0].cards.map((c) => c.type)).toEqual(['SKIP', 'MIMIC', 'STEAL']);
    expect(g.viewFor('b').privateInfo).toEqual([]);
  });

  it('records how big the deck was, so a stale look can be hidden', () => {
    const g = table({ a: ['PEEK'], b: [] }, ['SKIP', 'MIMIC', 'STEAL', 'PEEK']);
    playAndResolve(g, 'a', 'PEEK');
    const seen = g.viewFor('a').privateInfo[0];
    expect(seen.deckCount).toBe(4);
    expect(seen.deckCount).toBe(g.viewFor('a').deckCount);

    // Once anyone draws, what they saw is no longer the top of the deck.
    g.draw('a');
    expect(g.viewFor('a').privateInfo[0].deckCount).not.toBe(g.viewFor('a').deckCount);
  });

  it('still shows a peek to the player after several looks', () => {
    const g = table({ a: ['PEEK', 'PEEK'], b: [] }, ['SKIP', 'MIMIC', 'STEAL', 'PEEK', 'LOCK']);
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'PEEK');
    const seen = g.viewFor('a').privateInfo;
    expect(seen.length).toBe(2);
    expect(seen[1].cards.map((c) => c.type)).toEqual(['SKIP', 'MIMIC', 'STEAL']);
  });
});

describe('Real Shuffle and Fake Shuffle', () => {
  it('a Real Shuffle actually changes the deck order', () => {
    const deck: CardType[] = [
      'PEEK', 'SKIP', 'MIMIC', 'STEAL', 'LOCK', 'ATTACK', 'CANCEL', 'BURN',
      'MIRROR', 'REDIRECT', 'BOTTOM_PULL', 'FULL_ATTACK', 'ANGEL', 'PEEK',
      'SKIP', 'MIMIC', 'STEAL', 'LOCK', 'ATTACK', 'CANCEL',
    ];
    const g = table({ a: ['REAL_SHUFFLE'], b: [] }, deck);
    const before = g.state.deck.map((c) => c.id).join(',');
    playAndResolve(g, 'a', 'REAL_SHUFFLE');
    expect(g.state.deck.map((c) => c.id).join(',')).not.toBe(before);
  });

  it('a Fake Shuffle leaves the deck exactly as it was', () => {
    const g = table({ a: ['FAKE_SHUFFLE'], b: [] }, filler(20));
    const before = g.state.deck.map((c) => c.id).join(',');
    playAndResolve(g, 'a', 'FAKE_SHUFFLE');
    expect(g.state.deck.map((c) => c.id).join(',')).toBe(before);
  });

  it('looks identical to everyone else either way', () => {
    const real = table({ a: ['REAL_SHUFFLE'], b: [] }, filler(20));
    const fake = table({ a: ['FAKE_SHUFFLE'], b: [] }, filler(20));
    playAndResolve(real, 'a', 'REAL_SHUFFLE');
    playAndResolve(fake, 'a', 'FAKE_SHUFFLE');
    expect(fake.viewFor('b').log).toEqual(real.viewFor('b').log);
  });
});
