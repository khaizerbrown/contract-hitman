import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

import { GameError } from '../engine/game.js';
import { RoomManager, type Client } from './room.js';
import type { ClientMessage, ServerMessage } from '../shared/protocol.js';

const PORT = Number(process.env.PORT ?? 8787);
const DIST = resolve(process.cwd(), 'dist');
const TICK_MS = 100;

/** Guest identities, remembered only for as long as the server is up. */
interface Identity {
  playerId: string;
  name: string;
}
const identities = new Map<string, Identity>();

const rooms = new RoomManager();

// ------------------------------------------------------------- static files

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
    return;
  }
  if (!existsSync(DIST)) {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Game server is running. Run "npm run build" to produce the web files.');
    return;
  }
  const raw = (req.url ?? '/').split('?')[0];
  const wanted = raw === '/' ? '/index.html' : raw;
  const path = join(DIST, normalize(wanted).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(DIST) || !existsSync(path)) {
    // Anything unknown falls back to the app itself.
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(await readFile(join(DIST, 'index.html')));
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
  res.end(await readFile(path));
}

const http = createServer((req, res) => {
  serveStatic(req, res).catch(() => {
    res.writeHead(500);
    res.end('error');
  });
});

// ---------------------------------------------------------------- websockets

const wss = new WebSocketServer({ server: http, path: '/ws' });

class SocketClient implements Client {
  connected = true;
  constructor(
    readonly playerId: string,
    public name: string,
    private readonly socket: WebSocket,
  ) {}

  send(message: ServerMessage): void {
    if (this.socket.readyState === 1) this.socket.send(JSON.stringify(message));
  }
}

function cleanName(raw: unknown): string {
  const name = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 _-]/g, '')
    .trim()
    .slice(0, 12);
  return name || 'GUEST';
}

wss.on('connection', (socket) => {
  let client: SocketClient | null = null;

  const fail = (message: string) =>
    socket.readyState === 1 && socket.send(JSON.stringify({ t: 'notice', message }));

  socket.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(String(raw)) as ClientMessage;
    } catch {
      return fail('Could not read that message.');
    }

    try {
      if (msg.t === 'hello') {
        const token = msg.token && identities.has(msg.token) ? msg.token : randomUUID();
        const identity = identities.get(token) ?? { playerId: randomUUID(), name: cleanName(msg.name) };
        identity.name = cleanName(msg.name);
        identities.set(token, identity);
        client = new SocketClient(identity.playerId, identity.name, socket);
        client.send({ t: 'welcome', playerId: identity.playerId, token, name: identity.name });
        // If they were in a match when their signal died, put them straight back.
        const existing = rooms.roomOf(identity.playerId);
        if (existing) existing.join(client);
        return;
      }

      if (!client) return fail('Say hello first.');
      const me = client;

      switch (msg.t) {
        case 'createRoom':
          rooms.create(me);
          return;
        case 'joinRoom':
          rooms.join(msg.code, me);
          return;
        case 'leaveRoom': {
          rooms.roomOf(me.playerId)?.leave(me.playerId);
          me.send({ t: 'left' });
          return;
        }
        case 'addBot':
          requireRoom(me).addBot(me.playerId);
          return;
        case 'removeSeat':
          requireRoom(me).removeSeat(me.playerId, msg.seatId);
          return;
        case 'startMatch':
          requireRoom(me).start(me.playerId);
          return;
        case 'play':
          requireRoom(me).action(me.playerId, (g) =>
            g.play(me.playerId, msg.cardId, { targetPlayerId: msg.targetPlayerId }),
          );
          return;
        case 'draw':
          requireRoom(me).action(me.playerId, (g) => g.draw(me.playerId));
          return;
        case 'pass':
          requireRoom(me).action(me.playerId, (g) => g.pass(me.playerId));
          return;
        case 'choose':
          requireRoom(me).action(me.playerId, (g) => g.choose(me.playerId, msg.choice));
          return;
        default:
          return fail('Unknown request.');
      }
    } catch (err) {
      fail(err instanceof GameError ? err.message : 'That move is not allowed.');
    }
  });

  socket.on('close', () => {
    if (client) rooms.roomOf(client.playerId)?.markDisconnected(client.playerId);
  });
  socket.on('error', () => socket.close());
});

function requireRoom(client: Client) {
  const room = rooms.roomOf(client.playerId);
  if (!room) throw new GameError('You are not in a room.');
  return room;
}

setInterval(() => rooms.tick(), TICK_MS);

http.listen(PORT, () => {
  console.log(`CONTRACT // HITMAN server listening on port ${PORT}`);
});
