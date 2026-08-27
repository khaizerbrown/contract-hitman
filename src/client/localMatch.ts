import { Game, type MatchView } from '../engine/game.js';
import { Bot, BOT_NAMES } from '../bots/bot.js';
import { BotRunner } from '../bots/botRunner.js';

/**
 * A match against bots, run entirely inside the browser. No server involved.
 *
 * It exposes the same handful of moves the networked driver does, so the screen
 * code never needs to know which one it is talking to.
 */
export class LocalMatch {
  readonly game: Game;
  readonly humanId = 'you';
  readonly bots: Bot[];

  private startedAt = Date.now();
  private runner: BotRunner;

  constructor(humanName: string, botCount: number) {
    this.bots = BOT_NAMES.slice(0, botCount).map((n, i) => new Bot(`bot${i}`, n));
    this.game = Game.create({
      players: [
        { id: this.humanId, name: humanName || 'YOU' },
        ...this.bots.map((b) => ({ id: b.id, name: b.name })),
      ],
      seed: Math.floor(Math.random() * 1e9),
    });
    this.runner = new BotRunner(this.game, this.bots);
  }

  get view(): MatchView {
    return this.game.viewFor(this.humanId);
  }

  /** Milliseconds since this match began. The engine's clock. */
  nowMs(): number {
    return Date.now() - this.startedAt;
  }

  tick(): void {
    const now = this.nowMs();
    this.game.setNow(now);
    this.game.checkTimers();
    this.runner.tick(now);
  }

  // ---------------------------------------------------------- the four moves

  play(cardId: string, args: { targetPlayerId?: string } = {}): void {
    this.game.setNow(this.nowMs());
    this.game.play(this.humanId, cardId, args as never);
  }

  draw(): void {
    this.game.setNow(this.nowMs());
    this.game.draw(this.humanId);
  }

  pass(): void {
    this.game.setNow(this.nowMs());
    this.game.pass(this.humanId);
  }

  choose(choice: string): void {
    this.game.setNow(this.nowMs());
    this.game.choose(this.humanId, choice);
  }
}
