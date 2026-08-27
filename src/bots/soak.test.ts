import { describe, it, expect } from 'vitest';
import { Game } from '../engine/game.js';
import { Bot, BOT_NAMES } from './bot.js';

/**
 * Plays whole matches from start to finish with bots in every seat, on a fake
 * clock, hundreds of times. This is what proves the game always reaches an end
 * instead of locking up, at every table size.
 */
function playFullMatch(playerCount: number, seed: number) {
  const bots = Array.from(
    { length: playerCount },
    (_, i) => new Bot(`p${i}`, BOT_NAMES[i % BOT_NAMES.length]),
  );
  const game = Game.create({
    players: bots.map((b) => ({ id: b.id, name: b.name })),
    seed,
  });

  const byId = new Map(bots.map((b) => [b.id, b]));
  let now = 0;
  let steps = 0;

  while (game.state.phase === 'playing' && steps < 40_000) {
    steps += 1;
    now += 120;
    game.setNow(now);

    const pending = game.state.pending;
    if (pending && pending.kind === 'quickWindow') {
      const next = pending.eligible.find((id) => !pending.responded.includes(id));
      if (next) byId.get(next)!.respondToQuickWindow(game);
      else game.checkTimers();
    } else if (pending && pending.kind === 'steal') {
      byId.get(pending.playerId)!.chooseCardToGive(game);
    } else if (pending && pending.kind === 'hitmanPlacement') {
      byId.get(pending.playerId)!.chooseHitmanPlacement(game);
    } else {
      byId.get(game.currentPlayerId())!.takeTurn(game);
    }
  }

  return { game, steps };
}

describe('Whole matches played by bots', () => {
  it('always reaches a single winner at every table size from 2 to 12', () => {
    for (let players = 2; players <= 12; players++) {
      for (let round = 0; round < 12; round++) {
        const { game, steps } = playFullMatch(players, players * 1000 + round);
        expect(game.state.phase).toBe('ended');
        expect(steps).toBeLessThan(40_000);
        expect(game.alivePlayers().length).toBe(1);
        expect(game.state.winner).toBe(game.alivePlayers()[0].id);
      }
    }
  });

  it('never leaves a Hitman card unaccounted for', () => {
    for (let round = 0; round < 20; round++) {
      const { game } = playFullMatch(5, 90_000 + round);
      const inDeck = game.state.deck.filter((c) => c.type === 'HITMAN').length;
      const inDiscard = game.state.discard.filter((c) => c.type === 'HITMAN').length;
      const inHands = game.state.players
        .flatMap((p) => p.hand)
        .filter((c) => c.type === 'HITMAN').length;
      expect(inDeck + inDiscard + inHands).toBe(4);
      expect(inHands).toBe(0);
    }
  });

  it('never runs the deck dry while two or more players are still alive', () => {
    for (let round = 0; round < 20; round++) {
      const { game } = playFullMatch(6, 70_000 + round);
      expect(game.state.winner).not.toBeNull();
    }
  });
});
