import { describe, it, expect } from 'vitest';
import { BALANCE } from '../../config/balance.js';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, playAndResolve } from './helpers.js';

function table(hands: Record<string, CardType[]>, deck: CardType[] = filler(30)) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('Lock', () => {
  it('bans the chosen card type for everyone', () => {
    const g = table({ a: ['LOCK'], b: ['SKIP'] });
    playAndResolve(g, 'a', 'LOCK', { lockType: 'SKIP' });
    g.draw('a');
    expect(g.isLocked('SKIP')).toBe(true);
    expect(() => g.play('b', cardOf(g, 'b', 'SKIP').id)).toThrow();
  });

  it('lifts after exactly 3 player-turns', () => {
    const g = table({ a: ['LOCK', 'SKIP'], b: ['SKIP', 'SKIP'] });
    playAndResolve(g, 'a', 'LOCK', { lockType: 'SKIP' });
    g.draw('a');

    // Turn 1 of the ban - B
    expect(g.isLocked('SKIP')).toBe(true);
    g.draw('b');
    // Turn 2 of the ban - A
    expect(g.isLocked('SKIP')).toBe(true);
    g.draw('a');
    // Turn 3 of the ban - B
    expect(g.isLocked('SKIP')).toBe(true);
    g.draw('b');
    // Ban is over
    expect(g.isLocked('SKIP')).toBe(false);
  });

  it('counts down visibly so players know when it lifts', () => {
    const g = table({ a: ['LOCK'], b: [] });
    playAndResolve(g, 'a', 'LOCK', { lockType: 'SKIP' });
    g.draw('a');
    expect(g.viewFor('b').locks).toEqual([{ type: 'SKIP', turnsRemaining: 3 }]);
    g.draw('b');
    expect(g.viewFor('a').locks).toEqual([{ type: 'SKIP', turnsRemaining: 2 }]);
  });

  it('cannot lock a card that is never playable anyway', () => {
    const g = table({ a: ['LOCK'], b: [] });
    expect(() => g.play('a', cardOf(g, 'a', 'LOCK').id, { lockType: 'HITMAN' })).toThrow();
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
