import type { CardType } from '../engine/types.js';
import { cardCount, hitmanCount } from '../engine/deck.js';
import { CARD_INFO, CARD_KIND, CARD_MARK, CARD_NUMBER } from './cardInfo.js';
import { BALANCE } from '../config/balance.js';

/**
 * The card file: what every card actually does, in full, for people who have
 * not played before. The cards themselves carry no wording, so this is the
 * only place the rules are written down.
 */
interface Entry {
  type: CardType;
  /** Overrides the short name where the file needs to be clearer. */
  title?: string;
  what: string;
  /** The awkward corners, the ones people get wrong. */
  notes?: string[];
}

const CONTRACT: Entry[] = [
  {
    type: 'HITMAN',
    what: 'Draw one and you are out of the match, unless you can put an Angel down to answer it.',
    notes: [
      'Never played from a hand. It only ever arrives by being drawn.',
      'A Hitman that kills somebody leaves the game. One that is answered goes back into the deck.',
      'Whoever survives one chooses where it goes back, and nobody else is told where.',
    ],
  },
  {
    type: 'ANGEL',
    what: 'Play it the moment a Hitman lands on you. It takes the bullet and you live.',
    notes: [
      'Everyone starts with one.',
      'Nobody can Cancel an Angel.',
      'Burn can destroy it - and that takes every other Angel at the table with it.',
      'Lock can ban Angels. While they are banned, a drawn Hitman simply kills.',
      'They stack. Hold three, survive three.',
    ],
  },
];

const ON_YOUR_TURN: Entry[] = [
  {
    type: 'ATTACK',
    what: 'The player you choose takes two turns in a row instead of one.',
    notes: ['Redirect throws it back at you and reverses the order of play.'],
  },
  {
    type: 'FULL_ATTACK',
    what: 'Everybody except you takes two turns in a row.',
  },
  {
    type: 'SKIP',
    what: 'Ends your turn on the spot. You do not draw, so you cannot be killed.',
  },
  {
    type: 'STEAL',
    what: 'Take a card from someone. They choose which one you get, not you.',
    notes: ['Leave it too long and the game picks for them.'],
  },
  {
    type: 'PEEK',
    what: 'Look at the top three cards of the deck. Only you see them.',
    notes: ['What you saw disappears the moment anyone draws, because it is no longer true.'],
  },
  {
    type: 'LOCK',
    what: 'Bans the card type that was played immediately before it, for three turns. You do not choose.',
    notes: [
      'It can ban Angels, which is brutal - a drawn Hitman then kills outright.',
      'It can never ban a Hitman, because a Hitman is never played.',
      'It cannot be played when nothing has been played yet.',
    ],
  },
  {
    type: 'MIMIC',
    what: 'Throw your whole hand away and take a copy of somebody else’s. They keep theirs.',
    notes: [
      'There is exactly one Mimic in the deck, whatever the table size.',
      'Their Angels come across. Yours goes in the bin with the rest of your hand.',
      'Copying an empty hand leaves you with nothing at all.',
    ],
  },
  {
    type: 'MIRROR',
    what: 'Repeats the last card anyone played, as if you had played it yourself.',
    notes: [
      'A turn card, not a reflex card. The original resolves on its turn, your copy on yours.',
      'If a Hitman lands on you while an Angel is still the last card played, a Mirror copies the Angel and saves you.',
      'It will not repeat another Mirror, an Angel, or a reflex card.',
    ],
  },
  {
    type: 'BOTTOM_PULL',
    what: 'Your draw this turn comes off the bottom of the deck instead of the top.',
    notes: ['The bottom is where the Hitmen were buried at the start.'],
  },
  {
    type: 'REAL_SHUFFLE',
    title: 'Shuffle (real)',
    what: 'Genuinely shuffles the deck. Everything anybody knew about the order is gone.',
  },
  {
    type: 'FAKE_SHUFFLE',
    title: 'Shuffle (fake)',
    what: 'Does nothing at all. The deck is untouched.',
    notes: [
      'To everyone else this is identical to a real Shuffle - same card, same number, same message.',
      'Only you know the order did not change.',
    ],
  },
];

const REFLEX: Entry[] = [
  {
    type: 'CANCEL',
    what: 'Stops the card being played from happening at all.',
    notes: ['It cannot touch an Angel.'],
  },
  {
    type: 'BURN',
    what: 'Destroys the card being played, and every copy of that type in every hand at the table.',
    notes: ['Burning an Angel kills the player it was saving, and wipes out every other Angel.'],
  },
  {
    type: 'REDIRECT',
    what: 'Only against an Attack. Throws it back at the attacker and reverses the order of play.',
  },
];

function entryHtml(e: Entry, players: number): string {
  const info = CARD_INFO[e.type];
  const copies =
    e.type === 'HITMAN' ? hitmanCount(players) : cardCount(e.type as never, players);
  return `<div class="fileCard kind-${CARD_KIND[e.type]}">
    <div class="fileMark">${CARD_MARK[e.type]}</div>
    <div class="fileText">
      <div class="fileTitle">
        <span class="fileNo">${CARD_NUMBER[e.type]}</span>
        ${e.title ?? info.name}
        <span class="fileCopies">${copies} in the deck</span>
      </div>
      <p>${e.what}</p>
      ${e.notes ? `<ul>${e.notes.map((n) => `<li>${n}</li>`).join('')}</ul>` : ''}
    </div>
  </div>`;
}

function section(title: string, sub: string, entries: Entry[], players: number): string {
  return `<div class="fileSection">
    <h3>${title} <small>${sub}</small></h3>
    ${entries.map((e) => entryHtml(e, players)).join('')}
  </div>`;
}

/** Everything, written out, for a table of this size. */
export function cardFileHtml(players: number): string {
  const safe = Math.min(Math.max(players, BALANCE.minPlayers), BALANCE.maxPlayers);
  return `
    <div class="fileHead">
      <div>
        <h2>THE CARD FILE</h2>
        <p class="fileFor">Counts shown are for a table of ${safe}.</p>
      </div>
      <button id="closeFile">CLOSE</button>
    </div>
    <div class="fileBody">
      ${section('THE CONTRACT', 'the two that decide who lives', CONTRACT, safe)}
      ${section('ON YOUR TURN', 'played in your own time', ON_YOUR_TURN, safe)}
      ${section(
        'IN THE MOMENT',
        `${BALANCE.quickWindowSeconds} seconds to answer somebody else's card`,
        REFLEX,
        safe,
      )}
      <div class="fileSection">
        <h3>THE SHAPE OF A TURN <small>how it goes</small></h3>
        <div class="fileCard kind-control">
          <div class="fileText">
            <p>Play as many cards as you like, then draw. Drawing ends your turn.
            A Skip ends it instead, with no draw and no risk.</p>
            <ul>
              <li>You get ${BALANCE.turnSeconds} seconds for the whole turn. It does not reset when you play.</li>
              <li>Run out of time and the game draws for you.</li>
              <li>Every clock stops while somebody is being asked to choose.</li>
              <li>There are ${safe - 1} Hitmen in a deck for ${safe} players &mdash; one fewer than the table, so exactly one person can survive.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
}
