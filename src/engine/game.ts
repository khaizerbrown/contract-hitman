import { BALANCE, type Balance } from '../config/balance.js';
import { makeCard, hitmanCount, shuffledBaseDeck, seedHitmen } from './deck.js';
import { randomInt, shuffleInPlace } from './rng.js';
import {
  isNeverPlayable,
  isQuick,
  publicType,
  type AttackEffect,
  type Card,
  type CardType,
  type Lock,
  type LogEntry,
  type Pending,
  type PlayArgs,
  type Player,
  type PrivateInfo,
  type StackEntry,
} from './types.js';

export class GameError extends Error {}

export interface GameState {
  id: string;
  phase: 'playing' | 'ended';
  balance: Balance;
  rngState: number;
  now: number;

  players: Player[];
  order: string[];
  direction: 1 | -1;
  currentIndex: number;

  /** Turns the current player still has to take (1 normally, more under Attack). */
  currentTurnsRemaining: number;
  /** How many of those came from an Attack, so they can be cancelled table-wide. */
  currentExtraFromAttacks: number;

  deck: Card[];
  discard: Card[];

  attackEffects: AttackEffect[];
  locks: Lock[];

  stack: StackEntry[];
  pending: Pending | null;
  promptQueue: Pending[];
  pendingSkip: boolean;
  pendingHitman: Card | null;
  pauseStartedAt: number | null;

  turnDeadline: number;
  drawFromBottom: boolean;
  /** The type of the last card anyone played. Lock bans whatever this is. */
  lastPlayedType: CardType | null;

  privateInfo: Record<string, PrivateInfo[]>;
  log: LogEntry[];
  winner: string | null;
}

export interface CreateOptions {
  id?: string;
  players: { id: string; name: string }[];
  seed?: number;
  balance?: Balance;
}

export interface TestSetup {
  id?: string;
  players: { id: string; name: string; hand: CardType[] }[];
  deck: CardType[];
  seed?: number;
  balance?: Balance;
}

let effectSerial = 0;

export class Game {
  readonly state: GameState;

  private constructor(state: GameState) {
    this.state = state;
  }

  // ---------------------------------------------------------------- creation

  static create(opts: CreateOptions): Game {
    const balance = opts.balance ?? BALANCE;
    const count = opts.players.length;
    if (count < balance.minPlayers || count > balance.maxPlayers) {
      throw new GameError(
        `A match needs between ${balance.minPlayers} and ${balance.maxPlayers} players.`,
      );
    }

    const state = Game.blankState(opts.id ?? 'match', balance, opts.seed ?? 1);

    let deck = shuffledBaseDeck(state, count, balance);

    state.players = opts.players.map((p) => ({
      id: p.id,
      name: p.name,
      hand: [makeCard('ANGEL')],
      alive: true,
      connected: true,
    }));
    for (const p of state.players) {
      for (let i = 0; i < balance.startingHandSize; i++) {
        const card = deck.shift();
        if (card) p.hand.push(card);
      }
    }

    deck = seedHitmen(state, deck, hitmanCount(count), balance);
    state.deck = deck;
    state.order = state.players.map((p) => p.id);

    const game = new Game(state);
    game.beginPlayerTurn();
    return game;
  }

  /** Exact hands and exact deck order. Used by the tests so nothing is random. */
  static forTest(setup: TestSetup): Game {
    const balance = setup.balance ?? BALANCE;
    const state = Game.blankState(setup.id ?? 'test', balance, setup.seed ?? 1);
    state.players = setup.players.map((p) => ({
      id: p.id,
      name: p.name,
      hand: p.hand.map(makeCard),
      alive: true,
      connected: true,
    }));
    state.deck = setup.deck.map(makeCard);
    state.order = state.players.map((p) => p.id);
    const game = new Game(state);
    game.beginPlayerTurn();
    return game;
  }

  private static blankState(id: string, balance: Balance, seed: number): GameState {
    return {
      id,
      phase: 'playing',
      balance,
      rngState: seed,
      now: 0,
      players: [],
      order: [],
      direction: 1,
      currentIndex: 0,
      currentTurnsRemaining: 1,
      currentExtraFromAttacks: 0,
      deck: [],
      discard: [],
      attackEffects: [],
      locks: [],
      stack: [],
      pending: null,
      promptQueue: [],
      pendingSkip: false,
      pendingHitman: null,
      pauseStartedAt: null,
      turnDeadline: 0,
      drawFromBottom: false,
      lastPlayedType: null,
      privateInfo: {},
      log: [],
      winner: null,
    };
  }

  // ------------------------------------------------------------- basic reads

  get balance(): Balance {
    return this.state.balance;
  }

  currentPlayerId(): string {
    return this.state.order[this.state.currentIndex];
  }

  player(id: string): Player {
    const p = this.state.players.find((x) => x.id === id);
    if (!p) throw new GameError('No such player in this match.');
    return p;
  }

  alivePlayers(): Player[] {
    return this.state.players.filter((p) => p.alive);
  }

  /**
   * Extra turns this player still has to take because of an Attack. For whoever
   * is acting the debt is already being paid off, so it comes from the turn
   * counter rather than the outstanding effects.
   */
  extraTurnsOwedBy(playerId: string): number {
    const s = this.state;
    if (playerId === this.currentPlayerId()) return Math.max(0, s.currentTurnsRemaining - 1);
    return s.attackEffects.reduce((total, eff) => total + (eff.owed[playerId] ?? 0), 0);
  }

  /** The counter the whole table can see. This is the tension. */
  hitmenRemaining(): number {
    return this.state.deck.filter((c) => c.type === 'HITMAN').length;
  }

  isLocked(type: CardType): boolean {
    return this.state.locks.some((l) => l.type === type && l.turnsRemaining > 0);
  }

  private log(entry: LogEntry): void {
    this.state.log.push(entry);
  }

  // ------------------------------------------------------------ turn machine

  private beginPlayerTurn(): void {
    const s = this.state;
    if (s.phase === 'ended') return;
    if (this.alivePlayers().length === 0) {
      this.endGame(null);
      return;
    }

    const p = this.player(this.currentPlayerId());
    if (!p.alive) {
      this.advanceToNextAlive();
      return;
    }

    let extras = 0;
    for (const eff of s.attackEffects) {
      const owed = eff.owed[p.id] ?? 0;
      if (owed > 0) {
        extras += owed;
        eff.owed[p.id] = 0;
      }
    }
    s.attackEffects = s.attackEffects.filter((e) =>
      Object.values(e.owed).some((v) => v > 0),
    );

    extras = Math.min(extras, s.balance.maxExtraTurnsPerPlayer);
    s.currentTurnsRemaining = 1 + extras;
    s.currentExtraFromAttacks = extras;

    this.log({ t: 'turn_start', playerId: p.id });
    this.startSegment();
  }

  /** One pass of the 15-second clock. An attacked player gets several in a row. */
  private startSegment(): void {
    const s = this.state;
    for (const lock of s.locks) lock.turnsRemaining -= 1;
    for (const lock of s.locks) {
      if (lock.turnsRemaining <= 0) this.log({ t: 'lock_expired', cardType: lock.type });
    }
    s.locks = s.locks.filter((l) => l.turnsRemaining > 0);
    s.drawFromBottom = false;
    s.turnDeadline = s.now + s.balance.turnSeconds * 1000;
  }

  private endSegment(): void {
    const s = this.state;
    if (s.phase === 'ended') return;
    s.currentTurnsRemaining -= 1;
    s.currentExtraFromAttacks = Math.max(0, s.currentExtraFromAttacks - 1);
    if (s.currentTurnsRemaining > 0) {
      this.log({ t: 'turn_start', playerId: this.currentPlayerId() });
      this.startSegment();
    } else {
      this.advanceToNextAlive();
    }
  }

  private advanceToNextAlive(): void {
    const s = this.state;
    for (let i = 0; i < s.order.length; i++) {
      s.currentIndex = (s.currentIndex + s.direction + s.order.length) % s.order.length;
      if (this.player(this.currentPlayerId()).alive) {
        this.beginPlayerTurn();
        return;
      }
    }
    this.endGame(null);
  }

  private endGame(winnerId: string | null): void {
    this.state.phase = 'ended';
    this.state.winner = winnerId;
    this.state.pending = null;
    this.state.promptQueue = [];
    this.log({ t: 'game_over', winnerId });
  }

  private checkWin(): boolean {
    const alive = this.alivePlayers();
    if (alive.length === 1) {
      this.endGame(alive[0].id);
      return true;
    }
    if (alive.length === 0) {
      this.endGame(null);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------ clock freeze

  private setPending(p: Pending): void {
    this.state.pending = p;
    if (this.state.pauseStartedAt === null) this.state.pauseStartedAt = this.state.now;
  }

  private clearPending(): void {
    const s = this.state;
    s.pending = null;
    if (s.promptQueue.length === 0 && s.pauseStartedAt !== null) {
      s.turnDeadline += s.now - s.pauseStartedAt;
      s.pauseStartedAt = null;
    }
  }

  // ----------------------------------------------------------- playing cards

  play(playerId: string, cardId: string, args: PlayArgs = {}): void {
    const s = this.state;
    if (s.phase !== 'playing') throw new GameError('The match is over.');
    const p = this.player(playerId);
    if (!p.alive) throw new GameError('Eliminated players cannot play cards.');

    const card = p.hand.find((c) => c.id === cardId);
    if (!card) throw new GameError('You are not holding that card.');
    if (isNeverPlayable(card.type)) {
      throw new GameError('That card can never be played from your hand.');
    }

    // An Angel goes down at exactly one moment: a Hitman has just been drawn on
    // you. Putting it on the table gives the rest of the table a beat to Burn it.
    const answeringHitman =
      s.pending && s.pending.kind === 'angel' && s.pending.playerId === playerId;

    if (card.type === 'ANGEL') {
      if (!answeringHitman) {
        throw new GameError('An Angel only goes down when a Hitman has your name on it.');
      }
      this.clearPending();
      this.moveToStack(p, card, args);
      this.log({ t: 'angel_played', playerId, mirrored: false });
      this.openQuickWindow();
      return;
    }

    // A Mirror can stand in for an Angel, but only while an Angel is still the
    // last card played - that is, only if a Hitman found you immediately after
    // somebody else was saved by one.
    if (card.type === 'MIRROR' && answeringHitman && this.mirrorCountsAsAngel()) {
      this.clearPending();
      p.hand = p.hand.filter((c) => c.id !== card.id);
      s.stack.push({ card, playerId, args, cancelled: false, asAngel: true });
      this.log({ t: 'card_played', playerId, cardType: 'MIRROR' });
      this.log({ t: 'angel_played', playerId, mirrored: true });
      s.lastPlayedType = card.type;
      this.openQuickWindow();
      return;
    }
    if (this.isLocked(card.type)) throw new GameError('That card type is locked right now.');

    if (card.type === 'LOCK') {
      const banned = this.lockTargetFor(card);
      if (!banned) {
        throw new GameError('Nothing has been played yet for Lock to ban.');
      }
      args = { ...args, lockType: banned };
    }

    if (s.pending && s.pending.kind === 'quickWindow') {
      if (!isQuick(card.type)) {
        throw new GameError('Only quick cards can be played in the reflex window.');
      }
      if (!s.pending.eligible.includes(playerId)) {
        throw new GameError('You cannot respond to this card.');
      }
      if (!this.quickIsLegal(card.type)) {
        throw new GameError('That quick card does not apply here.');
      }
      this.moveToStack(p, card, args);
      this.clearPending();
      this.openQuickWindow();
      return;
    }

    if (isQuick(card.type)) {
      throw new GameError('Quick cards only work in response to another card.');
    }
    if (s.pending) throw new GameError('Waiting for another player to choose.');
    if (this.currentPlayerId() !== playerId) throw new GameError('It is not your turn.');

    this.validateArgs(card.type, args, playerId);
    this.moveToStack(p, card, args);
    this.openQuickWindow();
  }

  private moveToStack(p: Player, card: Card, args: PlayArgs): void {
    p.hand = p.hand.filter((c) => c.id !== card.id);
    this.state.stack.push({ card, playerId: p.id, args, cancelled: false });
    this.log({ t: 'card_played', playerId: p.id, cardType: publicType(card.type) });
    this.state.lastPlayedType = card.type;
  }

  /**
   * Lock does not offer a choice. It bans whatever was played immediately
   * before it. Hitman and Angel can never be banned - neither is ever played
   * from a hand, so neither can ever be the last card played.
   */
  private lockTargetFor(card: Card): CardType | null {
    if (card.type !== 'LOCK') return null;
    return this.state.lastPlayedType;
  }

  private validateArgs(type: CardType, args: PlayArgs, actorId: string): void {
    if (type === 'ATTACK' || type === 'STEAL' || type === 'MIMIC') {
      const t = args.targetPlayerId;
      if (!t) throw new GameError('Choose a player to target.');
      if (t === actorId) throw new GameError('You cannot target yourself.');
      const target = this.player(t);
      if (!target.alive) throw new GameError('That player is already out.');
      if (type === 'STEAL' && target.hand.length === 0) {
        throw new GameError('That player has no cards to take.');
      }
    }
  }

  private quickIsLegal(type: CardType): boolean {
    const top = this.state.stack[this.state.stack.length - 1];
    if (!top) return false;
    if (type === 'REDIRECT') return top.card.type === 'ATTACK';
    if (top.card.type === 'ANGEL' || top.asAngel) {
      // An Angel cannot be cancelled. Burn is the only answer to one - and it
      // takes every Angel at the table with it. Mirroring a save means nothing.
      return type === 'BURN';
    }
    return true;
  }

  private openQuickWindow(): void {
    const s = this.state;
    if (s.stack.length >= 1 + s.balance.quickChainMaxDepth) {
      this.resolveStack();
      return;
    }
    const top = s.stack[s.stack.length - 1];
    const eligible = s.players
      .filter(
        (p) =>
          p.alive &&
          p.id !== top.playerId &&
          p.hand.some(
            (c) => isQuick(c.type) && !this.isLocked(c.type) && this.quickIsLegal(c.type),
          ),
      )
      .map((p) => p.id);

    if (eligible.length === 0) {
      this.resolveStack();
      return;
    }
    this.setPending({
      kind: 'quickWindow',
      eligible,
      responded: [],
      deadline: s.now + s.balance.quickWindowSeconds * 1000,
    });
  }

  /** Decline to respond during the reflex window. */
  pass(playerId: string): void {
    const s = this.state;
    if (!s.pending || s.pending.kind !== 'quickWindow') {
      throw new GameError('There is nothing to respond to.');
    }
    if (!s.pending.eligible.includes(playerId)) {
      throw new GameError('You are not part of this window.');
    }
    if (s.pending.responded.includes(playerId)) return;
    s.pending.responded.push(playerId);
    if (s.pending.responded.length >= s.pending.eligible.length) {
      this.closeQuickWindow();
    }
  }

  private closeQuickWindow(): void {
    this.clearPending();
    this.resolveStack();
  }

  // -------------------------------------------------------------- resolution

  private resolveStack(): void {
    const s = this.state;
    const entries = s.stack;
    s.stack = [];

    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i];
      if (e.cancelled) continue;
      const below = i > 0 ? entries[i - 1] : null;

      switch (e.card.type) {
        case 'CANCEL':
          if (below && below.card.type !== 'ANGEL' && !below.cancelled && !below.asAngel) {
            below.cancelled = true;
            this.log({
              t: 'card_cancelled',
              cardType: publicType(below.card.type),
              byPlayerId: e.playerId,
            });
          }
          break;

        case 'BURN':
          if (below) {
            below.cancelled = true;
            const burnedType = below.card.type;
            let destroyed = 0;
            for (const p of s.players) {
              const keep: Card[] = [];
              for (const c of p.hand) {
                if (c.type === burnedType) {
                  s.discard.push(c);
                  destroyed += 1;
                } else {
                  keep.push(c);
                }
              }
              p.hand = keep;
            }
            this.log({
              t: 'burned',
              cardType: publicType(burnedType),
              byPlayerId: e.playerId,
              copiesDestroyed: destroyed,
            });
          }
          break;

        case 'MIRROR':
          // Re-triggers the last card played. Mirroring another quick card does
          // nothing, which is what keeps response chains short and predictable.
          // A Mirror standing in for an Angel is doing that job instead.
          if (!e.asAngel && below && !isQuick(below.card.type)) {
            this.log({
              t: 'mirrored',
              cardType: publicType(below.card.type),
              byPlayerId: e.playerId,
            });
            this.applyEffect(below.card.type, e.playerId, below.args);
          }
          break;

        case 'REDIRECT':
          if (below && below.card.type === 'ATTACK') {
            below.cancelled = true;
            this.addAttack(e.playerId, [below.playerId]);
            s.direction = s.direction === 1 ? -1 : 1;
            this.log({ t: 'redirected', fromPlayerId: e.playerId, toPlayerId: below.playerId });
            this.log({ t: 'direction_reversed' });
          }
          break;

        default:
          this.applyEffect(e.card.type, e.playerId, e.args);
      }
    }

    for (const e of entries) s.discard.push(e.card);

    const angel = entries.find((e) => e.card.type === 'ANGEL' || e.asAngel);
    if (angel) {
      if (angel.cancelled) {
        this.log({ t: 'angel_burned', playerId: angel.playerId });
        this.killByHitman(angel.playerId);
      } else {
        this.offerHitmanPlacement(angel.playerId);
      }
      return;
    }

    this.runPromptQueue();
    this.afterEffects();
  }

  private applyEffect(type: CardType, actorId: string, args: PlayArgs): void {
    const s = this.state;
    switch (type) {
      case 'ATTACK': {
        const target = args.targetPlayerId;
        if (target && this.player(target).alive) this.addAttack(actorId, [target]);
        break;
      }
      case 'FULL_ATTACK': {
        const targets = this.alivePlayers()
          .filter((p) => p.id !== actorId)
          .map((p) => p.id);
        if (targets.length > 0) this.addAttack(actorId, targets);
        break;
      }
      case 'SKIP':
        s.pendingSkip = true;
        break;
      case 'STEAL': {
        const target = args.targetPlayerId;
        if (target && this.player(target).alive && this.player(target).hand.length > 0) {
          s.promptQueue.push({
            kind: 'steal',
            playerId: target,
            thiefId: actorId,
            deadline: 0,
          });
        }
        break;
      }
      case 'PEEK': {
        const seen = s.deck.slice(0, 3).map((c) => ({ ...c }));
        if (!s.privateInfo[actorId]) s.privateInfo[actorId] = [];
        s.privateInfo[actorId].push({ kind: 'peek', cards: seen, deckCount: s.deck.length });
        break;
      }
      case 'LOCK': {
        const lockType = args.lockType;
        if (lockType) {
          s.locks.push({ type: lockType, turnsRemaining: s.balance.lockTurns + 1 });
          this.log({
            t: 'locked',
            playerId: actorId,
            cardType: lockType,
            turns: s.balance.lockTurns,
          });
        }
        break;
      }
      case 'MIMIC': {
        const target = args.targetPlayerId;
        if (target) {
          const actor = this.player(actorId);
          // Mimic is a swap, not a windfall: your own hand goes, Angel and all,
          // and you take a copy of theirs in its place. They keep theirs.
          const lost = actor.hand.length;
          for (const c of actor.hand) s.discard.push(c);
          actor.hand = [];
          // It still never copies another Mimic. One Mimic becoming two, then
          // four, is how hands used to grow without limit.
          const copy = this.player(target)
            .hand.filter((c) => c.type !== 'MIMIC')
            .slice(0, s.balance.maxHandSize)
            .map((c) => makeCard(c.type));
          actor.hand.push(...copy);
          this.log({
            t: 'mimicked',
            playerId: actorId,
            targetPlayerId: target,
            cards: copy.length,
            lost,
          });
        }
        break;
      }
      case 'BOTTOM_PULL':
        if (actorId === this.currentPlayerId()) s.drawFromBottom = true;
        break;
      case 'REAL_SHUFFLE':
        shuffleInPlace(s, s.deck);
        this.log({ t: 'shuffled', playerId: actorId });
        break;
      case 'FAKE_SHUFFLE':
        // Identical public log entry, deck untouched. Nobody can tell them apart.
        this.log({ t: 'shuffled', playerId: actorId });
        break;
      default:
        break;
    }
  }

  private addAttack(sourceId: string, targets: string[]): void {
    const s = this.state;
    effectSerial += 1;
    const eff: AttackEffect = { id: `atk${effectSerial}`, sourcePlayerId: sourceId, owed: {} };
    const cap = 1 + s.balance.maxExtraTurnsPerPlayer;
    for (const t of targets) {
      if (t === this.currentPlayerId() && s.currentTurnsRemaining > 0) {
        // Their turn is happening right now, so hand them the extra turn at once.
        if (s.currentTurnsRemaining < cap) {
          s.currentTurnsRemaining += 1;
          s.currentExtraFromAttacks += 1;
        }
      } else {
        eff.owed[t] = (eff.owed[t] ?? 0) + 1;
      }
    }
    if (Object.keys(eff.owed).length > 0) s.attackEffects.push(eff);
    this.log({ t: 'attack', byPlayerId: sourceId, targets });
  }

  /**
   * A Hitman hitting the table wipes every outstanding Attack, for everyone
   * still owed turns, not just the player who drew it.
   */
  private cancelAllAttacks(): void {
    const s = this.state;
    if (s.attackEffects.length === 0 && s.currentExtraFromAttacks === 0) return;
    s.attackEffects = [];
    s.currentTurnsRemaining = Math.max(1, s.currentTurnsRemaining - s.currentExtraFromAttacks);
    s.currentExtraFromAttacks = 0;
    this.log({ t: 'attack_cancelled', reason: 'hitman_drawn' });
  }

  private runPromptQueue(): void {
    const s = this.state;
    if (s.pending) return;
    while (s.promptQueue.length > 0) {
      const next = s.promptQueue.shift()!;
      // Two Steals can be queued against the same player - a Mirror will do it -
      // and the first one can empty their hand. Do not ask for a card they
      // cannot give.
      if (next.kind === 'steal' && this.player(next.playerId).hand.length === 0) continue;
      next.deadline = s.now + s.balance.choiceSeconds * 1000;
      this.setPending(next);
      return;
    }
  }

  /** Runs once nothing is waiting on a player's choice. */
  private afterEffects(): void {
    const s = this.state;
    if (s.pending || s.phase === 'ended') return;
    if (s.pendingSkip) {
      s.pendingSkip = false;
      this.log({ t: 'skipped', playerId: this.currentPlayerId() });
      this.endSegment();
    }
  }

  // ----------------------------------------------------------------- drawing

  draw(playerId: string): void {
    const s = this.state;
    if (s.phase !== 'playing') throw new GameError('The match is over.');
    if (s.pending) throw new GameError('Waiting for another player to choose.');
    if (s.stack.length > 0) throw new GameError('A card is still resolving.');
    if (this.currentPlayerId() !== playerId) throw new GameError('It is not your turn.');

    if (s.deck.length === 0) {
      if (!this.checkWin()) this.endGame(null);
      return;
    }

    const fromBottom = s.drawFromBottom;
    const card = (fromBottom ? s.deck.pop() : s.deck.shift())!;
    this.log({ t: 'drew', playerId, fromBottom });

    if (card.type === 'HITMAN') {
      this.handleHitman(playerId, card);
      return;
    }
    this.player(playerId).hand.push(card);
    this.endSegment();
  }

  private handleHitman(playerId: string, hitman: Card): void {
    const s = this.state;
    const p = this.player(playerId);
    this.log({ t: 'hitman_drawn', playerId });
    this.cancelAllAttacks();

    s.pendingHitman = hitman;

    if (this.canAnswerHitman(playerId)) {
      // They hold an answer. Putting it down is a play, which the rest of the
      // table gets a beat to Burn.
      this.setPending({
        kind: 'angel',
        playerId,
        deadline: s.now + s.balance.choiceSeconds * 1000,
      });
      return;
    }

    this.killByHitman(playerId);
  }

  /**
   * An Angel of your own, or a Mirror while an Angel is still the last card
   * played. The Mirror route is the narrow one: it only exists in the moment
   * straight after somebody else was saved.
   */
  private mirrorCountsAsAngel(): boolean {
    return this.state.lastPlayedType === 'ANGEL';
  }

  private canAnswerHitman(playerId: string): boolean {
    const hand = this.player(playerId).hand;
    if (hand.some((c) => c.type === 'ANGEL') && !this.isLocked('ANGEL')) return true;
    return (
      this.mirrorCountsAsAngel() &&
      hand.some((c) => c.type === 'MIRROR') &&
      !this.isLocked('MIRROR')
    );
  }

  /** The Hitman lands: no Angel, or the Angel was burned off the table. */
  private killByHitman(playerId: string): void {
    const s = this.state;
    const p = this.player(playerId);
    p.alive = false;
    for (const c of p.hand) s.discard.push(c);
    p.hand = [];
    if (s.pendingHitman) s.discard.push(s.pendingHitman); // done its job, leaves the game
    s.pendingHitman = null;
    this.log({ t: 'eliminated', playerId });

    if (this.checkWin()) return;
    s.currentTurnsRemaining = 1;
    s.currentExtraFromAttacks = 0;
    this.endSegment();
  }

  /** The Angel held. Now they say where the Hitman goes back. */
  private offerHitmanPlacement(playerId: string): void {
    const s = this.state;
    this.setPending({
      kind: 'hitmanPlacement',
      playerId,
      deadline: s.now + s.balance.choiceSeconds * 1000,
    });
  }

  // ---------------------------------------------------------- making choices

  choose(playerId: string, choice: string): void {
    const s = this.state;
    const pending = s.pending;
    if (!pending) throw new GameError('There is nothing to choose right now.');

    if (pending.kind === 'hitmanPlacement') {
      if (pending.playerId !== playerId) throw new GameError('That choice is not yours to make.');
      this.placeHitman(playerId, choice as 'top' | 'middle' | 'bottom');
      return;
    }

    if (pending.kind === 'steal') {
      if (pending.playerId !== playerId) throw new GameError('That choice is not yours to make.');
      this.giveStolenCard(pending.playerId, pending.thiefId, choice);
      return;
    }

    throw new GameError('There is nothing to choose right now.');
  }

  private placeHitman(playerId: string, where: 'top' | 'middle' | 'bottom'): void {
    const s = this.state;
    const hitman = s.pendingHitman;
    if (!hitman) throw new GameError('No Hitman card is waiting to be placed.');
    const spot: 'top' | 'middle' | 'bottom' =
      where === 'top' || where === 'bottom' ? where : 'middle';

    if (spot === 'top') s.deck.unshift(hitman);
    else if (spot === 'bottom') s.deck.push(hitman);
    else s.deck.splice(Math.floor(s.deck.length / 2), 0, hitman);

    s.pendingHitman = null;
    this.log({ t: 'angel_saved', playerId, placement: spot });
    this.clearPending();

    // Surviving a Hitman ends your turn, including any extra turns you were owed.
    s.currentTurnsRemaining = 1;
    s.currentExtraFromAttacks = 0;
    s.pendingSkip = false;
    this.runPromptQueue();
    if (!s.pending) this.endSegment();
  }

  private giveStolenCard(targetId: string, thiefId: string, cardId: string): void {
    const s = this.state;
    const target = this.player(targetId);
    const idx = target.hand.findIndex((c) => c.id === cardId);
    if (idx < 0) throw new GameError('You are not holding that card.');
    const taken = target.hand.splice(idx, 1);
    this.player(thiefId).hand.push(taken[0]);
    this.log({ t: 'stolen', thiefId, fromPlayerId: targetId });
    this.clearPending();
    this.runPromptQueue();
    this.afterEffects();
  }

  // ------------------------------------------------------------------- clock

  setNow(ms: number): void {
    this.state.now = ms;
  }

  advance(ms: number): void {
    this.state.now += ms;
  }

  /** The server calls this on a tick. Fires whatever has run out of time. */
  checkTimers(): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    if (s.pending) {
      if (s.now >= s.pending.deadline) this.timeout();
    } else if (s.now >= s.turnDeadline) {
      this.timeout();
    }
  }

  /** Force whatever is currently waiting to time out. */
  timeout(): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const pending = s.pending;

    if (!pending) {
      const pid = this.currentPlayerId();
      this.log({ t: 'timed_out', playerId: pid });
      this.draw(pid);
      return;
    }

    if (pending.kind === 'quickWindow') {
      this.closeQuickWindow();
      return;
    }
    if (pending.kind === 'angel') {
      // Nobody would ever choose to die, so a slow connection never costs a life.
      const hand = this.player(pending.playerId).hand;
      // Spend the Mirror if it will do, and keep the Angel for next time.
      const answer =
        (this.mirrorCountsAsAngel() ? hand.find((c) => c.type === 'MIRROR') : undefined) ??
        hand.find((c) => c.type === 'ANGEL');
      this.log({ t: 'timed_out', playerId: pending.playerId });
      try {
        if (!answer) throw new GameError('nothing to answer with');
        this.play(pending.playerId, answer.id);
      } catch {
        this.clearPending();
        this.killByHitman(pending.playerId);
      }
      return;
    }
    if (pending.kind === 'hitmanPlacement') {
      this.log({ t: 'timed_out', playerId: pending.playerId });
      this.placeHitman(pending.playerId, 'middle');
      return;
    }
    if (pending.kind === 'steal') {
      const target = this.player(pending.playerId);
      this.log({ t: 'timed_out', playerId: pending.playerId });
      const pick = target.hand[randomInt(s, target.hand.length)];
      if (!pick) {
        // Nothing left to hand over. Let the turn carry on rather than stopping.
        this.clearPending();
        this.runPromptQueue();
        this.afterEffects();
        return;
      }
      this.giveStolenCard(pending.playerId, pending.thiefId, pick.id);
    }
  }

  // -------------------------------------------------------------- disconnect

  setConnected(playerId: string, connected: boolean): void {
    this.player(playerId).connected = connected;
  }

  /** Called once the grace period runs out. That player is out of the match. */
  forfeit(playerId: string): void {
    const s = this.state;
    const p = this.player(playerId);
    if (!p.alive || s.phase !== 'playing') return;
    p.alive = false;
    for (const c of p.hand) s.discard.push(c);
    p.hand = [];
    this.log({ t: 'eliminated', playerId });
    if (this.checkWin()) return;
    if (this.currentPlayerId() === playerId) {
      s.currentTurnsRemaining = 1;
      s.currentExtraFromAttacks = 0;
      this.endSegment();
    }
  }

  // ------------------------------------------------------------------- views

  /**
   * What one client is allowed to know. Eliminated players and spectators get
   * no hands at all. No client ever sees the deck order or another player's cards.
   */
  viewFor(viewerId: string | null) {
    const s = this.state;
    const me = viewerId ? s.players.find((p) => p.id === viewerId) ?? null : null;

    return {
      gameId: s.id,
      phase: s.phase,
      winnerId: s.winner,
      you: me
        ? {
            id: me.id,
            alive: me.alive,
            hand: me.alive ? me.hand.map((c) => ({ ...c })) : [],
          }
        : null,
      players: s.players.map((p) => ({
        id: p.id,
        name: p.name,
        alive: p.alive,
        connected: p.connected,
        handCount: p.hand.length,
        // Extra turns an Attack has hung on them. Public: everyone watched it
        // happen, so everyone can see who is carrying it.
        extraTurns: this.extraTurnsOwedBy(p.id),
      })),
      currentPlayerId: this.currentPlayerId(),
      currentTurnsRemaining: s.currentTurnsRemaining,
      direction: s.direction,
      deckCount: s.deck.length,
      hitmenRemaining: this.hitmenRemaining(),
      discardCount: s.discard.length,
      locks: s.locks.map((l) => ({
        type: l.type,
        // A lock carries one extra turn internally so it also covers the rest of
        // the turn it was played on. Players only ever see the 3 they promised.
        turnsRemaining: Math.min(l.turnsRemaining, s.balance.lockTurns),
      })),
      stack: s.stack.map((e) => ({
        playerId: e.playerId,
        cardType: publicType(e.card.type),
        // Who a card is aimed at is public - everyone at the table can see it.
        targetPlayerId: e.args.targetPlayerId ?? null,
        lockType: e.args.lockType ?? null,
        cancelled: e.cancelled,
      })),
      pending: s.pending
        ? s.pending.kind === 'steal'
          ? {
              kind: 'steal' as const,
              playerId: s.pending.playerId,
              thiefId: s.pending.thiefId,
              deadline: s.pending.deadline,
              options:
                s.pending.playerId === viewerId
                  ? this.player(s.pending.playerId).hand.map((c) => ({ ...c }))
                  : null,
            }
          : { ...s.pending }
        : null,
      turnDeadline: s.turnDeadline,
      lastPlayedType: s.lastPlayedType,
      /** Bottom Pull is on the table, so this draw comes off the bottom. */
      drawFromBottom: s.drawFromBottom,
      now: s.now,
      privateInfo: viewerId ? s.privateInfo[viewerId] ?? [] : [],
      log: s.log,
    };
  }
}

/** Exactly what one client is allowed to know. */
export type MatchView = ReturnType<Game['viewFor']>;
