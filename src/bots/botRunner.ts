import type { Game } from '../engine/game.js';
import type { Bot } from './bot.js';

/**
 * Makes bots act at human speed instead of instantly. Used by both the offline
 * game in the browser and the real server, so bots behave identically in each.
 */
export class BotRunner {
  private scheduleKey = '';
  private dueAt: Record<string, number> = {};

  constructor(
    private readonly game: Game,
    private readonly bots: Bot[],
  ) {}

  private bot(id: string): Bot | undefined {
    return this.bots.find((b) => b.id === id);
  }

  /** Call on every tick with the match clock in milliseconds. */
  tick(now: number): void {
    const g = this.game;
    if (g.state.phase !== 'playing') return;
    const s = g.state;
    const pending = s.pending;

    if (pending && pending.kind === 'quickWindow') {
      const waiting = pending.eligible.filter(
        (id) => this.bot(id) && !pending.responded.includes(id),
      );
      this.reschedule(`quick:${s.log.length}`, waiting, now, 350, 1100);
      for (const id of waiting) {
        if (now >= (this.dueAt[id] ?? Infinity)) {
          this.dueAt[id] = Infinity;
          this.bot(id)!.respondToQuickWindow(g);
          return;
        }
      }
      return;
    }

    if (pending && pending.kind === 'angel') {
      const bot = this.bot(pending.playerId);
      if (!bot) return;
      this.reschedule(`angel:${s.log.length}`, [bot.id], now, 300, 900);
      if (now >= (this.dueAt[bot.id] ?? Infinity)) {
        this.dueAt[bot.id] = Infinity;
        bot.playAngel(g);
      }
      return;
    }

    if (pending && pending.kind === 'steal') {
      const bot = this.bot(pending.playerId);
      if (!bot) return;
      this.reschedule(`steal:${s.log.length}`, [bot.id], now, 500, 1200);
      if (now >= (this.dueAt[bot.id] ?? Infinity)) {
        this.dueAt[bot.id] = Infinity;
        bot.chooseCardToGive(g);
      }
      return;
    }

    if (pending && pending.kind === 'hitmanPlacement') {
      const bot = this.bot(pending.playerId);
      if (!bot) return;
      this.reschedule(`place:${s.log.length}`, [bot.id], now, 700, 1600);
      if (now >= (this.dueAt[bot.id] ?? Infinity)) {
        this.dueAt[bot.id] = Infinity;
        bot.chooseHitmanPlacement(g);
      }
      return;
    }

    const current = g.currentPlayerId();
    const bot = this.bot(current);
    if (!bot) return;
    this.reschedule(`turn:${current}:${s.log.length}`, [bot.id], now, 650, 1500);
    if (now >= (this.dueAt[bot.id] ?? Infinity)) {
      this.dueAt[bot.id] = Infinity;
      bot.takeTurn(g);
    }
  }

  /** Fresh thinking delay for each bot whenever the situation changes. */
  private reschedule(
    key: string,
    ids: string[],
    now: number,
    minMs: number,
    maxMs: number,
  ): void {
    if (this.scheduleKey === key) return;
    this.scheduleKey = key;
    this.dueAt = {};
    for (const id of ids) this.dueAt[id] = now + minMs + Math.random() * (maxMs - minMs);
  }
}
