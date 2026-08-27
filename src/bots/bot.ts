import type { Game } from '../engine/game.js';
import type { Card, CardType } from '../engine/types.js';

/**
 * A bot only ever reads its OWN view of the match - the same redacted data a
 * real network client would get - and then calls the same public engine methods
 * a human does. It has no secret knowledge.
 */
export class Bot {
  constructor(
    readonly id: string,
    readonly name: string,
  ) {}

  // ------------------------------------------------------------- on its turn

  takeTurn(game: Game): void {
    const view = game.viewFor(this.id);
    const hand = view.you?.hand ?? [];
    if (!view.you?.alive) return;

    const danger = view.deckCount > 0 ? view.hitmenRemaining / view.deckCount : 1;
    const hasAngel = hand.some((c) => c.type === 'ANGEL');
    const topIsHitman = this.peekedHitmanOnTop(view);
    const opponents = view.players.filter((p) => p.alive && p.id !== this.id);
    if (opponents.length === 0) return;

    const held = (t: CardType) => hand.find((c) => c.type === t);
    const scared = topIsHitman || danger > (hasAngel ? 0.22 : 0.12);

    // Known Hitman on top: get out of the way rather than draw into it.
    if (topIsHitman) {
      const skip = held('SKIP');
      if (skip) return this.play(game, skip);
      const attack = held('ATTACK');
      if (attack) return this.play(game, attack, { targetPlayerId: this.pickVictim(opponents) });
      const bottom = held('BOTTOM_PULL');
      if (bottom) return this.play(game, bottom);
    }

    if (scared) {
      const skip = held('SKIP');
      if (skip && this.chance(0.8)) return this.play(game, skip);
      const full = held('FULL_ATTACK');
      if (full && this.chance(0.5)) return this.play(game, full);
    }

    const peek = held('PEEK');
    if (peek && !this.hasPeeked(view) && this.chance(0.7)) return this.play(game, peek);

    const steal = held('STEAL');
    const fattest = opponents.filter((p) => p.handCount > 0).sort((a, b) => b.handCount - a.handCount)[0];
    if (steal && fattest && this.chance(0.45)) {
      return this.play(game, steal, { targetPlayerId: fattest.id });
    }

    const attack = held('ATTACK');
    if (attack && this.chance(0.45)) {
      return this.play(game, attack, { targetPlayerId: this.pickVictim(opponents) });
    }

    // Lock bans whatever was played last, so it is only worth playing when
    // something worth banning is sitting there.
    const lock = held('LOCK');
    const wouldBan = view.lastPlayedType;
    if (lock && wouldBan && this.chance(0.45)) {
      const worthIt = ['SKIP', 'CANCEL', 'ATTACK', 'FULL_ATTACK', 'REDIRECT', 'BURN'];
      if (worthIt.includes(wouldBan) || this.chance(0.25)) return this.play(game, lock);
    }

    // Mimic costs this bot its whole hand, Angel included, so it is only worth
    // it when the other hand is clearly better and there is little to lose.
    const mimic = held('MIMIC');
    if (mimic && fattest && fattest.handCount >= hand.length + 2) {
      const givingUpAngel = hasAngel;
      if (!givingUpAngel || fattest.handCount >= hand.length + 4) {
        if (this.chance(0.4)) return this.play(game, mimic, { targetPlayerId: fattest.id });
      }
    }

    // Mirror repeats the last card played, so it is worth it when that card was.
    const mirror = held('MIRROR');
    const repeatable = view.lastPlayedType;
    if (mirror && repeatable && !['MIRROR', 'ANGEL', 'CANCEL', 'BURN', 'REDIRECT'].includes(repeatable)) {
      const worthIt = ['ATTACK', 'FULL_ATTACK', 'STEAL', 'MIMIC', 'PEEK'];
      if (worthIt.includes(repeatable) && this.chance(0.5)) return this.play(game, mirror);
    }

    const fake = held('FAKE_SHUFFLE');
    if (fake && this.chance(0.3)) return this.play(game, fake);
    const real = held('REAL_SHUFFLE');
    if (real && danger > 0.15 && this.chance(0.4)) return this.play(game, real);

    game.draw(this.id);
  }

  // ---------------------------------------------------- inside a quick window

  respondToQuickWindow(game: Game): void {
    const view = game.viewFor(this.id);
    const hand = view.you?.hand ?? [];
    const top = view.stack[view.stack.length - 1];
    if (!top) return this.safePass(game);

    const aimedAtMe = top.cardType === 'FULL_ATTACK' || top.targetPlayerId === this.id;

    const held = (t: CardType) => hand.find((c) => c.type === t);

    if (top.cardType === 'ATTACK' && aimedAtMe) {
      const redirect = held('REDIRECT');
      if (redirect && this.chance(0.75)) return this.play(game, redirect);
    }
    if (aimedAtMe) {
      const cancel = held('CANCEL');
      if (cancel && this.chance(0.6)) return this.play(game, cancel);
      const burn = held('BURN');
      if (burn && this.chance(0.4)) return this.play(game, burn);
    }
    const cancel = held('CANCEL');
    if (cancel && this.chance(0.12)) return this.play(game, cancel);

    this.safePass(game);
  }

  // -------------------------------------------------------------- choices

  /** Somebody played Steal on this bot: hand over the least useful card. */
  chooseCardToGive(game: Game): void {
    const hand = game.viewFor(this.id).you?.hand ?? [];
    if (hand.length === 0) return;
    const worst = hand.slice().sort((a, b) => this.value(a.type) - this.value(b.type))[0];
    game.choose(this.id, worst.id);
  }

  /** A Hitman landed on this bot and it holds an answer. Put it down. */
  playAngel(game: Game): void {
    const view = game.viewFor(this.id);
    const hand = view.you?.hand ?? [];
    // Copy the Angel with a Mirror where that works, and keep the real one.
    const mirror = view.lastPlayedType === 'ANGEL'
      ? hand.find((c) => c.type === 'MIRROR')
      : undefined;
    const answer = mirror ?? hand.find((c) => c.type === 'ANGEL');
    if (answer) this.play(game, answer);
  }

  /** An Angel just saved this bot: decide where the Hitman goes back. */
  chooseHitmanPlacement(game: Game): void {
    const roll = Math.random();
    const where = roll < 0.55 ? 'top' : roll < 0.85 ? 'bottom' : 'middle';
    game.choose(this.id, where);
  }

  // -------------------------------------------------------------- internals

  private play(game: Game, card: Card, args: Record<string, unknown> = {}): void {
    try {
      game.play(this.id, card.id, args as never);
    } catch {
      // The board changed under the bot. Falling back to a draw is always legal
      // on its own turn, and passing is always legal in a window.
      this.safeFallback(game);
    }
  }

  private safeFallback(game: Game): void {
    try {
      if (game.state.pending?.kind === 'quickWindow') game.pass(this.id);
      else if (game.currentPlayerId() === this.id) game.draw(this.id);
    } catch {
      /* nothing legal left to do this tick */
    }
  }

  private safePass(game: Game): void {
    try {
      game.pass(this.id);
    } catch {
      /* window already closed */
    }
  }

  private pickVictim(opponents: { id: string; handCount: number }[]): string {
    const sorted = opponents.slice().sort((a, b) => a.handCount - b.handCount);
    return sorted[0].id;
  }

  private chance(p: number): boolean {
    return Math.random() < p;
  }

  private hasPeeked(view: ReturnType<Game['viewFor']>): boolean {
    return view.privateInfo.length > 0;
  }

  private peekedHitmanOnTop(view: ReturnType<Game['viewFor']>): boolean {
    const last = view.privateInfo[view.privateInfo.length - 1];
    return !!last && last.cards[0]?.type === 'HITMAN';
  }

  private value(type: CardType): number {
    const table: Partial<Record<CardType, number>> = {
      ANGEL: 100,
      CANCEL: 60,
      REDIRECT: 55,
      SKIP: 50,
      BURN: 45,
      ATTACK: 40,
      FULL_ATTACK: 38,
      MIRROR: 35,
      STEAL: 30,
      PEEK: 25,
      MIMIC: 22,
      LOCK: 20,
      BOTTOM_PULL: 15,
      REAL_SHUFFLE: 10,
      FAKE_SHUFFLE: 5,
    };
    return table[type] ?? 0;
  }
}

export const BOT_NAMES = [
  'CROW',
  'VESPER',
  'MAGPIE',
  'HALLOW',
  'SABLE',
  'CINDER',
  'RATCHET',
  'VOSS',
  'KESTREL',
  'DRAKE',
  'MERIDIAN',
];
