import type { ClientMessage, RoomInfo, ServerMessage } from '../shared/protocol.js';
import type { CardType } from '../engine/types.js';
import type { MatchView } from '../engine/game.js';

/**
 * The connection to the real server. It mirrors LocalMatch's shape, so the
 * screen code does not care whether it is playing bots offline or people online.
 */
export class Net {
  socket: WebSocket | null = null;
  playerId = '';
  name = '';
  room: RoomInfo | null = null;
  view: MatchView | null = null;

  private serverNow = 0;
  private stampedAt = 0;
  private reconnectTimer: number | undefined;
  private wantOpen = false;

  onRoom: (room: RoomInfo) => void = () => {};
  onView: () => void = () => {};
  onNotice: (message: string) => void = () => {};
  onWelcome: () => void = () => {};
  onLeft: () => void = () => {};
  onStatus: (connected: boolean) => void = () => {};

  get humanId(): string {
    return this.playerId;
  }

  /**
   * Per-tab, not per-browser. sessionStorage survives a refresh (so a dropped
   * signal puts you back in your seat) but is not shared between tabs, so two
   * tabs on one machine are two different players. That is what makes local
   * multiplayer testing possible.
   */
  private get token(): string | null {
    return sessionStorage.getItem('hitman.token');
  }

  connect(name: string): void {
    this.name = name;
    this.wantOpen = true;
    this.open();
  }

  private open(): void {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${scheme}://${location.host}/ws`);
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.onStatus(true);
      const token = this.token;
      this.send({ t: 'hello', name: this.name, ...(token ? { token } : {}) });
    });

    socket.addEventListener('message', (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(String(ev.data)) as ServerMessage;
      } catch {
        return;
      }
      this.handle(msg);
    });

    socket.addEventListener('close', () => {
      this.onStatus(false);
      if (!this.wantOpen) return;
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = window.setTimeout(() => this.open(), 1500);
    });
  }

  disconnect(): void {
    this.wantOpen = false;
    window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
    this.room = null;
    this.view = null;
  }

  private handle(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.name = msg.name;
        sessionStorage.setItem('hitman.token', msg.token);
        this.onWelcome();
        return;
      case 'room':
        this.room = msg.room;
        this.onRoom(msg.room);
        return;
      case 'view':
        this.view = msg.view as MatchView;
        this.serverNow = msg.serverNow;
        this.stampedAt = Date.now();
        this.onView();
        return;
      case 'left':
        this.room = null;
        this.view = null;
        this.onLeft();
        return;
      case 'notice':
        this.onNotice(msg.message);
        return;
    }
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === 1) this.socket.send(JSON.stringify(message));
  }

  /** The match clock, carried forward locally between server updates. */
  nowMs(): number {
    if (!this.stampedAt) return 0;
    return this.serverNow + (Date.now() - this.stampedAt);
  }

  // ------------------------------------------------------- the same four moves

  play(cardId: string, args: { targetPlayerId?: string; lockType?: string } = {}): void {
    this.send({
      t: 'play',
      cardId,
      targetPlayerId: args.targetPlayerId,
      lockType: args.lockType as CardType | undefined,
    });
  }

  draw(): void {
    this.send({ t: 'draw' });
  }

  pass(): void {
    this.send({ t: 'pass' });
  }

  choose(choice: string): void {
    this.send({ t: 'choose', choice });
  }
}
