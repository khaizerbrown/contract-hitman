import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import type { CardType } from '../types.js';
import { cardOf, filler, handTypes, passAll } from './helpers.js';

function table(hands: Record<string, CardType[]>, deck: CardType[] = filler(20)) {
  return Game.forTest({
    players: Object.entries(hands).map(([id, hand]) => ({ id, name: id.toUpperCase(), hand })),
    deck,
  });
}

describe('The 2-second reflex window', () => {
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

  it('closes on its own when the 2 seconds run out', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.advance(2000);
    g.checkTimers();
    expect(g.state.pending).toBeNull();
    expect(g.state.attackEffects.length).toBe(1);
  });

  it('freezes the turn clock while players are deciding', () => {
    const g = table({ a: ['ATTACK'], b: ['CANCEL'], c: [] });
    const before = g.state.turnDeadline;
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.advance(2000);
    g.checkTimers();
    expect(g.state.turnDeadline).toBe(before + 2000);
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
  it('fires the last card played a second time', () => {
    const g = table({ a: ['ATTACK'], b: [], c: ['MIRROR'] });
    g.play('a', cardOf(g, 'a', 'ATTACK').id, { targetPlayerId: 'b' });
    g.play('c', cardOf(g, 'c', 'MIRROR').id);
    passAll(g);
    g.draw('a');
    expect(g.currentPlayerId()).toBe('b');
    expect(g.state.currentTurnsRemaining).toBe(3);
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
