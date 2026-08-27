import { BALANCE, type Balance } from '../config/balance.js';
import type { Card, CardType } from './types.js';
import { randomInt, shuffleInPlace, type RngHolder } from './rng.js';

let nextCardSerial = 0;
export function makeCard(type: CardType): Card {
  nextCardSerial += 1;
  return { id: `c${nextCardSerial}_${type}`, type };
}

/** Hitman count is fixed by the rules: one fewer than the number of players. */
export function hitmanCount(playerCount: number): number {
  return playerCount - 1;
}

/**
 * How many copies of one card type exist at this player count.
 * count = base + floor(perExtraPlayer * (players - 2))
 */
export function cardCount(
  type: Exclude<CardType, 'HITMAN'>,
  playerCount: number,
  balance: Balance = BALANCE,
): number {
  const spec = balance.deck[type];
  const extra = Math.max(0, playerCount - balance.minPlayers);
  return spec.base + Math.floor(spec.perExtraPlayer * extra);
}

/** The full non-Hitman deck for this player count, unshuffled. */
export function buildBaseDeck(playerCount: number, balance: Balance = BALANCE): Card[] {
  const cards: Card[] = [];
  for (const type of Object.keys(balance.deck) as Exclude<CardType, 'HITMAN'>[]) {
    const n = cardCount(type, playerCount, balance);
    for (let i = 0; i < n; i++) cards.push(makeCard(type));
  }
  return cards;
}

/**
 * Drop the Hitman cards into the deck, never in the top slice.
 * The game opens safe and turns lethal as the deck thins.
 */
export function seedHitmen(
  rng: RngHolder,
  deck: Card[],
  count: number,
  balance: Balance = BALANCE,
): Card[] {
  const out = deck.slice();
  for (let i = 0; i < count; i++) {
    const floorIndex = Math.floor(out.length * balance.hitmanSafeTopFraction);
    const span = out.length - floorIndex + 1;
    const at = floorIndex + randomInt(rng, Math.max(1, span));
    out.splice(at, 0, makeCard('HITMAN'));
  }
  return out;
}

export function shuffledBaseDeck(
  rng: RngHolder,
  playerCount: number,
  balance: Balance = BALANCE,
): Card[] {
  return shuffleInPlace(rng, buildBaseDeck(playerCount, balance));
}
