import type { CardType } from '../engine/types.js';

export interface CardInfo {
  name: string;
  blurb: string;
  /** Cards the player never plays by hand. */
  passive?: boolean;
  quick?: boolean;
  needsTarget?: boolean;
}

export const CARD_INFO: Record<CardType, CardInfo> = {
  HITMAN: { name: 'Hitman', blurb: 'Draw it and you are gone.', passive: true },
  ANGEL: { name: 'Angel', blurb: 'Play it when a Hitman lands on you.' },
  ATTACK: { name: 'Attack', blurb: 'Target takes 2 turns in a row.', needsTarget: true },
  FULL_ATTACK: { name: 'Full Attack', blurb: 'Everyone else takes 2 turns.' },
  SKIP: { name: 'Skip', blurb: 'End your turn now. No draw.' },
  STEAL: { name: 'Steal', blurb: 'They choose a card to hand you.', needsTarget: true },
  PEEK: { name: 'Peek', blurb: 'See the top 3 cards. Only you.' },
  LOCK: { name: 'Lock', blurb: 'Bans the card just played for 3 turns.' },
  MIMIC: { name: 'Mimic', blurb: 'Swap your hand for a copy of theirs.', needsTarget: true },
  BOTTOM_PULL: { name: 'Bottom Pull', blurb: 'Your draw comes from the bottom.' },
  REAL_SHUFFLE: { name: 'Shuffle', blurb: 'Shuffle the deck.' },
  FAKE_SHUFFLE: { name: 'Shuffle', blurb: 'Looks like a shuffle. Is not.' },
  CANCEL: { name: 'Cancel', blurb: 'Stop that card resolving.', quick: true },
  BURN: { name: 'Burn', blurb: 'Destroy it and every copy in every hand.', quick: true },
  MIRROR: { name: 'Mirror', blurb: 'Fire the last card again.', quick: true },
  REDIRECT: { name: 'Redirect', blurb: 'Reflect an Attack and reverse the order.', quick: true },
};
