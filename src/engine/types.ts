export type CardType =
  // Never played from hand
  | 'HITMAN'
  | 'ANGEL'
  // Played on your turn
  | 'ATTACK'
  | 'FULL_ATTACK'
  | 'SKIP'
  | 'STEAL'
  | 'PEEK'
  | 'LOCK'
  | 'MIMIC'
  | 'BOTTOM_PULL'
  | 'REAL_SHUFFLE'
  | 'FAKE_SHUFFLE'
  // Played only inside the reflex window
  | 'CANCEL'
  | 'BURN'
  | 'MIRROR'
  | 'REDIRECT';

/**
 * Cards played inside the reflex window. Mirror is not one of them -
 * it is played on your own turn and repeats whatever was played last.
 */
export const QUICK_CARDS = ['CANCEL', 'BURN', 'REDIRECT'] as const;
/**
 * Hitman is the only card that can never leave a hand by being played. Angel is
 * played, but only at one moment: when a Hitman has just been drawn on you.
 */
export const NEVER_PLAYABLE = ['HITMAN'] as const;

export function isQuick(t: CardType): boolean {
  return (QUICK_CARDS as readonly string[]).includes(t);
}

export function isNeverPlayable(t: CardType): boolean {
  return (NEVER_PLAYABLE as readonly string[]).includes(t);
}

/**
 * What other players are allowed to see when this card is played.
 * A Fake Shuffle is deliberately indistinguishable from a Real Shuffle.
 */
export function publicType(t: CardType): CardType {
  return t === 'FAKE_SHUFFLE' ? 'REAL_SHUFFLE' : t;
}

export interface Card {
  id: string;
  type: CardType;
}

export interface Player {
  id: string;
  name: string;
  hand: Card[];
  alive: boolean;
  connected: boolean;
}

export interface PlayArgs {
  targetPlayerId?: string;
  /** Only for LOCK: which card type to ban. */
  lockType?: CardType;
}

export interface StackEntry {
  card: Card;
  playerId: string;
  args: PlayArgs;
  cancelled: boolean;
  /**
   * A Mirror played in answer to a Hitman, copying the Angel somebody put down
   * just before. It behaves as an Angel for the rest of its life on the table.
   */
  asAngel?: boolean;
  /** What a Mirror is repeating, fixed at the moment it was played. */
  mirrorOf?: { type: CardType; args: PlayArgs };
}

export interface AttackEffect {
  id: string;
  sourcePlayerId: string;
  /** Extra turns still owed, by player id. */
  owed: Record<string, number>;
}

export interface Lock {
  type: CardType;
  turnsRemaining: number;
}

export type Pending =
  | {
      kind: 'quickWindow';
      eligible: string[];
      responded: string[];
      deadline: number;
    }
  | {
      kind: 'steal';
      /** The player who must choose a card to hand over. */
      playerId: string;
      /** The player who played Steal. */
      thiefId: string;
      deadline: number;
    }
  | {
      /** A Hitman has been drawn on them and they hold an Angel to answer it. */
      kind: 'angel';
      playerId: string;
      deadline: number;
    }
  | {
      kind: 'hitmanPlacement';
      /** The player the Angel just saved. */
      playerId: string;
      deadline: number;
    };

export type LogEntry =
  | { t: 'turn_start'; playerId: string }
  | { t: 'card_played'; playerId: string; cardType: CardType }
  | { t: 'card_cancelled'; cardType: CardType; byPlayerId: string }
  | { t: 'burned'; cardType: CardType; byPlayerId: string; copiesDestroyed: number }
  | { t: 'mirrored'; cardType: CardType; byPlayerId: string }
  | { t: 'redirected'; fromPlayerId: string; toPlayerId: string }
  | { t: 'direction_reversed' }
  | { t: 'shuffled'; playerId: string }
  | { t: 'attack'; byPlayerId: string; targets: string[] }
  | { t: 'attack_cancelled'; reason: 'hitman_drawn' }
  | { t: 'locked'; playerId: string; cardType: CardType; turns: number }
  | { t: 'lock_expired'; cardType: CardType }
  | { t: 'stolen'; thiefId: string; fromPlayerId: string }
  | {
      t: 'mimicked';
      playerId: string;
      targetPlayerId: string;
      cards: number;
      /** How many of their own cards they threw away to do it. */
      lost: number;
    }
  | { t: 'drew'; playerId: string; fromBottom: boolean }
  | { t: 'hitman_drawn'; playerId: string }
  | { t: 'angel_played'; playerId: string; mirrored: boolean }
  | { t: 'angel_burned'; playerId: string }
  | { t: 'angel_saved'; playerId: string; placement: 'top' | 'middle' | 'bottom' }
  | { t: 'eliminated'; playerId: string }
  | { t: 'skipped'; playerId: string }
  | { t: 'timed_out'; playerId: string }
  | { t: 'game_over'; winnerId: string | null };

/** Something only one player is allowed to see (currently: Peek results). */
export interface PrivateInfo {
  kind: 'peek';
  cards: Card[];
  /**
   * How big the deck was when they looked. The moment it changes, somebody has
   * drawn and what they saw is out of date.
   */
  deckCount: number;
}
