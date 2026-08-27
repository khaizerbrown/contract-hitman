import { describe, it, expect } from 'vitest';
import { BALANCE } from '../../config/balance.js';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, passAll, playAndResolve } from './helpers.js';

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

  it('can never ban a Hitman or an Angel, because neither is ever played', () => {
    // Draw a Hitman, be saved by the Angel, then Lock on the next turn.
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['PEEK', 'LOCK'] },
      ],
      deck: ['HITMAN', ...filler(10)],
    });
    g.draw('a');
    g.choose('a', 'bottom');
    playAndResolve(g, 'b', 'PEEK');
    playAndResolve(g, 'b', 'LOCK');
    expect(g.isLocked('HITMAN')).toBe(false);
    expect(g.isLocked('ANGEL')).toBe(false);
    expect(g.isLocked('PEEK')).toBe(true);
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

describe('Mimic', () => {
  it('copies the whole hand without taking anything away', () => {
    const g = table({ a: ['MIMIC'], b: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a').sort()).toEqual(['PEEK', 'SKIP']);
    expect(handTypes(g, 'b').sort()).toEqual(['PEEK', 'SKIP']);
  });

  it('never copies another Mimic, so Mimic cards cannot breed', () => {
    const g = table({ a: ['MIMIC'], b: ['MIMIC', 'MIMIC', 'PEEK'] });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(handTypes(g, 'a')).toEqual(['PEEK']);
    expect(handTypes(g, 'b').sort()).toEqual(['MIMIC', 'MIMIC', 'PEEK']);
  });

  it('stops at the hand ceiling, so a hand stays readable on a phone', () => {
    const big: CardType[] = Array.from({ length: 12 }, () => 'PEEK');
    const g = table({ a: ['MIMIC', ...big.slice(0, 10)], b: big });
    playAndResolve(g, 'a', 'MIMIC', { targetPlayerId: 'b' });
    expect(g.player('a').hand.length).toBe(BALANCE.maxHandSize);
    expect(g.player('b').hand.length).toBe(12);
  });
});
