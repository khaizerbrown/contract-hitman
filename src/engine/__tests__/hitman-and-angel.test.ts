import { describe, it, expect } from 'vitest';
import { Game } from '../game.js';
import {
  cardOf,
  filler,
  handTypes,
  passAll,
  playAndResolve,
  playAngel,
  surviveHitman,
} from './helpers.js';

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

  it('offers the Angel rather than spending it, so the table can react', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    expect(g.state.pending?.kind).toBe('angel');
    expect(handTypes(g, 'a')).toContain('ANGEL');
  });

  it('saves a player who puts their Angel down, and uses the Angel up', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    g.draw('a');
    playAngel(g, 'a');
    expect(g.player('a').alive).toBe(true);
    expect(handTypes(g, 'a')).not.toContain('ANGEL');
  });

  it('lets the saved player put the Hitman back on top of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    surviveHitman(g, 'a', 'top');
    expect(g.state.deck[0].type).toBe('HITMAN');
  });

  it('lets the saved player bury the Hitman at the bottom of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    surviveHitman(g, 'a', 'bottom');
    expect(g.state.deck[g.state.deck.length - 1].type).toBe('HITMAN');
  });

  it('lets the saved player slide the Hitman into the middle of the deck', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(6)]);
    surviveHitman(g, 'a', 'middle');
    const middle = Math.floor((g.state.deck.length - 1) / 2);
    expect(g.state.deck[middle].type).toBe('HITMAN');
  });

  it('passes play to the next person once the Hitman is put back', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', ...filler(5)]);
    surviveHitman(g, 'a', 'top');
    expect(g.currentPlayerId()).toBe('b');
  });

  it('kills a player on their second Hitman, because the Angel is gone', () => {
    const g = twoPlayers(['ANGEL'], ['PEEK'], ['HITMAN', 'PEEK', 'HITMAN', ...filler(4)]);
    surviveHitman(g, 'a', 'bottom'); // first Hitman - the Angel answers it
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
    g.checkTimers(); // the Angel goes down on its own rather than costing a life
    g.advance(6000);
    g.checkTimers(); // and the Hitman goes back in the middle
    expect(g.state.pending).toBeNull();
    expect(g.state.deck.filter((c) => c.type === 'HITMAN').length).toBe(1);
  });

  it('shows everyone how many Hitman cards are still in the deck', () => {
    const g = twoPlayers(['PEEK'], ['PEEK'], ['PEEK', 'HITMAN', 'HITMAN', ...filler(4)]);
    expect(g.viewFor('b').hitmenRemaining).toBe(2);
  });
});

describe('An Angel on the table', () => {
  function hitmanOn(aHand: string[], bHand: string[], cHand: string[] = []) {
    return Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: aHand as never },
        { id: 'b', name: 'B', hand: bHand as never },
        { id: 'c', name: 'C', hand: cHand as never },
      ],
      deck: ['HITMAN', ...filler(10)],
    });
  }

  it('cannot be cancelled, however much someone wants to', () => {
    const g = hitmanOn(['ANGEL'], ['CANCEL']);
    g.draw('a');
    g.play('a', cardOf(g, 'a', 'ANGEL').id);
    const cancel = cardOf(g, 'b', 'CANCEL');
    expect(() => g.play('b', cancel.id)).toThrow();
    passAll(g);
    expect(g.player('a').alive).toBe(true);
  });

  it('does not even offer Cancel to a player holding one', () => {
    const g = hitmanOn(['ANGEL'], ['CANCEL']);
    g.draw('a');
    g.play('a', cardOf(g, 'a', 'ANGEL').id);
    // Nobody holds anything that can answer an Angel, so no window opens at all.
    expect(g.state.pending?.kind).not.toBe('quickWindow');
  });

  it('cannot be mirrored, because repeating a save means nothing', () => {
    const g = hitmanOn(['ANGEL'], ['MIRROR']);
    g.draw('a');
    g.play('a', cardOf(g, 'a', 'ANGEL').id);
    const mirror = cardOf(g, 'b', 'MIRROR');
    expect(() => g.play('b', mirror.id)).toThrow();
    passAll(g);
    expect(handTypes(g, 'b')).toEqual(['MIRROR']);
  });

  it('can be burned, and that kills the player it was saving', () => {
    const g = hitmanOn(['ANGEL'], ['BURN']);
    g.draw('a');
    g.play('a', cardOf(g, 'a', 'ANGEL').id);
    g.play('b', cardOf(g, 'b', 'BURN').id);
    passAll(g);
    expect(g.player('a').alive).toBe(false);
  });

  it('burning one takes every other Angel at the table with it', () => {
    const g = hitmanOn(['ANGEL', 'ANGEL'], ['BURN'], ['ANGEL', 'ANGEL', 'PEEK']);
    g.draw('a');
    g.play('a', cardOf(g, 'a', 'ANGEL').id);
    g.play('b', cardOf(g, 'b', 'BURN').id);
    passAll(g);
    expect(g.player('a').alive).toBe(false);
    expect(handTypes(g, 'c')).toEqual(['PEEK']);
  });
});

describe('Mirroring an Angel to save yourself', () => {
  /**
   * A is hit and answers with an Angel. That ends A's turn. B is hit on their
   * very next draw, and an Angel is still the last card played - so a Mirror
   * copies it.
   */
  function backToBack(bHand: string[]) {
    return Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: bHand as never },
        { id: 'c', name: 'C', hand: ['PEEK'] },
      ],
      deck: ['HITMAN', 'HITMAN', ...filler(10)],
    });
  }

  it('saves you when a Hitman finds you straight after somebody was saved', () => {
    const g = backToBack(['MIRROR']);
    surviveHitman(g, 'a', 'top'); // A survives, Hitman back on top for B
    g.draw('b');
    expect(g.state.pending?.kind).toBe('angel');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    passAll(g);
    g.choose('b', 'bottom');
    expect(g.player('b').alive).toBe(true);
    expect(handTypes(g, 'b')).toEqual([]);
  });

  it('lets you keep your own Angel by spending the Mirror instead', () => {
    const g = backToBack(['MIRROR', 'ANGEL']);
    surviveHitman(g, 'a', 'top');
    g.draw('b');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    passAll(g);
    g.choose('b', 'bottom');
    expect(g.player('b').alive).toBe(true);
    expect(handTypes(g, 'b')).toEqual(['ANGEL']);
  });

  it('does not work if anything else has been played since', () => {
    const g = backToBack(['MIRROR', 'PEEK']);
    surviveHitman(g, 'a', 'top');
    playAndResolve(g, 'b', 'PEEK'); // B spoils it themselves
    g.draw('b');
    expect(g.player('b').alive).toBe(false);
  });

  it('does not work when no Angel has been played at all', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['MIRROR'] },
        { id: 'b', name: 'B', hand: ['PEEK'] },
        { id: 'c', name: 'C', hand: ['PEEK'] },
      ],
      deck: ['HITMAN', ...filler(10)],
    });
    g.draw('a');
    expect(g.state.pending).toBeNull();
    expect(g.player('a').alive).toBe(false);
  });

  it('only stretches one player - the next one cannot mirror it again', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['MIRROR'] },
        { id: 'c', name: 'C', hand: ['MIRROR'] },
      ],
      deck: ['HITMAN', 'HITMAN', 'HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'top');
    g.draw('b');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    passAll(g);
    g.choose('b', 'top');
    // A Mirror was the last card played now, not an Angel, so C is out of luck.
    g.draw('c');
    expect(g.player('c').alive).toBe(false);
    expect(g.state.pending).toBeNull();
  });

  it('can itself be burned, which kills the player it was covering', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['MIRROR'] },
        { id: 'c', name: 'C', hand: ['BURN'] },
      ],
      deck: ['HITMAN', 'HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'top');
    g.draw('b');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    g.play('c', cardOf(g, 'c', 'BURN').id);
    passAll(g);
    expect(g.player('b').alive).toBe(false);
  });

  it('cannot be cancelled either', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['MIRROR'] },
        { id: 'c', name: 'C', hand: ['CANCEL'] },
      ],
      deck: ['HITMAN', 'HITMAN', ...filler(10)],
    });
    surviveHitman(g, 'a', 'top');
    g.draw('b');
    g.play('b', cardOf(g, 'b', 'MIRROR').id);
    expect(() => g.play('c', cardOf(g, 'c', 'CANCEL').id)).toThrow();
    passAll(g);
    g.choose('b', 'bottom');
    expect(g.player('b').alive).toBe(true);
  });
});

describe('Angels cannot be destroyed by anything', () => {
  it('cannot be burned, because Burn only hits a card that was played', () => {
    // C burns A's Peek. Everyone's Angels should be untouched.
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['PEEK', 'ANGEL'] },
        { id: 'b', name: 'B', hand: ['ANGEL', 'ANGEL'] },
        { id: 'c', name: 'C', hand: ['BURN'] },
      ],
      deck: filler(10),
    });
    g.play('a', cardOf(g, 'a', 'PEEK').id);
    g.play('c', cardOf(g, 'c', 'BURN').id);
    passAll(g);
    expect(handTypes(g, 'a')).toEqual(['ANGEL']);
    expect(handTypes(g, 'b')).toEqual(['ANGEL', 'ANGEL']);
  });

  it('cannot be played from a hand, so it can never be burned at all', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['ANGEL'] },
        { id: 'b', name: 'B', hand: ['BURN'] },
      ],
      deck: filler(10),
    });
    expect(() => g.play('a', cardOf(g, 'a', 'ANGEL').id)).toThrow();
    expect(handTypes(g, 'a')).toEqual(['ANGEL']);
  });

  it('can be taken by Steal, which is the one way to lose one', () => {
    const g = Game.forTest({
      players: [
        { id: 'a', name: 'A', hand: ['STEAL'] },
        { id: 'b', name: 'B', hand: ['ANGEL'] },
      ],
      deck: filler(10),
    });
    g.play('a', cardOf(g, 'a', 'STEAL').id, { targetPlayerId: 'b' });
    passAll(g);
    g.choose('b', cardOf(g, 'b', 'ANGEL').id);
    expect(handTypes(g, 'a')).toEqual(['ANGEL']);
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
