import { describe, it, expect } from 'vitest';
import { BALANCE } from '../../config/balance.js';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, passAll, playAndResolve, surviveHitman } from './helpers.js';

function table(hands: Record<string, CardType[]>, deck: CardType[] = filler(30)) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('Lock', () => {
  it('bans the card that was played immediately before it', () => {
    const g = table({ a: ['SKIP'], b: ['LOCK'] });
    playAndResolve(g, 'a', 'SKIP');
    // Skip ended A's turn, so B is up and locks what A just played.
    playAndResolve(g, 'b', 'LOCK');
    expect(g.isLocked('SKIP')).toBe(true);
  });

  it('gives the player no say in what gets banned', () => {
    const g = table({ a: ['PEEK', 'LOCK'], b: [] });
    playAndResolve(g, 'a', 'PEEK');
    // Even asked for something else, the board decides.
    g.play('a', cardOf(g, 'a', 'LOCK').id, { lockType: 'ATTACK' });
    passAll(g);
    expect(g.isLocked('PEEK')).toBe(true);
    expect(g.isLocked('ATTACK')).toBe(false);
  });

  it('bans it for everyone, not just the player who locked it', () => {
    const g = table({ a: ['PEEK', 'LOCK'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'LOCK');
    g.draw('a');
    expect(() => g.play('b', cardOf(g, 'b', 'PEEK').id)).toThrow();
  });

  it('lifts after exactly 3 player-turns', () => {
    const g = table({ a: ['PEEK', 'LOCK', 'SKIP'], b: ['SKIP', 'SKIP'] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'LOCK');
    g.draw('a');

    expect(g.isLocked('PEEK')).toBe(true); // turn 1 of the ban - B
    g.draw('b');
    expect(g.isLocked('PEEK')).toBe(true); // turn 2 - A
    g.draw('a');
    expect(g.isLocked('PEEK')).toBe(true); // turn 3 - B
    g.draw('b');
    expect(g.isLocked('PEEK')).toBe(false);
  });

  it('says 3 turns the moment it is played, not 4', () => {
    // The screen must never show the extra turn the engine carries internally.
    const g = table({ a: ['PEEK', 'LOCK'], b: [] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'LOCK');
    expect(g.viewFor('a').locks).toEqual([{ type: 'PEEK', turnsRemaining: 3 }]);
    expect(g.viewFor('b').locks).toEqual([{ type: 'PEEK', turnsRemaining: 3 }]);
  });

  it('counts down visibly so players know when it lifts', () => {
    const g = table({ a: ['PEEK', 'LOCK'], b: [] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'LOCK');
    g.draw('a');
    expect(g.viewFor('b').locks).toEqual([{ type: 'PEEK', turnsRemaining: 3 }]);
    g.draw('b');
    expect(g.viewFor('a').locks).toEqual([{ type: 'PEEK', turnsRemaining: 2 }]);
  });

  it('can ban another Lock, if a Lock was the last thing played', () => {
    const g = table({ a: ['PEEK', 'LOCK'], b: ['LOCK'] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'LOCK'); // bans PEEK, and is now the last card played
    g.draw('a');
    playAndResolve(g, 'b', 'LOCK');
    expect(g.isLocked('LOCK')).toBe(true);
  });

  it('refuses to be played when nothing has been played yet', () => {
    const g = table({ a: ['LOCK'], b: [] });
    expect(() => g.play('a', cardOf(g, 'a', 'LOCK').id)).toThrow(
      /nothing has been played yet/i,
    );
  });

  it('can never ban a Hitman, because a Hitman is never played', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['PEEK', 'LOCK'] },
      ],
      deck: ['HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'bottom');
    playAndResolve(g, 'b', 'PEEK');
    playAndResolve(g, 'b', 'LOCK');
    expect(g.isLocked('HITMAN')).toBe(false);
    expect(g.isLocked('PEEK')).toBe(true);
  });

  it('can ban an Angel, once somebody has put one down', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['LOCK'] },
      ],
      deck: ['HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'bottom'); // the Angel is now the last card played
    playAndResolve(g, 'b', 'LOCK');
    expect(g.isLocked('ANGEL')).toBe(true);
  });

  it('with Angel banned, the next Hitman simply kills whoever draws it', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL', 'ANGEL'] },
        { id: 'b', name: 'B', hand: ['LOCK'] },
      ],
      deck: ['HITMAN', 'HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'top');
    playAndResolve(g, 'b', 'LOCK'); // bans ANGEL
    g.draw('b'); // B takes the Hitman off the top and has no Angel anyway
    expect(g.isLocked('ANGEL')).toBe(true);
    expect(g.player('b').alive).toBe(false);
  });
});

describe('Steal', () => {
  it('lets the target pick which card they hand over, not the thief', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK', 'SKIP', 'MIMIC'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });

    expect(g.state.pending?.kind).toBe('steal');
    const chosen = cardOf(g, 'b', 'SKIP');
    g.choose('b', chosen.id);

    expect(handTypes(g, 'a')).toEqual(['SKIP']);
    expect(handTypes(g, 'b').sort()).toEqual(['MIMIC', 'PEEK']);
  });

  it('does not let the thief make the choice', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });
    const card = cardOf(g, 'b', 'SKIP');
    expect(() => g.choose('a', card.id)).toThrow();
  });

  it('picks a card for the target if their timer runs out', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });
    g.advance(6000);
    g.checkTimers();
    expect(g.state.pending).toBeNull();
    expect(g.player('a').hand.length).toBe(1);
    expect(g.player('b').hand.length).toBe(1);
  });

  it('only shows the choices to the player who has to choose', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });
    const forB = g.viewFor('b').pending as { options: unknown[] | null };
    const forA = g.viewFor('a').pending as { options: unknown[] | null };
    expect(forB.options?.length).toBe(2);
    expect(forA.options).toBeNull();
  });
});

describe('A Steal with nothing left to take', () => {
  /**
   * Defensive. Reaching into an empty hand used to throw a TypeError, and that
   * throw happened inside the server's tick timer, where it would have ended the
   * process and every match on it.
   */
  it('does not fall over if their hand empties before they answer', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });
    expect(g.state.pending?.kind).toBe('steal');

    g.player('b').hand = [];

    expect(() => {
      g.advance(10000);
      g.checkTimers();
    }).not.toThrow();
    expect(g.state.pending).toBeNull();
    expect(g.state.phase).toBe('playing');
  });

  it('carries the turn on rather than stopping dead', () => {
    const g = table({ a: ['STEAL'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'b' });
    g.player('b').hand = [];
    g.advance(10000);
    g.checkTimers();
    expect(() => g.draw('a')).not.toThrow();
    expect(g.currentPlayerId()).toBe('b');
  });
});

describe('Mimic', () => {
  it('gives you a copy of their hand and they keep theirs', () => {
    const g = table({ a: ['MIMIC'], b: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a').sort()).toEqual(['PEEK', 'SKIP']);
    expect(handTypes(g, 'b').sort()).toEqual(['PEEK', 'SKIP']);
  });

  it('throws your own hand away to do it', () => {
    const g = table({ a: ['MIMIC', 'ATTACK', 'BURN'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual(['PEEK']);
  });

  it('copies their Angel across', () => {
    const g = table({ a: ['MIMIC', 'PEEK'], b: ['ANGEL', 'ANGEL'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual(['ANGEL', 'ANGEL']);
    expect(handTypes(g, 'b')).toEqual(['ANGEL', 'ANGEL']);
  });

  it('costs you your own Angel, so it is a real gamble', () => {
    const g = table({ a: ['MIMIC', 'ANGEL'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual(['PEEK']);
    expect(handTypes(g, 'a')).not.toContain('ANGEL');
  });

  it('leaves you with nothing at all if their hand is empty', () => {
    const g = table({ a: ['MIMIC', 'ANGEL', 'ATTACK'], b: [] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual([]);
  });

  it("Mr K's example: hand of Skip and Mirror, mimic someone holding an Angel", () => {
    const g = table({
      a: ['MIMIC', 'SKIP', 'MIRROR'],
      b: ['ANGEL', 'ATTACK', 'PEEK'],
    });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });

    // The Skip and the Mirror are gone. Their whole hand is yours, Angel and all.
    expect(handTypes(g, 'a').sort()).toEqual(['ANGEL', 'ATTACK', 'PEEK']);
    // And they still have theirs.
    expect(handTypes(g, 'b').sort()).toEqual(['ANGEL', 'ATTACK', 'PEEK']);
  });

  it('is a reliable way to take an Angel early, because everyone starts with one', () => {
    const g = Game.create({
      players: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
      seed: 4242,
    });
    // Everyone is dealt an Angel, so anyone who has not been shot at still has it.
    expect(g.player('b').hand.filter((c) => c.type === 'ANGEL').length).toBeGreaterThan(0);
  });

  it('never copies another Mimic, so Mimic cards cannot breed', () => {
    const g = table({ a: ['MIMIC'], b: ['MIMIC', 'MIMIC', 'PEEK'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual(['PEEK']);
    expect(handTypes(g, 'b').sort()).toEqual(['MIMIC', 'MIMIC', 'PEEK']);
  });

  it('stops at the hand ceiling, so a hand stays readable on a phone', () => {
    const huge: CardType[] = Array.from({ length: 25 }, () => 'PEEK');
    const g = table({ a: ['MIMIC'], b: huge });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(g.player('a').hand.length).toBe(BALANCE.maxHandSize);
    expect(g.player('b').hand.length).toBe(25);
  });

  it('says in the log what it cost you', () => {
    const g = table({ a: ['MIMIC', 'ATTACK', 'BURN'], b: ['PEEK'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    const entry = g.state.log.find((e) => e.t === 'mimicked');
    expect(entry).toMatchObject({ cards: 1, lost: 2 });
  });
});
