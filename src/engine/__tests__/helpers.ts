import { Game } from '../game.js';
import type { CardType, PlayArgs } from '../types.js';

/** Find one card of a given type in a player's hand. */
export function cardOf(g: Game, playerId: string, type: CardType) {
  const c = g.player(playerId).hand.find((x) => x.type === type);
  if (!c) throw new Error(`${playerId} is not holding a ${type}`);
  return c;
}

export function handTypes(g: Game, playerId: string): CardType[] {
  return g.player(playerId).hand.map((c) => c.type);
}

/** Everyone entitled to respond declines, closing the reflex window. */
export function passAll(g: Game): void {
  for (let guard = 0; guard < 20; guard++) {
    const p = g.state.pending;
    if (!p || p.kind !== 'quickWindow') return;
    const next = p.eligible.find((id) => !p.responded.includes(id));
    if (!next) return;
    g.pass(next);
  }
}

/** Play a card by type and let the reflex window close with no responses. */
export function playAndResolve(
  g: Game,
  playerId: string,
  type: CardType,
  args: PlayArgs = {},
): void {
  g.play(playerId, cardOf(g, playerId, type).id, args);
  passAll(g);
}

/** A deck of harmless cards, long enough that nothing runs out mid-test. */
export function filler(n: number, type: CardType = 'PEEK'): CardType[] {
  return Array.from({ length: n }, () => type);
}
