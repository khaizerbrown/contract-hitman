import { BALANCE, type Balance } from '../config/balance.js';
import { Game, GameError } from '../engine/game.js';
import { Bot, BOT_NAMES } from '../bots/bot.js';
import { BotRunner } from '../bots/botRunner.js';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type RoomInfo,
  type ServerMessage,
} from '../shared/protocol.js';

/** Anything that can receive messages. The tests use a fake, the server uses a socket. */
export interface Client {
  readonly playerId: string;
  name: string;
  connected: boolean;
  send(message: ServerMessage): void;
}

interface Seat {
  id: string;
  name: string;
  isBot: boolean;
  client: Client | null;
  /** Match clock reading when their connection dropped, or null while present. */
  droppedAt: number | null;
}

export class Room {
  readonly code: string;
  hostId: string;
  phase: 'lobby' | 'playing' | 'ended' = 'lobby';
  seats: Seat[] = [];
  game: Game | null = null;

  private bots: Bot[] = [];
  private runner: BotRunner | null = null;
  private startedAt = 0;
  private lastBroadcast = 0;
  private lastSignature = '';

  constructor(
    code: string,
    host: Client,
    readonly balance: Balance = BALANCE,
  ) {
    this.code = code;
    this.hostId = host.playerId;
    this.seats.push({
      id: host.playerId,
      name: host.name,
      isBot: false,
      client: host,
      droppedAt: null,
    });
  }

  // ------------------------------------------------------------------- lobby

  get humanSeats(): Seat[] {
    return this.seats.filter((s) => !s.isBot);
  }

  /**
   * A room is only finished with once nobody is coming back to it.
   *
   * While a match is running, a human whose signal has dropped still counts as
   * present until their grace period runs out. Without this, a table with one
   * human and some bots is destroyed the moment that person's phone locks.
   */
  get isEmpty(): boolean {
    const humans = this.humanSeats;
    if (humans.some((s) => s.client !== null)) return false;
    if (this.phase !== 'playing') return true;
    const graceMs = this.balance.disconnectGraceSeconds * 1000;
    const now = this.now();
    return !humans.some((s) => s.droppedAt !== null && now - s.droppedAt < graceMs);
  }

  info(): RoomInfo {
    return {
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      maxSeats: this.balance.maxPlayers,
      seats: this.seats.map((s) => ({
        id: s.id,
        name: s.name,
        isBot: s.isBot,
        connected: s.isBot || s.client !== null,
        isHost: s.id === this.hostId,
      })),
    };
  }

  join(client: Client): void {
    const existing = this.seats.find((s) => s.id === client.playerId);
    if (existing) {
      // Reconnect: the seat and the hand are still here waiting.
      existing.client = client;
      existing.droppedAt = null;
      existing.name = client.name;
      this.pushRoom();
      this.pushViews(true);
      return;
    }
    if (this.phase !== 'lobby') {
      throw new GameError('That match has already started.');
    }
    if (this.seats.length >= this.balance.maxPlayers) {
      throw new GameError('That room is full.');
    }
    this.seats.push({
      id: client.playerId,
      name: client.name,
      isBot: false,
      client,
      droppedAt: null,
    });
    this.pushRoom();
  }

  addBot(byPlayerId: string): void {
    this.assertHost(byPlayerId);
    if (this.phase !== 'lobby') throw new GameError('The match has already started.');
    if (this.seats.length >= this.balance.maxPlayers) throw new GameError('The room is full.');
    const taken = new Set(this.seats.map((s) => s.name));
    const name = BOT_NAMES.find((n) => !taken.has(n)) ?? `BOT${this.seats.length}`;
    this.seats.push({
      id: `bot-${this.code}-${this.seats.length}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      isBot: true,
      client: null,
      droppedAt: null,
    });
    this.pushRoom();
  }

  removeSeat(byPlayerId: string, seatId: string): void {
    this.assertHost(byPlayerId);
    if (this.phase !== 'lobby') throw new GameError('The match has already started.');
    if (seatId === this.hostId) throw new GameError('The host cannot be removed.');
    const seat = this.seats.find((s) => s.id === seatId);
    if (seat?.client) seat.client.send({ t: 'left' });
    this.seats = this.seats.filter((s) => s.id !== seatId);
    this.pushRoom();
  }

  /** Someone chose to walk out, rather than dropping connection. */
  leave(playerId: string): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    if (this.phase === 'playing' && this.game) {
      seat.client = null;
      this.game.forfeit(playerId);
      this.pushRoom();
      this.pushViews(true);
      return;
    }
    this.seats = this.seats.filter((s) => s.id !== playerId);
    if (playerId === this.hostId) {
      const nextHuman = this.humanSeats.find((s) => s.client !== null);
      if (nextHuman) this.hostId = nextHuman.id;
    }
    this.pushRoom();
  }

  /** The socket dropped. They keep their seat and their hand for the grace period. */
  markDisconnected(playerId: string): void {
    const seat = this.seats.find((s) => s.id === playerId);
    if (!seat) return;
    seat.client = null;
    if (this.phase === 'playing') {
      seat.droppedAt = this.now();
    } else {
      this.leave(playerId);
      return;
    }
    this.pushRoom();
  }

  start(byPlayerId: string): void {
    this.assertHost(byPlayerId);
    if (this.phase !== 'lobby') throw new GameError('The match has already started.');
    if (this.seats.length < this.balance.minPlayers) {
      throw new GameError(`You need at least ${this.balance.minPlayers} at the table.`);
    }
    this.bots = this.seats.filter((s) => s.isBot).map((s) => new Bot(s.id, s.name));
    this.game = Game.create({
      id: this.code,
      players: this.seats.map((s) => ({ id: s.id, name: s.name })),
      seed: Math.floor(Math.random() * 1e9),
      balance: this.balance,
    });
    this.runner = new BotRunner(this.game, this.bots);
    this.startedAt = Date.now();
    this.phase = 'playing';
    this.pushRoom();
    this.pushViews(true);
  }

  // ------------------------------------------------------------------ in play

  private now(): number {
    return Date.now() - this.startedAt;
  }

  /** Called on the server tick. */
  tick(): void {
    if (this.phase !== 'playing' || !this.game) return;
    const now = this.now();
    this.game.setNow(now);
    this.game.checkTimers();
    this.runner?.tick(now);
    this.dropTheLost(now);

    if (this.game.state.phase === 'ended') {
      this.phase = 'ended';
      this.pushRoom();
    }
    this.pushViews(false);
  }

  /** Anyone gone longer than the grace period forfeits. The table never waits. */
  private dropTheLost(now: number): void {
    if (!this.game) return;
    const graceMs = this.balance.disconnectGraceSeconds * 1000;
    for (const seat of this.seats) {
      if (seat.isBot || seat.droppedAt === null) continue;
      if (now - seat.droppedAt < graceMs) continue;
      seat.droppedAt = null;
      if (this.game.player(seat.id).alive) this.game.forfeit(seat.id);
    }
  }

  action(playerId: string, fn: (game: Game) => void): void {
    if (this.phase !== 'playing' || !this.game) throw new GameError('No match is running.');
    this.game.setNow(this.now());
    fn(this.game);
    this.pushViews(true);
  }

  // ---------------------------------------------------------------- messaging

  pushRoom(): void {
    const info = this.info();
    for (const seat of this.seats) seat.client?.send({ t: 'room', room: info });
  }

  private signature(): string {
    const g = this.game;
    if (!g) return '';
    const s = g.state;
    return [
      s.phase,
      s.log.length,
      s.currentIndex,
      s.currentTurnsRemaining,
      s.pending?.kind ?? '-',
      s.pending && 'responded' in s.pending ? s.pending.responded.join(',') : '',
      s.players.map((p) => `${p.hand.length}${p.alive ? 'a' : 'd'}`).join('|'),
      s.deck.length,
    ].join('~');
  }

  /** Send each human their own redacted view. Never the whole state. */
  pushViews(force: boolean): void {
    if (!this.game) return;
    const sig = this.signature();
    const stale = Date.now() - this.lastBroadcast > 1000;
    if (!force && !stale && sig === this.lastSignature) return;
    this.lastSignature = sig;
    this.lastBroadcast = Date.now();
    const serverNow = this.now();
    for (const seat of this.seats) {
      if (!seat.client) continue;
      seat.client.send({ t: 'view', view: this.game.viewFor(seat.id), serverNow });
    }
  }

  private assertHost(playerId: string): void {
    if (playerId !== this.hostId) throw new GameError('Only the host can do that.');
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  constructor(private readonly balance: Balance = BALANCE) {}

  get size(): number {
    return this.rooms.size;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 500; attempt++) {
      let code = '';
      for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError('Could not find a free room code. Try again.');
  }

  create(host: Client): Room {
    const room = new Room(this.freshCode(), host, this.balance);
    this.rooms.set(room.code, room);
    room.pushRoom();
    return room;
  }

  join(code: string, client: Client): Room {
    const room = this.rooms.get(code.toUpperCase().trim());
    if (!room) throw new GameError('No room with that code.');
    room.join(client);
    return room;
  }

  find(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase().trim());
  }

  roomOf(playerId: string): Room | undefined {
    for (const room of this.rooms.values()) {
      if (room.seats.some((s) => s.id === playerId)) return room;
    }
    return undefined;
  }

  /** Runs every tick: advance every match, and clear out rooms nobody is in. */
  tick(): void {
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.isEmpty) this.rooms.delete(code);
    }
  }
}
