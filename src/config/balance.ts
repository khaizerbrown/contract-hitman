/**
 * EVERY TUNABLE NUMBER IN THE GAME LIVES IN THIS FILE.
 *
 * These are first guesses. They will change after real people play.
 * Nothing else in the codebase should hard-code a game number.
 */

import type { CardType } from '../engine/types.js';

/** How many of a card type exist, given the player count. */
export interface CardSpec {
  /** Count at the minimum player count (2 players). */
  base: number;
  /** Extra copies added for each player above 2. Fractions are rounded down. */
  perExtraPlayer: number;
}

export interface Balance {
  minPlayers: number;
  maxPlayers: number;

  /** Cards dealt from the deck at setup. Every player ALSO gets 1 free Angel. */
  startingHandSize: number;

  /** One clock for the whole turn: all plays plus the draw. Does not reset. */
  turnSeconds: number;
  /** Reflex window for quick cards after any card is played. */
  quickWindowSeconds: number;
  /** Timer on any "you must choose" prompt (Steal, Hitman placement). */
  choiceSeconds: number;
  /** How long a dropped player has to come back before they forfeit. */
  disconnectGraceSeconds: number;

  /** Max quick cards that can be stacked in response to one another. */
  quickChainMaxDepth: number;
  /** Ceiling on extra turns one player can be forced to take. */
  maxExtraTurnsPerPlayer: number;
  /** How many player-turns a Lock bans a card type for. */
  lockTurns: number;

  /**
   * Ceiling on hand size, purely for playability - a hand past this is
   * unreadable on a phone. Mimic copies only as many cards as will fit.
   * Runaway growth is prevented at the source instead: Mimic never copies
   * another Mimic.
   */
  maxHandSize: number;

  /**
   * Hitman cards are never seeded in the top slice of the deck, so the game
   * opens safe and gets lethal as the deck thins. 0.4 = top 40% is clean.
   */
  hitmanSafeTopFraction: number;

  /** Non-Hitman deck composition. Hitman count is always players - 1. */
  deck: Record<Exclude<CardType, 'HITMAN'>, CardSpec>;
}

export const BALANCE: Balance = {
  minPlayers: 2,
  maxPlayers: 12,

  startingHandSize: 4,

  turnSeconds: 15,
  quickWindowSeconds: 3.5,
  choiceSeconds: 7,
  disconnectGraceSeconds: 45,

  quickChainMaxDepth: 3,
  maxExtraTurnsPerPlayer: 3,
  lockTurns: 3,
  maxHandSize: 20,

  hitmanSafeTopFraction: 0.4,

  deck: {
    ANGEL: { base: 1, perExtraPlayer: 0.5 },
    ATTACK: { base: 3, perExtraPlayer: 1 },
    FULL_ATTACK: { base: 1, perExtraPlayer: 0.5 },
    SKIP: { base: 3, perExtraPlayer: 1 },
    STEAL: { base: 2, perExtraPlayer: 1 },
    PEEK: { base: 2, perExtraPlayer: 1 },
    LOCK: { base: 2, perExtraPlayer: 0.5 },
    // Exactly one Mimic exists, however many are at the table.
    MIMIC: { base: 1, perExtraPlayer: 0 },
    BOTTOM_PULL: { base: 2, perExtraPlayer: 0.5 },
    REAL_SHUFFLE: { base: 2, perExtraPlayer: 0.5 },
    FAKE_SHUFFLE: { base: 2, perExtraPlayer: 0.5 },
    CANCEL: { base: 2, perExtraPlayer: 1 },
    BURN: { base: 1, perExtraPlayer: 0.5 },
    MIRROR: { base: 2, perExtraPlayer: 0.5 },
    REDIRECT: { base: 2, perExtraPlayer: 0.5 },
  },
};
