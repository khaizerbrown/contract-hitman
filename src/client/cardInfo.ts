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
  MIRROR: { name: 'Mirror', blurb: 'Repeat the last card played.' },
  REDIRECT: { name: 'Redirect', blurb: 'Reflect an Attack and reverse the order.', quick: true },
};

/**
 * File numbers, the way a case file would index them. Fixed per card so a
 * player learns to recognise a card by its number as well as its name.
 */
export const CARD_NUMBER: Record<CardType, string> = {
  HITMAN: '00',
  ANGEL: '01',
  ATTACK: '02',
  FULL_ATTACK: '03',
  SKIP: '04',
  STEAL: '05',
  PEEK: '06',
  LOCK: '07',
  MIMIC: '08',
  BOTTOM_PULL: '09',
  REAL_SHUFFLE: '10',
  FAKE_SHUFFLE: '10', // identical on purpose - see publicType()
  CANCEL: '11',
  BURN: '12',
  MIRROR: '13',
  REDIRECT: '14',
};

/** Which family a card belongs to, which is what tints its face. */
export const CARD_KIND: Record<CardType, 'danger' | 'saviour' | 'strike' | 'control' | 'quick'> = {
  HITMAN: 'danger',
  ANGEL: 'saviour',
  ATTACK: 'strike',
  FULL_ATTACK: 'strike',
  STEAL: 'strike',
  MIMIC: 'strike',
  SKIP: 'control',
  PEEK: 'control',
  LOCK: 'control',
  BOTTOM_PULL: 'control',
  REAL_SHUFFLE: 'control',
  FAKE_SHUFFLE: 'control',
  MIRROR: 'control',
  CANCEL: 'quick',
  BURN: 'quick',
  REDIRECT: 'quick',
};

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/**
 * A mark for each card, drawn rather than written, so a hand can be read at a
 * glance. Geometric on purpose: these have to survive being 20 pixels wide.
 * Real Shuffle and Fake Shuffle share a mark, as they must.
 */
export const CARD_MARK: Record<CardType, string> = {
  // crosshair
  HITMAN: svg('<circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  // halo over shoulders
  ANGEL: svg('<ellipse cx="12" cy="6" rx="5.5" ry="2.4"/><path d="M4 21c1.6-5 4.4-7.5 8-7.5S18.4 16 20 21"/>'),
  // a single thrust
  ATTACK: svg('<path d="M4 20 20 4"/><path d="M14 4h6v6"/><path d="M4 14v6h6"/>'),
  // thrust in every direction
  FULL_ATTACK: svg('<path d="M12 12 4 4M12 12l8-8M12 12l-8 8M12 12l8 8"/><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  // stepped over
  SKIP: svg('<path d="M4 17c4 0 5-10 9-10s4 10 7 10"/><path d="M17 4l3 3-3 3"/>'),
  // lifted out
  STEAL: svg('<rect x="3" y="9" width="10" height="11" rx="1"/><path d="M13 6h8M21 6l-3-3M21 6l-3 3"/><path d="M8 9V6"/>'),
  // an eye
  PEEK: svg('<path d="M1.5 12S5 5.5 12 5.5 22.5 12 22.5 12 19 18.5 12 18.5 1.5 12 1.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  // padlock
  LOCK: svg('<rect x="4" y="10" width="16" height="11" rx="1.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v3"/>'),
  // one hand becomes the other
  MIMIC: svg('<rect x="3" y="3" width="12" height="12" rx="1"/><path d="M9 21h11a1 1 0 0 0 1-1V9"/><path d="M18 6l3 3-3 3"/>'),
  // reach underneath
  BOTTOM_PULL: svg('<path d="M12 3v12"/><path d="M8 11l4 4 4-4"/><path d="M3 20h18"/>'),
  REAL_SHUFFLE: svg('<path d="M3 7h5l8 10h5"/><path d="M3 17h5l8-10h5"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>'),
  FAKE_SHUFFLE: svg('<path d="M3 7h5l8 10h5"/><path d="M3 17h5l8-10h5"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>'),
  // struck out
  CANCEL: svg('<circle cx="12" cy="12" r="9"/><path d="M6 18 18 6"/>'),
  // flame
  BURN: svg('<path d="M12 21c3.9 0 6.5-2.5 6.5-6 0-4.5-4.5-6-4-11-3 1.5-5.5 4.5-5.5 7.5 0 1.4.5 2.3 1 2.9C9 13.5 8 12 8 10c-1.6 1.6-2.5 3.4-2.5 5C5.5 18.5 8.1 21 12 21Z"/>'),
  // reflected
  MIRROR: svg('<path d="M12 2v20"/><path d="M9 6 4 12l5 6Z"/><path d="M15 6l5 6-5 6Z" stroke-dasharray="2.5 2"/>'),
  // sent back the other way
  REDIRECT: svg('<path d="M20 8H8a4 4 0 0 0 0 8h3"/><path d="M17 4l3 4-3 4"/>'),
};
