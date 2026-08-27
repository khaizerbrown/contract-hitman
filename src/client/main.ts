import { LocalMatch } from './localMatch.js';
import { Net } from './net.js';
import { CARD_INFO, CARD_KIND, CARD_MARK, CARD_NUMBER } from './cardInfo.js';
import { loadSoundPreference, setSoundOn, sound, soundIsOn, wakeAudio } from './sound.js';
import { cardFileHtml } from './cardFile.js';
import { GameError, type MatchView } from '../engine/game.js';
import { BALANCE } from '../config/balance.js';
import { buildBaseDeck, hitmanCount } from '../engine/deck.js';
import type { CardType, LogEntry } from '../engine/types.js';
import type { RoomInfo } from '../shared/protocol.js';

/**
 * Anything that can run a match. Offline against bots, or online against people
 * with the server deciding everything - the screen treats them identically.
 */
interface Driver {
  readonly humanId: string;
  readonly view: MatchView | null;
  nowMs(): number;
  tick?(): void;
  play(cardId: string, args?: { targetPlayerId?: string }): void;
  draw(): void;
  pass(): void;
  choose(choice: string): void;
}

let driver: Driver | null = null;
let online = false;
let armedCard: { id: string; type: CardType } | null = null;
let lastSignature = '';
/** How many Peek results have been read and waved away. */
let peeksDismissed = 0;
/** Walking out mid-match forfeits, so it takes two taps. */
let leaveArmed = false;
let leaveTimer: number | undefined;
let toastTimer: number | undefined;

const net = new Net();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

loadSoundPreference();
// Browsers will not make a sound until the player has touched the page.
document.addEventListener('pointerdown', () => wakeAudio(), { once: true });
const meId = () => driver?.humanId ?? '';

// ============================================================== setup screen

const botSlider = $<HTMLInputElement>('botCount');

function updateSetupStats(): void {
  const bots = Number(botSlider.value);
  const players = bots + 1;
  $('botCountLabel').textContent = String(bots);
  const drawPile =
    buildBaseDeck(players).length - players * BALANCE.startingHandSize + hitmanCount(players);
  const density = ((hitmanCount(players) / drawPile) * 100).toFixed(1);
  $('setupStats').innerHTML = `
    <div>PLAYERS AT THE TABLE <b>${players}</b></div>
    <div>HITMAN CARDS IN THE DECK <b>${hitmanCount(players)}</b></div>
    <div>CARDS TO DRAW FROM <b>${drawPile}</b></div>
    <div>OPENING DANGER <b>${density}%</b></div>`;
}

botSlider.addEventListener('input', updateSetupStats);
updateSetupStats();

function typedName(): string {
  return ($<HTMLInputElement>('playerName').value || 'YOU').toUpperCase().slice(0, 12);
}

function showScreen(which: 'setup' | 'lobby' | 'match'): void {
  for (const id of ['setup', 'lobby', 'match']) {
    $(id).classList.toggle('hidden', id !== which);
  }
}

// --------------------------------------------------------------- offline play

$('startBtn').addEventListener('click', () => {
  online = false;
  driver = new LocalMatch(typedName(), Number(botSlider.value));
  armedCard = null;
  peeksDismissed = 0;
  deckAtStart = 0;
  beatsShown = 0;
  lastSignature = '';
  showScreen('match');
  startLoop();
});

// ---------------------------------------------------------------- online play

let intent: 'create' | { join: string } | null = null;

function goOnline(what: 'create' | { join: string }): void {
  intent = what;
  online = true;
  sessionStorage.setItem('hitman.name', typedName());
  $('netStatus').textContent = 'Connecting…';
  // Having a player id is not the same as having a live socket - a dropped or
  // abandoned connection leaves the id behind. Ask the socket itself.
  if (net.isConnected) {
    actOnIntent();
  } else {
    net.connect(typedName());
  }
}

function actOnIntent(): void {
  if (!intent) return;
  const sent =
    intent === 'create'
      ? net.send({ t: 'createRoom' })
      : net.send({ t: 'joinRoom', code: intent.join });
  if (!sent) {
    // Never fail in silence. Say so and try the connection again.
    $('netStatus').textContent = 'Lost the connection. Trying again…';
    net.connect(typedName());
    return;
  }
  intent = null;
}

$('createRoomBtn').addEventListener('click', () => goOnline('create'));

$('joinRoomBtn').addEventListener('click', () => {
  const code = $<HTMLInputElement>('joinCode').value.toUpperCase().trim();
  if (code.length !== 4) return toast('An invite code is 4 characters.');
  goOnline({ join: code });
});

net.onWelcome = () => {
  $('netStatus').textContent = 'Connected.';
  actOnIntent();
};

net.onNotice = (message) => {
  toast(message);
  $('netStatus').textContent = message;
};

net.onStatus = (connected) => {
  const banner = $('netBanner');
  banner.classList.toggle('hidden', connected);
  banner.textContent = 'CONNECTION LOST — TRYING TO GET YOU BACK IN';
};

net.onLeft = () => {
  driver = null;
  online = false;
  sessionStorage.removeItem('hitman.name');
  net.disconnect();
  showScreen('setup');
  $('netStatus').textContent = 'Left the table.';
};

net.onRoom = (room) => {
  renderLobby(room);
  if (room.phase === 'lobby') {
    showScreen('lobby');
  } else {
    if (!driver) {
      driver = net;
      lastSignature = '';
      deckAtStart = 0;
      beatsShown = 0;
      startLoop();
    }
    showScreen('match');
  }
};

net.onView = () => {
  if (!driver) {
    driver = net;
    startLoop();
    showScreen('match');
  }
  renderIfChanged();
};

// -------------------------------------------------------------------- lobby

function renderLobby(room: RoomInfo): void {
  $('roomCode').textContent = room.code;
  const isHost = room.hostId === net.playerId;

  $('seats').innerHTML = room.seats
    .map((s) => {
      const classes = ['seat'];
      if (s.isBot) classes.push('bot');
      else if (!s.connected) classes.push('away');
      const role = s.isHost ? 'HOST' : s.isBot ? 'BOT' : s.connected ? '' : 'AWAY';
      const kick =
        isHost && !s.isHost ? `<button class="kick" data-kick="${s.id}">&times;</button>` : '';
      return `<div class="${classes.join(' ')}">
        <span class="dot"></span>
        <span class="who">${s.name}${s.id === net.playerId ? ' (you)' : ''}</span>
        <span class="role">${role}</span>
        ${kick}
      </div>`;
    })
    .join('');

  const seats = room.seats.length;
  $<HTMLButtonElement>('addBotBtn').disabled = !isHost || seats >= room.maxSeats;
  $<HTMLButtonElement>('startMatchBtn').disabled = !isHost || seats < 2;
  $('lobbyHint').textContent = isHost
    ? seats < 2
      ? 'Send the code to a friend, or add a bot to fill the seat.'
      : `${seats} at the table. Start when you are ready.`
    : 'Waiting for the host to start.';
}

$('addBotBtn').addEventListener('click', () => net.send({ t: 'addBot' }));
$('startMatchBtn').addEventListener('click', () => net.send({ t: 'startMatch' }));
$('leaveRoomBtn').addEventListener('click', () => net.send({ t: 'leaveRoom' }));

function paintSoundButton(): void {
  const btn = $('soundBtn');
  btn.textContent = soundIsOn() ? 'SOUND' : 'MUTED';
  btn.classList.toggle('off', !soundIsOn());
}
paintSoundButton();

$('soundBtn').addEventListener('click', () => {
  setSoundOn(!soundIsOn());
  paintSoundButton();
  if (soundIsOn()) sound('play');
});

// ------------------------------------------------------------- the card file

function openCardFile(): void {
  // Counts are worth showing for the table you are actually about to sit at.
  const players = net.room ? net.room.seats.length : Number(botSlider.value) + 1;
  const el = $('cardFile');
  el.innerHTML = cardFileHtml(players);
  el.classList.remove('hidden');
  el.scrollTop = 0;
}

function closeCardFile(): void {
  $('cardFile').classList.add('hidden');
  $('cardFile').innerHTML = '';
}

$('cardFileBtn').addEventListener('click', openCardFile);
$('cardFileBtn2').addEventListener('click', openCardFile);
document.addEventListener('click', (ev) => {
  const el = ev.target as HTMLElement;
  if (el?.id === 'closeFile' || el?.id === 'cardFile') closeCardFile();
});
document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeCardFile();
});

$('leaveMatchBtn').addEventListener('click', () => {
  const btn = $('leaveMatchBtn');
  if (!leaveArmed) {
    leaveArmed = true;
    btn.classList.add('armed');
    btn.textContent = 'FORFEIT?';
    window.clearTimeout(leaveTimer);
    leaveTimer = window.setTimeout(() => {
      leaveArmed = false;
      btn.classList.remove('armed');
      btn.textContent = 'LEAVE';
    }, 4000);
    return;
  }
  window.clearTimeout(leaveTimer);
  leaveArmed = false;
  btn.classList.remove('armed');
  btn.textContent = 'LEAVE';
  if (online) {
    net.send({ t: 'leaveRoom' });
  } else {
    driver = null;
    armedCard = null;
    showScreen('setup');
  }
});

$('copyCode').addEventListener('click', () => {
  const code = $('roomCode').textContent ?? '';
  const link = `${location.origin}/?room=${code}`;
  navigator.clipboard?.writeText(link).then(
    () => toast('Link copied. Send it to whoever you want at the table.'),
    () => toast(`Share this code: ${code}`),
  );
});

// A link with a code in it drops you straight onto the join box.
const codeFromUrl = new URLSearchParams(location.search).get('room');
if (codeFromUrl) {
  $<HTMLInputElement>('joinCode').value = codeFromUrl.toUpperCase().slice(0, 4);
  $('netStatus').textContent = 'Invite code filled in. Put a name in and hit JOIN.';
}

/**
 * If this tab was already in a match - phone locked, browser reloaded, signal
 * came back - reopen the connection straight away. The server still holds the
 * seat, so it puts them back with no code to retype.
 */
const returningName = sessionStorage.getItem('hitman.name');
if (sessionStorage.getItem('hitman.token') && returningName) {
  online = true;
  $<HTMLInputElement>('playerName').value = returningName;
  $('netStatus').textContent = 'Looking for the table you were at…';
  net.connect(returningName);
  // If nothing comes back, that table has broken up. Say so and let go of it.
  window.setTimeout(() => {
    // Leave it alone if it found the table, or if the player is now using this
    // connection to create or join one.
    if (net.room || intent) return;
    online = false;
    sessionStorage.removeItem('hitman.name');
    $('netStatus').textContent = 'That table has closed. Create or join one.';
  }, 4000);
}

// ============================================================== the main loop

// A timer, not requestAnimationFrame: the match must keep running even when the
// tab is not the one being looked at.
let loopHandle: number | undefined;

function startLoop(): void {
  window.clearInterval(loopHandle);
  loopHandle = window.setInterval(loop, 60);
}

function loop(): void {
  if (!driver) {
    window.clearInterval(loopHandle);
    return;
  }
  driver.tick?.();
  renderClock();
  renderIfChanged();
}

function clockNow(): { left: number; total: number; label: string } {
  const v = driver?.view;
  const now = driver?.nowMs() ?? 0;
  if (!v) return { left: 0, total: 1, label: 'TURN' };
  if (v.pending) {
    const total =
      v.pending.kind === 'quickWindow' ? BALANCE.quickWindowSeconds : BALANCE.choiceSeconds;
    return {
      left: Math.max(0, ((v.pending as { deadline: number }).deadline - now) / 1000),
      total,
      label: v.pending.kind === 'quickWindow' ? 'REACT' : 'CHOOSE',
    };
  }
  return {
    left: Math.max(0, (v.turnDeadline - now) / 1000),
    total: BALANCE.turnSeconds,
    label: 'TURN',
  };
}

function renderClock(): void {
  const { left, total, label } = clockNow();
  const pct = Math.max(0, Math.min(100, (left / total) * 100));
  $('clockFill').style.width = `${pct}%`;
  $('clockNum').textContent = String(Math.ceil(left));
  $('clockLabel').textContent = label;
  $('clock').classList.toggle('urgent', pct < 34);

  const bar = document.querySelector<HTMLElement>('.reactBar i');
  if (bar) bar.style.width = `${pct}%`;
}

function signature(v: MatchView): string {
  return JSON.stringify([
    v.phase,
    v.winnerId,
    v.currentPlayerId,
    v.currentTurnsRemaining,
    v.direction,
    v.deckCount,
    v.hitmenRemaining,
    v.drawFromBottom,
    v.players.map((p) => [p.id, p.alive, p.handCount, p.connected, p.extraTurns]),
    v.you?.hand.map((c) => c.id),
    v.locks,
    v.stack,
    v.pending && [
      v.pending.kind,
      (v.pending as { playerId?: string }).playerId,
      (v.pending as { eligible?: string[] }).eligible,
      (v.pending as { responded?: string[] }).responded,
    ],
    v.log.length,
    v.lastPlayedType,
    v.privateInfo.length,
    armedCard?.id ?? null,
    peeksDismissed,
  ]);
}

// ------------------------------------------------------------- the big beats

/** How much of the log has already been turned into sound and movement. */
let beatsShown = 0;

/**
 * Some things deserve more than a line of text. These are drawn on their own
 * layer, driven by new entries in the log, so they survive the screen being
 * rebuilt underneath them.
 */
function playBeats(v: MatchView): void {
  if (beatsShown === 0) {
    beatsShown = v.log.length; // do not replay the whole match on arrival
    return;
  }
  const fresh = v.log.slice(beatsShown);
  beatsShown = v.log.length;

  for (const e of fresh) {
    if (e.t === 'hitman_drawn') {
      const mine = e.playerId === meId();
      stamp('hit', 'HITMAN', mine ? 'DRAWN ON YOU' : `DRAWN ON ${nameOf(v, e.playerId)}`);
      flinch();
      sound('hitman');
    } else if (e.t === 'angel_played') {
      stamp('save', e.mirrored ? 'MIRRORED' : 'ANGEL', 'THE BULLET STOPS HERE');
      sound('angel');
    } else if (e.t === 'angel_burned') {
      stamp('hit', 'ANGEL BURNED', `${nameOf(v, e.playerId)} HAS NOTHING LEFT`);
      sound('hitman');
    } else if (e.t === 'eliminated') {
      stamp('out', nameOf(v, e.playerId), 'CONTRACT CLOSED');
      sound('out');
    } else if (e.t === 'card_played') {
      sound('play');
    } else if (e.t === 'drew') {
      sound('draw');
    } else if (e.t === 'burned') {
      sound('burn');
    }
  }
}

function stamp(kind: 'hit' | 'save' | 'out', line: string, sub: string): void {
  const layer = $('moments');
  const el = document.createElement('div');
  el.className = `moment ${kind}`;
  el.innerHTML = `${line}<small>${sub}</small>`;
  layer.appendChild(el);
  window.setTimeout(() => el.remove(), 1600);
}

function flinch(): void {
  const el = $('match');
  el.classList.remove('flinch');
  void el.offsetWidth; // restart the animation even if it is already running
  el.classList.add('flinch');
  window.setTimeout(() => el.classList.remove('flinch'), 600);
}

function renderIfChanged(): void {
  const v = driver?.view;
  if (!v) return;
  playBeats(v);
  const sig = signature(v);
  if (sig === lastSignature) return;
  lastSignature = sig;
  render(v);
}

// ================================================================== rendering

/** True while you are inside a live reflex window. */
function inReactWindow(v: MatchView): boolean {
  const p = v.pending;
  if (!p || p.kind !== 'quickWindow') return false;
  const w = p as { eligible: string[]; responded: string[] };
  return w.eligible.includes(meId()) && !w.responded.includes(meId());
}

function nameOf(v: MatchView, id: string): string {
  if (id === meId()) return 'YOU';
  return v.players.find((p) => p.id === id)?.name ?? id;
}

function render(v: MatchView): void {
  // If the turn moved on while a choice was half-made, let go of it. Otherwise
  // the chooser sits there and the next tap is just an error.
  if (armedCard && !canPlay(v, armedCard.type)) armedCard = null;

  renderOpponents(v);
  renderDeck(v);
  renderDiscard(v);
  renderStatus(v);
  renderLog(v);
  renderPeek(v);
  renderReactStrip(v);
  renderHand(v);
  renderActions(v);
  renderOverlay(v);
}

/**
 * What Peek showed you. It stays up until you wave it away, or until somebody
 * draws - at which point what you saw is no longer the top of the deck.
 */
function renderPeek(v: MatchView): void {
  const strip = $('peekStrip');
  const latest = v.privateInfo[v.privateInfo.length - 1];
  const unread = v.privateInfo.length > peeksDismissed;
  const stillTrue = latest && latest.deckCount === v.deckCount;

  if (!latest || !unread || !stillTrue) {
    strip.className = 'peekStrip hidden';
    strip.innerHTML = '';
    return;
  }

  const labels = ['NEXT', 'THEN', 'THEN'];
  strip.className = 'peekStrip';
  strip.innerHTML = `
    <div class="peekHead">
      <span>TOP OF THE DECK &mdash; ONLY YOU SEE THIS</span>
      <button id="dismissPeek" aria-label="Hide">&times;</button>
    </div>
    <div class="peekRow">
      ${latest.cards
        .map(
          (c, i) => `<div class="peekCard ${c.type === 'HITMAN' ? 'danger' : ''}">
            <div class="pos">${labels[i] ?? ''}</div>
            <div class="pname">${CARD_INFO[c.type].name}</div>
          </div>`,
        )
        .join('')}
    </div>`;
}

/**
 * The reflex window happens in place, above your hand. It never covers the
 * table - the whole point of the window is seeing who played what on whom.
 */
function renderReactStrip(v: MatchView): void {
  const strip = $('reactStrip');
  if (!inReactWindow(v)) {
    strip.className = 'reactStrip hidden';
    strip.innerHTML = '';
    return;
  }
  const top = v.stack[v.stack.length - 1];
  const at = top.targetPlayerId
    ? ` on ${nameOf(v, top.targetPlayerId)}`
    : top.lockType
      ? ` on ${CARD_INFO[top.lockType].name}`
      : '';
  const answers = (v.you?.hand ?? []).filter((c) => canPlay(v, c.type)).length;
  strip.className = 'reactStrip';
  strip.innerHTML = `
    <div class="headline">${nameOf(v, top.playerId)} plays <b>${CARD_INFO[top.cardType].name}</b>${at}</div>
    <div class="sub">${answers === 1 ? 'One card can answer it' : `${answers} cards can answer it`} &middot; tap it, or let it stand</div>
    <div class="reactBar"><i></i></div>`;
}

/**
 * Seats the other players around the far edge of the table, left to right, on
 * an arc. One opponent sits dead ahead; a full table curves round the sides.
 */
/**
 * Seats are laid out from the actual size of the table, not from guessed
 * numbers: a narrow phone with eleven opponents needs smaller seats than a
 * tablet with two. Positions are clamped so nobody hangs off an edge.
 */
function seatPosition(
  index: number,
  total: number,
  seatW: number,
  tableW: number,
  tableH: number,
): { left: number; top: number } {
  const t = total === 1 ? 0.5 : index / (total - 1);
  const halfW = ((seatW / 2 + 4) / Math.max(1, tableW)) * 100;
  const rawLeft = 6 + t * 88;
  const left = Math.min(Math.max(rawLeft, halfW), 100 - halfW);

  const seatH = seatW < 80 ? 58 : 70;
  const halfH = ((seatH / 2 + 6) / Math.max(1, tableH)) * 100;
  const rawTop = 50 - 40 * Math.sin(Math.PI * t);
  return { left, top: Math.max(rawTop, halfH) };
}

function renderOpponents(v: MatchView): void {
  const targeting = armedCard !== null && CARD_INFO[armedCard.type].needsTarget;
  const others = v.players.filter((p) => p.id !== meId());
  const seats = $('opponents');
  const tableW = seats.clientWidth || window.innerWidth;
  const tableH = seats.clientHeight || window.innerHeight;

  // Give every seat as much room as the table can actually spare.
  const seatW = Math.max(44, Math.min(92, Math.floor((tableW * 0.94) / others.length) - 6));
  const backs = Math.max(1, Math.min(7, Math.floor(seatW / 13)));
  seats.style.setProperty('--seatW', `${seatW}px`);
  seats.classList.toggle('crowded', seatW < 80);
  seats.classList.toggle('tiny', seatW < 58);

  seats.innerHTML = others
    .map((p, i) => {
      const classes = ['opp'];
      if (!p.alive) classes.push('dead');
      if (p.id === v.currentPlayerId) classes.push('current');
      if (targeting && p.alive) classes.push('targetable');
      const extra =
        p.alive && p.extraTurns > 0
          ? `<div class="extra">+${p.extraTurns} TURN${p.extraTurns === 1 ? '' : 'S'}</div>`
          : '';
      const state = !p.alive ? 'ELIMINATED' : p.connected ? `${p.handCount} cards` : 'SIGNAL LOST';
      // A card back for each card they hold, up to a fan that still reads.
      const fan = Array.from({ length: Math.min(p.handCount, backs) }, () => '<i></i>').join('');
      const { left, top } = seatPosition(i, others.length, seatW, tableW, tableH);
      return `<div class="${classes.join(' ')}" data-target="${p.id}"
                   style="left:${left}%;top:${top}%">
        ${extra}
        <div class="fan">${fan}</div>
        <div class="who">${p.name.slice(0, 1)}</div>
        <div class="name">${p.name}</div>
        <div class="cards">${state}</div>
      </div>`;
    })
    .join('');
}

/** The pile beside the deck: whatever was played last, face up. */
function renderDiscard(v: MatchView): void {
  const el = $('discard');
  const top = v.lastPlayedType;
  if (!top) {
    el.innerHTML = 'NOTHING<br />PLAYED YET';
    return;
  }
  el.innerHTML = cardHtml(v, { id: 'discard-top', type: top }, false).replace(
    'data-card-id="discard-top"',
    'data-discard="1"',
  );
}

/** How full the deck looked when the match began, so it can be seen shrinking. */
let deckAtStart = 0;

function renderDeck(v: MatchView): void {
  const density = v.deckCount > 0 ? v.hitmenRemaining / v.deckCount : 1;
  document.documentElement.style.setProperty('--danger', String(Math.min(1, density * 3.2)));

  if (v.deckCount > deckAtStart) deckAtStart = v.deckCount;
  const left = deckAtStart > 0 ? v.deckCount / deckAtStart : 0;
  // The stack itself thins out. Six leaves of paper at the start, one at the end.
  document.documentElement.style.setProperty('--stack', String(Math.max(0, Math.round(left * 6))));

  // The number the whole game turns on: the chance the next card kills you.
  const chance = v.deckCount > 0 ? Math.round((v.hitmenRemaining / v.deckCount) * 100) : 0;
  $('deathChance').textContent = `${chance}%`;
  $('hudHitmen').textContent = String(v.hitmenRemaining);
  $('hudAlive').textContent = String(v.players.filter((p) => p.alive).length);
  document.querySelector('.hud .danger')?.classList.toggle('grim', chance >= 25);

  $('hitmenLeft').textContent = String(v.hitmenRemaining);
  $('deckCount').textContent =
    v.deckCount === 1 ? '1 card left' : `${v.deckCount} cards left`;
  $('deck').classList.toggle('thin', left < 0.35);
  $('deck').classList.toggle('grim', density > 0.18);
}

function renderStatus(v: MatchView): void {
  const chips: string[] = [];
  for (const l of v.locks) {
    chips.push(
      `<span class="chip lock">${CARD_INFO[l.type].name.toUpperCase()} LOCKED &middot; ${l.turnsRemaining}</span>`,
    );
  }
  if (v.direction === -1) chips.push('<span class="chip">ORDER REVERSED</span>');
  if (v.drawFromBottom && v.currentPlayerId === meId()) {
    chips.push('<span class="chip lock">YOUR DRAW COMES OFF THE BOTTOM</span>');
  }
  const mine = v.players.find((p) => p.id === meId());
  if (mine && mine.alive && mine.extraTurns > 0) {
    chips.push(
      `<span class="chip alert">YOU OWE ${mine.extraTurns} EXTRA TURN${mine.extraTurns === 1 ? '' : 'S'}</span>`,
    );
  }
  if (v.you && !v.you.alive && v.phase === 'playing') {
    chips.push('<span class="chip alert">ELIMINATED &middot; SPECTATING</span>');
  }
  $('statusStrip').innerHTML = chips.join('');
}

function describe(v: MatchView, e: LogEntry): { text: string; cls: string } {
  const n = (id: string) => nameOf(v, id);
  const c = (t: CardType) => CARD_INFO[t].name;
  switch (e.t) {
    case 'turn_start':
      return { text: `&mdash; ${n(e.playerId)} to act`, cls: '' };
    case 'card_played':
      return { text: `${n(e.playerId)} plays ${c(e.cardType)}`, cls: '' };
    case 'card_cancelled':
      return { text: `${c(e.cardType)} cancelled by ${n(e.byPlayerId)}`, cls: 'good' };
    case 'burned':
      return {
        text: `${n(e.byPlayerId)} burns ${c(e.cardType)} &mdash; ${e.copiesDestroyed} destroyed`,
        cls: 'hit',
      };
    case 'mirrored':
      return { text: `${n(e.byPlayerId)} mirrors ${c(e.cardType)}`, cls: '' };
    case 'redirected':
      return { text: `${n(e.fromPlayerId)} redirects it onto ${n(e.toPlayerId)}`, cls: 'good' };
    case 'direction_reversed':
      return { text: 'The order of play reverses', cls: '' };
    case 'shuffled':
      return { text: `${n(e.playerId)} shuffles the deck`, cls: '' };
    case 'attack':
      return { text: `${n(e.byPlayerId)} attacks ${e.targets.map(n).join(', ')}`, cls: '' };
    case 'attack_cancelled':
      return { text: 'A Hitman hits the table &mdash; every Attack is off', cls: 'good' };
    case 'locked':
      return { text: `${n(e.playerId)} locks ${c(e.cardType)} for ${e.turns} turns`, cls: '' };
    case 'lock_expired':
      return { text: `${c(e.cardType)} is playable again`, cls: '' };
    case 'stolen':
      return { text: `${n(e.thiefId)} takes a card from ${n(e.fromPlayerId)}`, cls: '' };
    case 'mimicked':
      return {
        text: `${n(e.playerId)} throws away ${e.lost} to copy ${n(e.targetPlayerId)}'s hand (${e.cards})`,
        cls: '',
      };
    case 'drew':
      return { text: `${n(e.playerId)} draws${e.fromBottom ? ' from the bottom' : ''}`, cls: '' };
    case 'hitman_drawn':
      return { text: `${n(e.playerId)} DRAWS A HITMAN`, cls: 'hit' };
    case 'angel_played':
      return {
        text: e.mirrored
          ? `${n(e.playerId)} mirrors the Angel to save themselves`
          : `${n(e.playerId)} puts an Angel down`,
        cls: 'good',
      };
    case 'angel_burned':
      return { text: `${n(e.playerId)}'s Angel is burned off the table`, cls: 'hit' };
    case 'angel_saved': {
      const where =
        e.placement === null
          ? 'the Hitman goes back into the deck'
          : e.placement === 'random'
            ? 'the Hitman goes back at random'
            : e.placement === 'exact'
              ? `you slid the Hitman in at ${e.position}`
              : `you put the Hitman ${e.placement === 'middle' ? 'in the middle' : `at the ${e.placement}`}`;
      return { text: `An Angel takes the bullet for ${n(e.playerId)} &mdash; ${where}`, cls: 'good' };
    }
    case 'eliminated':
      return { text: `${n(e.playerId)} is eliminated`, cls: 'hit' };
    case 'skipped':
      return { text: `${n(e.playerId)} skips`, cls: '' };
    case 'timed_out':
      return { text: `${n(e.playerId)} ran out of time`, cls: '' };
    case 'game_over':
      return {
        text: e.winnerId ? `${n(e.winnerId)} takes the file` : 'No survivors',
        cls: 'good',
      };
    default:
      return { text: '', cls: '' };
  }
}

function renderLog(v: MatchView): void {
  const el = $('log');
  el.innerHTML = v.log
    .slice(-60)
    .map((e) => {
      const d = describe(v, e);
      return d.text ? `<div class="${d.cls}">${d.text}</div>` : '';
    })
    .join('');
  el.scrollTop = el.scrollHeight;
}

function canPlay(v: MatchView, type: CardType): boolean {
  const info = CARD_INFO[type];
  if (info.passive) return false;
  if (v.locks.some((l) => l.type === type)) return false;
  const p = v.pending;
  const myAngelMoment =
    p?.kind === 'angel' && (p as { playerId: string }).playerId === meId();
  if (type === 'ANGEL') return myAngelMoment;
  if (myAngelMoment) {
    // A Mirror stands in for an Angel, but only while an Angel is still the
    // last card played.
    return type === 'MIRROR' && v.lastPlayedType === 'ANGEL';
  }
  if (p && p.kind === 'angel') return false;
  if (p && p.kind === 'quickWindow') {
    const w = p as { eligible: string[]; responded: string[] };
    if (!info.quick) return false;
    if (!w.eligible.includes(meId()) || w.responded.includes(meId())) return false;
    const top = v.stack[v.stack.length - 1];
    if (type === 'REDIRECT') return top?.cardType === 'ATTACK';
    if (top?.cardType === 'ANGEL') return type === 'BURN';
    return true;
  }
  if (p) return false;
  if (info.quick) return false;
  if (type === 'MIRROR' && !canMirror(v)) return false;
  return v.currentPlayerId === meId() && v.you?.alive === true && v.stack.length === 0;
}

/** What a Mirror would repeat if you played it right now. */
function canMirror(v: MatchView): boolean {
  const t = v.lastPlayedType;
  return !!t && t !== 'MIRROR' && t !== 'ANGEL' && !CARD_INFO[t].quick;
}

function mirrorBlurb(v: MatchView): string {
  if (v.pending?.kind === 'angel') return 'Copy the Angel and save yourself.';
  if (canMirror(v)) return `Repeats ${CARD_INFO[v.lastPlayedType!].name}.`;
  return 'Repeats the last card played. Nothing to repeat.';
}

function cardHtml(v: MatchView, card: { id: string; type: CardType }, playable: boolean): string {
  const info = CARD_INFO[card.type];
  // Lock has no choice attached, so the card itself says what it would ban.
  const blurb =
    card.type === 'LOCK'
      ? v.lastPlayedType
        ? `Bans ${CARD_INFO[v.lastPlayedType].name} for 3 turns.`
        : 'Bans the last card played. Nothing played yet.'
      : card.type === 'MIRROR'
        ? mirrorBlurb(v)
        : info.blurb;
  const lock = v.locks.find((l) => l.type === card.type);
  const reacting = inReactWindow(v);
  const classes = ['card'];
  if (info.quick) classes.push('quick');
  if (info.passive) classes.push('passive');
  if (card.type === 'ANGEL') classes.push('angel');
  if (lock) classes.push('locked');
  else if (!playable) classes.push(reacting ? 'dimmed' : 'disabled');
  if (reacting && playable) classes.push('hot');
  if (armedCard?.id === card.id) classes.push('selected');

  const tag = info.passive ? 'AUTOMATIC' : info.quick ? 'QUICK' : '';
  classes.push(`kind-${CARD_KIND[card.type]}`);
  const badge = lock ? `LOCKED ${lock.turnsRemaining}` : '';

  // The two cards whose effect depends on the board say what they would hit.
  // Everything else needs no words at all: the mark and the name are the card.
  let target = '';
  if (card.type === 'LOCK' || card.type === 'MIRROR') {
    const t = v.lastPlayedType;
    const usable = card.type === 'MIRROR' ? canMirror(v) : !!t;
    if (v.pending?.kind === 'angel' && card.type === 'MIRROR') target = 'THE ANGEL';
    else target = usable && t ? CARD_INFO[t].name.toUpperCase() : '&mdash;';
  }

  return `<button class="${classes.join(' ')}" data-card-id="${card.id}"
    data-lockturns="${badge}" title="${info.name}: ${blurb.replace(/"/g, '')}">
    <div class="cardHead">
      <span class="cno">${CARD_NUMBER[card.type]}</span>
      <span class="ctag">${tag}</span>
    </div>
    <div class="cmark">${CARD_MARK[card.type]}</div>
    <div class="cfoot">
      <div class="cname">${info.name}</div>
      ${target ? `<div class="ctarget">&rarr; ${target}</div>` : ''}
    </div>
  </button>`;
}

function renderHand(v: MatchView): void {
  const hand = v.you?.hand ?? [];
  layOutFan(hand.length);
  $('handLabel').textContent = !v.you?.alive
    ? 'YOU ARE OUT — WATCHING'
    : inReactWindow(v)
      ? 'INTERRUPT'
      : `YOUR HAND — ${hand.length} CARD${hand.length === 1 ? '' : 'S'}`;
  $('hand').innerHTML = hand.length
    ? hand.map((c) => cardHtml(v, c, canPlay(v, c.type))).join('')
    : '<div class="empty">Nothing in hand.</div>';
}

/**
 * Cards only overlap as much as they have to. A small hand is laid out in full;
 * a big one tucks up and drops the wording, leaving the mark and the name.
 */
function layOutFan(count: number): void {
  const el = $('hand');
  if (count === 0) {
    el.classList.remove('tight');
    return;
  }
  const cardW = window.innerHeight <= 430 ? 66 : 78;
  const room = Math.max(200, el.clientWidth - 28);
  const needed = count * cardW;
  // Negative margin, shared across the gaps between cards.
  // Always a slight tuck so it reads as a hand, and more only when it must.
  const crush = needed <= room ? 0 : (needed - room) / Math.max(1, count - 1);
  const overlap = Math.max(14, Math.min(cardW - 26, crush));
  el.style.setProperty('--fan', `${-Math.round(overlap)}px`);
  el.classList.toggle('tight', overlap > cardW * 0.34);
}

function renderActions(v: MatchView): void {
  const actions = document.querySelector<HTMLElement>('.actions')!;
  if (armedCard) {
    actions.innerHTML =
      '<button id="cancelArm">TAP AN OPPONENT ABOVE &nbsp;·&nbsp; TAP TO CANCEL</button>';
    return;
  }
  if (inReactWindow(v)) {
    actions.innerHTML = '<button id="passBtn">LET IT STAND</button>';
    return;
  }
  const canDraw =
    !v.pending && v.currentPlayerId === meId() && v.you?.alive === true && v.phase === 'playing';
  const drawLabel = v.drawFromBottom ? 'DRAW FROM THE BOTTOM' : 'DRAW &amp; END TURN';
  actions.innerHTML = `<button id="drawBtn" class="primary" ${canDraw ? '' : 'disabled'}>
    ${canDraw ? drawLabel : waitingText(v)}
  </button>`;
}

function waitingText(v: MatchView): string {
  if (v.phase === 'ended') return 'MATCH OVER';
  if (!v.you?.alive) return 'SPECTATING';
  if (v.pending?.kind === 'quickWindow') return 'OTHERS ARE REACTING';
  if (v.pending?.kind === 'angel') return 'AN ANGEL IS GOING DOWN';
  if (v.pending) return 'WAITING ON A CHOICE';
  return `${nameOf(v, v.currentPlayerId)} IS ACTING`;
}

// ---------------------------------------------------------------- overlays

function renderOverlay(v: MatchView): void {
  const ov = $('overlay');
  const p = v.pending;

  if (v.phase === 'ended') {
    const won = v.winnerId === meId();
    ov.className = 'overlay';
    ov.innerHTML = `<div class="panel result">
      <div class="verdict ${won ? 'win' : 'lose'}">${won ? 'CONTRACT FULFILLED' : 'CASE CLOSED'}</div>
      <p>${
        v.winnerId ? `${nameOf(v, v.winnerId)} is the last one breathing.` : 'Nobody walked away.'
      }</p>
      <button class="primary" id="againBtn">${online ? 'BACK TO THE MENU' : 'NEW CONTRACT'}</button>
    </div>`;
    return;
  }

  // The reflex window is handled in place by renderReactStrip, not here.

  if (p && p.kind === 'angel' && (p as { playerId: string }).playerId === meId()) {
    const answers = (v.you?.hand ?? []).filter((c) => canPlay(v, c.type));
    const canMirror = answers.some((c) => c.type === 'MIRROR');
    ov.className = 'overlay';
    ov.innerHTML = `<div class="panel">
      <h2>A HITMAN HAS YOUR NAME ON IT</h2>
      <p>Put something down to answer it, or die. Nobody can cancel an Angel
      &mdash; but a Burn takes it, and every other Angel at the table, with it.${
        canMirror
          ? ' An Angel was the last card played, so a Mirror will copy it and keep your Angel for later.'
          : ''
      }</p>
      <div class="miniHand">${answers.map((c) => cardHtml(v, c, true)).join('')}</div>
    </div>`;
    return;
  }

  if (p && p.kind === 'steal' && (p as { playerId: string }).playerId === meId()) {
    const options = (p as { options: { id: string; type: CardType }[] | null }).options ?? [];
    ov.className = 'overlay';
    ov.innerHTML = `<div class="panel">
      <h2>HANDED OVER</h2>
      <p>${nameOf(v, (p as { thiefId: string }).thiefId)} played Steal. You pick which card
      they get. Leave it too long and it picks for you.</p>
      <div class="miniHand">${options
        .map((c) => cardHtml(v, c, true).replace('data-card-id=', 'data-give='))
        .join('')}</div>
    </div>`;
    return;
  }

  if (p && p.kind === 'hitmanPlacement' && (p as { playerId: string }).playerId === meId()) {
    ov.className = 'overlay';
    const slots = v.deckCount + 1;
    ov.innerHTML = `<div class="panel">
      <h2>YOUR ANGEL TOOK THE BULLET</h2>
      <p>The Hitman goes back into the deck and you decide where.
      <b>Nobody else is told.</b> Top means the next player draws it. Bottom buries
      it. Random is a secret even from you.</p>
      <div class="row">
        <button data-place="top">TOP</button>
        <button data-place="middle">MIDDLE</button>
        <button data-place="bottom">BOTTOM</button>
      </div>
      <div class="row" style="margin-top:8px">
        <button data-place="random">SOMEWHERE RANDOM</button>
      </div>
      <div class="slotPick">
        <label for="slotRange">OR PICK THE EXACT SLOT &mdash; <b id="slotLabel">1</b> of ${slots}</label>
        <input id="slotRange" type="range" min="1" max="${slots}" value="1" />
        <button id="slotGo" class="primary">SLIDE IT IN THERE</button>
      </div>
    </div>`;
    return;
  }

  ov.className = 'overlay hidden';
  ov.innerHTML = '';
}

// ==================================================================== input

function toast(message: string): void {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add('hidden'), 2400);
}

function attempt(fn: () => void): void {
  try {
    fn();
  } catch (err) {
    toast(err instanceof GameError ? err.message : 'That move is not allowed.');
  }
  lastSignature = '';
}

document.addEventListener('input', (ev) => {
  const el = ev.target as HTMLInputElement;
  if (el?.id === 'slotRange') $('slotLabel').textContent = el.value;
});

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(
    '[data-card-id],[data-target],[data-place],[data-give],[data-kick],#drawBtn,#passBtn,#againBtn,#cancelArm,#dismissPeek,#slotGo',
  );
  if (!el) return;

  const kick = el.getAttribute('data-kick');
  if (kick) return net.send({ t: 'removeSeat', seatId: kick });

  if (!driver) return;

  if (el.id === 'againBtn') {
    if (online) {
      net.send({ t: 'leaveRoom' });
    } else {
      driver = null;
      armedCard = null;
      showScreen('setup');
    }
    return;
  }
  if (el.id === 'dismissPeek') {
    peeksDismissed = driver.view?.privateInfo.length ?? peeksDismissed;
    lastSignature = '';
    return;
  }
  if (el.id === 'cancelArm') {
    armedCard = null;
    lastSignature = '';
    return;
  }
  if (el.id === 'drawBtn') return attempt(() => driver!.draw());
  if (el.id === 'passBtn') return attempt(() => driver!.pass());

  const give = el.getAttribute('data-give');
  if (give) return attempt(() => driver!.choose(give));

  const place = el.getAttribute('data-place');
  if (place) return attempt(() => driver!.choose(place));

  if (el.id === 'slotGo') {
    const slot = $<HTMLInputElement>('slotRange').value;
    return attempt(() => driver!.choose(slot));
  }

  const target = el.getAttribute('data-target');
  if (target && armedCard && CARD_INFO[armedCard.type].needsTarget) {
    const card = armedCard;
    armedCard = null;
    return attempt(() => driver!.play(card.id, { targetPlayerId: target }));
  }

  const cardId = el.getAttribute('data-card-id');
  if (cardId) {
    const v = driver.view;
    if (!v) return;
    const card = v.you?.hand.find((c) => c.id === cardId);
    if (!card) return;
    if (!canPlay(v, card.type)) {
      const lock = v.locks.find((l) => l.type === card.type);
      if (lock) {
        return toast(`${CARD_INFO[card.type].name} is locked for ${lock.turnsRemaining} more turns.`);
      }
      if (CARD_INFO[card.type].passive) {
        return toast(`${CARD_INFO[card.type].name} works on its own. You never play it.`);
      }
      return toast('Not right now.');
    }
    const info = CARD_INFO[card.type];
    if (info.needsTarget) {
      armedCard = { id: card.id, type: card.type };
      lastSignature = '';
      return;
    }
    return attempt(() => driver!.play(card.id));
  }
});
