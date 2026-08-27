import { describe, it, expect, beforeEach } from 'vitest';
import { Room, RoomManager, type Client } from './room.js';
import { BALANCE } from '../config/balance.js';
import type { ServerMessage } from '../shared/protocol.js';

class FakeClient implements Client {
  connected = true;
  inbox: ServerMessage[] = [];
  constructor(
    readonly playerId: string,
    public name: string,
  ) {}
  send(message: ServerMessage): void {
    this.inbox.push(message);
  }
  lastRoom() {
    const rooms = this.inbox.filter((m) => m.t === 'room');
    return rooms[rooms.length - 1] as Extract<ServerMessage, { t: 'room' }> | undefined;
  }
  lastView() {
    const views = this.inbox.filter((m) => m.t === 'view');
    return views[views.length - 1] as Extract<ServerMessage, { t: 'view' }> | undefined;
  }
}

let manager: RoomManager;
let host: FakeClient;
let guest: FakeClient;

beforeEach(() => {
  manager = new RoomManager();
  host = new FakeClient('h1', 'MRK');
  guest = new FakeClient('g1', 'FRIEND');
});

describe('Private rooms', () => {
  it('gives every new room a 4-character invite code', () => {
    const room = manager.create(host);
    expect(room.code).toHaveLength(4);
    expect(room.code).toMatch(/^[A-Z2-9]{4}$/);
  });

  it('never uses letters that look like numbers in a code', () => {
    for (let i = 0; i < 200; i++) {
      const m = new RoomManager();
      expect(m.create(new FakeClient(`p${i}`, 'X')).code).not.toMatch(/[O0I1]/);
    }
  });

  it('gives two rooms different codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 200; i++) codes.add(manager.create(new FakeClient(`p${i}`, 'X')).code);
    expect(codes.size).toBe(200);
  });

  it('lets a friend in with the code, in any case they type it', () => {
    const room = manager.create(host);
    manager.join(room.code.toLowerCase(), guest);
    expect(room.seats.map((s) => s.name)).toEqual(['MRK', 'FRIEND']);
  });

  it('refuses a code that does not exist', () => {
    expect(() => manager.join('ZZZZ', guest)).toThrow();
  });

  it('tells everyone in the room when somebody joins', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    expect(host.lastRoom()?.room.seats).toHaveLength(2);
    expect(guest.lastRoom()?.room.code).toBe(room.code);
  });

  it('makes the first person the host', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    expect(room.info().seats.find((s) => s.isHost)?.id).toBe('h1');
  });

  it('hands the room over if the host walks out before the match', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    room.leave('h1');
    expect(room.hostId).toBe('g1');
  });

  it('forgets a room once everyone has gone', () => {
    const room = manager.create(host);
    room.leave('h1');
    manager.tick();
    expect(manager.find(room.code)).toBeUndefined();
  });
});

describe('Filling seats with bots', () => {
  it('lets the host add one', () => {
    const room = manager.create(host);
    room.addBot('h1');
    expect(room.seats.filter((s) => s.isBot)).toHaveLength(1);
  });

  it('does not let a guest add one', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    expect(() => room.addBot('g1')).toThrow();
  });

  it('stops at the table limit', () => {
    const room = manager.create(host);
    for (let i = 0; i < BALANCE.maxPlayers - 1; i++) room.addBot('h1');
    expect(room.seats).toHaveLength(BALANCE.maxPlayers);
    expect(() => room.addBot('h1')).toThrow();
  });

  it('gives every bot a different name', () => {
    const room = manager.create(host);
    for (let i = 0; i < 8; i++) room.addBot('h1');
    const names = room.seats.filter((s) => s.isBot).map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('lets the host clear a seat, but never their own', () => {
    const room = manager.create(host);
    room.addBot('h1');
    const botId = room.seats[1].id;
    room.removeSeat('h1', botId);
    expect(room.seats).toHaveLength(1);
    expect(() => room.removeSeat('h1', 'h1')).toThrow();
  });
});

describe('Starting a match', () => {
  it('needs at least two at the table', () => {
    const room = manager.create(host);
    expect(() => room.start('h1')).toThrow();
    room.addBot('h1');
    room.start('h1');
    expect(room.phase).toBe('playing');
  });

  it('can only be done by the host', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    expect(() => room.start('g1')).toThrow();
  });

  it('locks the door once it has started', () => {
    const room = manager.create(host);
    room.addBot('h1');
    room.start('h1');
    expect(() => manager.join(room.code, guest)).toThrow();
  });

  it('sends each player only their own hand', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    room.start('h1');

    const hostView = host.lastView()!.view as { you: { hand: { id: string }[] } };
    const guestView = guest.lastView()!.view as { you: { hand: { id: string }[] } };
    const guestCardIds = guestView.you.hand.map((c) => c.id);

    expect(hostView.you.hand.length).toBe(BALANCE.startingHandSize + 1);
    const hostSees = JSON.stringify(hostView);
    for (const id of guestCardIds) expect(hostSees).not.toContain(id);
  });

  it('never sends the deck order to anybody', () => {
    const room = manager.create(host);
    room.addBot('h1');
    room.start('h1');
    const seen = JSON.stringify(host.lastView()!.view);
    for (const card of room.game!.state.deck) expect(seen).not.toContain(card.id);
  });
});

describe('The server does not trust the client', () => {
  it('refuses a move made by somebody whose turn it is not', () => {
    const room = manager.create(host);
    manager.join(room.code, guest);
    room.start('h1');
    const notCurrent = room.game!.currentPlayerId() === 'h1' ? 'g1' : 'h1';
    expect(() => room.action(notCurrent, (g) => g.draw(notCurrent))).toThrow();
  });

  it('refuses a card the player is not holding', () => {
    const room = manager.create(host);
    room.addBot('h1');
    room.start('h1');
    expect(() => room.action('h1', (g) => g.play('h1', 'made-up-card'))).toThrow();
  });

  it('refuses any move at all before the match starts', () => {
    const room = manager.create(host);
    expect(() => room.action('h1', (g) => g.draw('h1'))).toThrow();
  });
});

describe('Losing your connection', () => {
  function startedRoom() {
    const room = manager.create(host);
    manager.join(room.code, guest);
    room.addBot('h1');
    room.start('h1');
    return room;
  }

  it('keeps your seat and your hand while you are away', () => {
    const room = startedRoom();
    const before = room.game!.player('g1').hand.length;
    room.markDisconnected('g1');
    expect(room.game!.player('g1').alive).toBe(true);
    expect(room.game!.player('g1').hand.length).toBe(before);
  });

  it('shows the rest of the table that you have dropped', () => {
    const room = startedRoom();
    room.markDisconnected('g1');
    const seat = host.lastRoom()!.room.seats.find((s) => s.id === 'g1');
    expect(seat?.connected).toBe(false);
  });

  it('does not stop the match while you are gone', () => {
    const room = startedRoom();
    room.markDisconnected('g1');
    room.tick();
    expect(room.phase).toBe('playing');
    expect(room.game!.state.phase).toBe('playing');
  });

  it('puts you straight back in your seat when you reconnect', () => {
    const room = startedRoom();
    const handBefore = room.game!.player('g1').hand.map((c) => c.id);
    room.markDisconnected('g1');
    const returning = new FakeClient('g1', 'FRIEND');
    room.join(returning);
    expect(room.game!.player('g1').hand.map((c) => c.id)).toEqual(handBefore);
    expect(returning.lastView()).toBeDefined();
  });

  it('forfeits you once the grace period has run out', () => {
    const room = startedRoom();
    room.markDisconnected('g1');
    // Wind the match clock past the grace period.
    room.game!.setNow(BALANCE.disconnectGraceSeconds * 1000 + 5000);
    (room as unknown as { startedAt: number }).startedAt =
      Date.now() - BALANCE.disconnectGraceSeconds * 1000 - 5000;
    room.tick();
    expect(room.game!.player('g1').alive).toBe(false);
  });

  it('treats walking out mid-match as a forfeit, not a pause', () => {
    const room = startedRoom();
    room.leave('g1');
    expect(room.game!.player('g1').alive).toBe(false);
    expect(room.phase).toBe('playing');
  });
});

describe('A whole networked match', () => {
  it('runs from start to a winner with bots filling the seats', () => {
    const room = new Room('TEST', host);
    for (let i = 0; i < 4; i++) room.addBot('h1');
    room.start('h1');

    // The human never acts, so their turn timer draws for them every time.
    const started = Date.now();
    for (let i = 0; i < 4000 && room.game!.state.phase === 'playing'; i++) {
      (room as unknown as { startedAt: number }).startedAt = started - i * 400;
      room.tick();
    }
    expect(room.game!.state.phase).toBe('ended');
    expect(room.game!.alivePlayers()).toHaveLength(1);
    expect(room.phase).toBe('ended');
  });
});
