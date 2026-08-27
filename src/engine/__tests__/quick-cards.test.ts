import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, passAll, playAndResolve } from './helpers.js';
import { BALANCE } from '../../config/balance.js';

const WINDOW_MS = BALANCE.quickWindowSeconds * 1000;

function table(hands: Record<string, CardType[]>, deck: CardType[] = filler(20)) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('The reflex window', () => {
  it('opens for every other living player when a card is played', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: ['CANCEL'] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    expect(g.state.pending?.kind).toBe('quickWindow');
    const pending = g.state.pending as { eligible: string[] };
    expect(pending.eligible.sort()).toEqual(['b', 'c']);
  });

  it('does not open for players holding no quick card', () => {
    const g = table({ a: ['ATTACK'], b: [], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    expect(g.state.pending).toBeNull();
  });

  it('closes on its own when the window runs out', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.advance(WINDOW_MS);
    g.checkTimers();
    expect(g.state.pending).toBeNull();
    expect(g.state.attackEffects.length).toBe(1);
  });

  it('freezes the turn clock while players are deciding', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    const before = g.state.turnDeadline;
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.advance(WINDOW_MS);
    g.checkTimers();
    expect(g.state.turnDeadline).toBe(before + WINDOW_MS);
  });

  it('stops a quick card being played out of turn order', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    expect(() => g.play('b', cardOf(g, 'b', 'CANCEL').id)).toThrow();
  });
});

describe('Cancel', () => {
  it('stops the played card doing anything at all', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'CANCEL').id);
    passAll(g);
    expect(g.state.attackEffects.length).toBe(0);
    g.draw('a');
    expect(g.state.currentTurnsRemaining).toBe(1);
  });
});

describe('Burn', () => {
  it('destroys the card played and every copy of it in every hand', () => {
    const g = table({
      a: ['ATTACK'],
      b: ['ATTACK', 'PEEK'],
      c: ['BURN', 'ATTACK'],
    });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('c', cardOf(g, 'c', 'BURN').id);
    passAll(g);

    expect(handTypes(g, 'b')).toEqual(['PEEK']);
    expect(handTypes(g, 'c')).toEqual([]);
    expect(g.state.attackEffects.length).toBe(0);
  });
});

describe('Mirror', () => {
  it('is played on your own turn, not in the reflex window', () => {
    const g = table({ a: ['ATTACK'], b: ['MIRROR'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    // Holding a Mirror no longer buys you into the window at all.
    expect(g.state.pending).toBeNull();
    expect(handTypes(g, 'b')).toEqual(['MIRROR']);
  });

  it('repeats the last card played, on your turn', () => {
    const g = table({ a: ['ATTACK'], b: ['MIRROR'], c: [] });
    playAndResolve(g, 'a', 'ATTACK', { targetPlayerId: 'c' });
    g.draw('a');
    // B is up. The last card played was an Attack on C, so the Mirror repeats it.
    playAndResolve(g, 'b', 'MIRROR');
    g.draw('b');
    expect(g.currentPlayerId()).toBe('c');
    expect(g.state.currentTurnsRemaining).toBe(3);
  });

  it('lets the original card resolve first, on the turn it was played', () => {
    // This is the ordering Mr K wanted: your Steal happens on your turn, and
    // anybody copying it has to wait for theirs.
    const g = table({ a: ['STEAL'], b: ['MIRROR'], c: ['PEEK', 'SKIP'] });
    playAndResolve(g, 'a', 'STEAL', { targetPlayerId: 'c' });
    g.choose('c', cardOf(g, 'c', 'PEEK').id);
    expect(handTypes(g, 'a')).toEqual(['PEEK']); // A got their card, first
    g.draw('a');

    playAndResolve(g, 'b', 'MIRROR');
    g.choose('c', cardOf(g, 'c', 'SKIP').id);
    expect(handTypes(g, 'b')).toEqual(['SKIP']); // B copies it afterwards
  });

  it('cannot be played when nothing has been played yet', () => {
    const g = table({ a: ['MIRROR'], b: [], c: [] });
    expect(() => g.play('a', cardOf(g, 'a', 'MIRROR').id)).toThrow(/nothing has been played/i);
  });

  it('cannot repeat another Mirror', () => {
    const g = table({ a: ['PEEK', 'MIRROR'], b: ['MIRROR'], c: [] });
    playAndResolve(g, 'a', 'PEEK');
    playAndResolve(g, 'a', 'MIRROR');
    g.draw('a');
    expect(() => g.play('b', cardOf(g, 'b', 'MIRROR').id)).toThrow(/cannot repeat another mirror/i);
  });

  it('cannot repeat a quick card', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL', 'MIRROR'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'CANCEL').id);
    passAll(g);
    g.draw('a');
    expect(() => g.play('b', cardOf(g, 'b', 'MIRROR').id)).toThrow(/not worth repeating/i);
  });

  it('can itself be cancelled, because playing it opens a window', () => {
    const g = table({ a: ['ATTACK'], b: ['MIRROR'], c: ['CANCEL'] });
    playAndResolve(g, 'a', 'ATTACK', { targetPlayerId: 'c' });
    g.draw('a');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    g.play('c', cardOf(g, 'c', 'CANCEL').id);
    passAll(g);
    g.draw('b');
    // Only A's original Attack ever landed on C.
    expect(g.state.currentTurnsRemaining).toBe(2);
  });
});

describe('Redirect', () => {
  it('throws the Attack back at the attacker', () => {
    const g = table({ a: ['ATTACK'], b: ['REDIRECT'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'REDIRECT').id);
    passAll(g);
    expect(g.currentPlayerId()).toBe('a');
    expect(g.state.currentTurnsRemaining).toBe(2);
  });

  it('reverses the direction of play', () => {
    const g = table({ a: ['ATTACK'], b: ['REDIRECT'], c: [] });
    expect(g.state.direction).toBe(1);
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'REDIRECT').id);
    passAll(g);
    expect(g.state.direction).toBe(-1);
    g.draw('a');
    g.draw('a');
    expect(g.currentPlayerId()).toBe('c');
  });

  it('flips direction back again when a second Redirect lands', () => {
    const g = table({ a: ['ATTACK', 'ATTACK'], b: ['REDIRECT'], c: ['REDIRECT'] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'REDIRECT').id);
    passAll(g);
    expect(g.state.direction).toBe(-1);

    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'c' });
    g.play('c', cardOf(g, 'c', 'REDIRECT').id);
    passAll(g);
    expect(g.state.direction).toBe(1);
  });

  it('cannot be played against anything except an Attack', () => {
    const g = table({ a: ['PEEK'], b: ['REDIRECT'], c: [] });
    g.play('a', cardOf(g, 'a', 'PEEK').id);
    // No window even opens, because B holds nothing legal to respond with.
    expect(g.state.pending).toBeNull();
  });
});

describe('Response chains', () => {
  it('stops after 3 responses so a chain can never run forever', () => {
    const g = table({
      a: ['ATTACK'],
      b: ['CANCEL'],
      c: ['CANCEL'],
      d: ['CANCEL'],
      e: ['CANCEL'],
    });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'CANCEL').id);
    g.play('c', cardOf(g, 'c', 'CANCEL').id);
    g.play('d', cardOf(g, 'd', 'CANCEL').id);

    expect(g.state.pending).toBeNull();
    expect(g.state.stack.length).toBe(0);
    expect(handTypes(g, 'e')).toEqual(['CANCEL']);
  });

  it('resolves the last card played first', () => {
    // Attack, then Cancel, then Cancel: the second Cancel kills the first,
    // so the Attack goes through.
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: ['CANCEL'] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('b', cardOf(g, 'b', 'CANCEL').id);
    g.play('c', cardOf(g, 'c', 'CANCEL').id);
    passAll(g);
    expect(g.state.attackEffects.length).toBe(1);
  });
});
