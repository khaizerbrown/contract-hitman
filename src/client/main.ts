import { LocalMatch } from './localMatch.js';
import { Net } from './net.js';
import { CARD_INFO } from './cardInfo.js';
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
let toastTimer: number | undefined;

const net = new Net();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
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
  if (net.playerId) {
    actOnIntent();
  } else {
    net.connect(typedName());
  }
}

function actOnIntent(): void {
  if (!intent) return;
  if (intent === 'create') net.send({ t: 'createRoom' });
  else net.send({ t: 'joinRoom', code: intent.join });
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
    if (net.room) return;
    online = false;
    sessionStorage.removeItem('hitman.name');
    net.disconnect();
    $('netStatus').textContent = 'That table has closed. Start a new one.';
  }, 3000);
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
    v.players.map((p) => [p.id, p.alive, p.handCount, p.connected]),
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
    armedCard?.id ?? null,
  ]);
}

function renderIfChanged(): void {
  const v = driver?.view;
  if (!v) return;
  const sig = signature(v);
  if (sig === lastSignature) return;
  lastSignature = sig;
  render(v);
}

// ================================================================== rendering

/** True while you are inside a live 2-second reflex window. */
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
  renderStatus(v);
  renderLog(v);
  renderReactStrip(v);
  renderHand(v);
  renderActions(v);
  renderOverlay(v);
}

/**
 * The reflex window happens in place, above your hand. It never covers the
 * table - the whole point of the two seconds is seeing who played what on whom.
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

function renderOpponents(v: MatchView): void {
  const targeting = armedCard !== null && CARD_INFO[armedCard.type].needsTarget;
  $('opponents').innerHTML = v.players
    .filter((p) => p.id !== meId())
    .map((p) => {
      const classes = ['opp'];
      if (!p.alive) classes.push('dead');
      if (p.id === v.currentPlayerId) classes.push('current');
      if (targeting && p.alive) classes.push('targetable');
      const extra =
        p.id === v.currentPlayerId && v.currentTurnsRemaining > 1
          ? `<div class="extra">x${v.currentTurnsRemaining}</div>`
          : '';
      const state = !p.alive ? 'ELIMINATED' : p.connected ? `${p.handCount} cards` : 'SIGNAL LOST';
      return `<div class="${classes.join(' ')}" data-target="${p.id}">
        ${extra}
        <div class="name">${p.name}</div>
        <div class="cards">${state}</div>
      </div>`;
    })
    .join('');
}

function renderDeck(v: MatchView): void {
  const density = v.deckCount > 0 ? v.hitmenRemaining / v.deckCount : 1;
  document.documentElement.style.setProperty('--danger', String(Math.min(1, density * 3.2)));
  $('hitmenLeft').textContent = String(v.hitmenRemaining);
  $('deckCount').textContent = `${v.deckCount} cards left in the deck`;
}

function renderStatus(v: MatchView): void {
  const chips: string[] = [];
  for (const l of v.locks) {
    chips.push(
      `<span class="chip lock">${CARD_INFO[l.type].name.toUpperCase()} LOCKED &middot; ${l.turnsRemaining}</span>`,
    );
  }
  if (v.direction === -1) chips.push('<span class="chip">ORDER REVERSED</span>');
  if (v.currentTurnsRemaining > 1) {
    chips.push(
      `<span class="chip alert">${nameOf(v, v.currentPlayerId)} OWES ${v.currentTurnsRemaining} TURNS</span>`,
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
    case 'angel_saved':
      return {
        text: `An Angel takes the bullet for ${n(e.playerId)} &mdash; Hitman goes ${e.placement}`,
        cls: 'good',
      };
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
  if (p && p.kind === 'quickWindow') {
    const w = p as { eligible: string[]; responded: string[] };
    if (!info.quick) return false;
    if (!w.eligible.includes(meId()) || w.responded.includes(meId())) return false;
    const top = v.stack[v.stack.length - 1];
    if (type === 'REDIRECT') return top?.cardType === 'ATTACK';
    return true;
  }
  if (p) return false;
  if (info.quick) return false;
  return v.currentPlayerId === meId() && v.you?.alive === true && v.stack.length === 0;
}

function cardHtml(v: MatchView, card: { id: string; type: CardType }, playable: boolean): string {
  const info = CARD_INFO[card.type];
  // Lock has no choice attached, so the card itself says what it would ban.
  const blurb =
    card.type === 'LOCK'
      ? v.lastPlayedType
        ? `Bans ${CARD_INFO[v.lastPlayedType].name} for 3 turns.`
        : 'Bans the last card played. Nothing played yet.'
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
  const badge = lock ? `LOCKED ${lock.turnsRemaining}` : '';
  return `<button class="${classes.join(' ')}" data-card-id="${card.id}" data-lockturns="${badge}">
    <div class="cname">${info.name}</div>
    <div class="cblurb">${blurb}</div>
    <div class="ctag">${tag}</div>
  </button>`;
}

function renderHand(v: MatchView): void {
  const hand = v.you?.hand ?? [];
  $('handLabel').textContent = !v.you?.alive
    ? 'YOU ARE OUT — WATCHING'
    : inReactWindow(v)
      ? 'INTERRUPT'
      : `YOUR HAND — ${hand.length} CARD${hand.length === 1 ? '' : 'S'}`;
  $('hand').innerHTML = hand.length
    ? hand.map((c) => cardHtml(v, c, canPlay(v, c.type))).join('')
    : '<div class="empty">Nothing in hand.</div>';
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
  actions.innerHTML = `<button id="drawBtn" class="primary" ${canDraw ? '' : 'disabled'}>
    ${canDraw ? 'DRAW &amp; END TURN' : waitingText(v)}
  </button>`;
}

function waitingText(v: MatchView): string {
  if (v.phase === 'ended') return 'MATCH OVER';
  if (!v.you?.alive) return 'SPECTATING';
  if (v.pending?.kind === 'quickWindow') return 'OTHERS ARE REACTING';
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
    ov.innerHTML = `<div class="panel">
      <h2>YOUR ANGEL TOOK THE BULLET</h2>
      <p>The Hitman goes back into the deck. You decide where. Top means the next
      player draws it. Bottom buries it for a long time.</p>
      <div class="row">
        <button data-place="top">TOP</button>
        <button data-place="middle">MIDDLE</button>
        <button data-place="bottom">BOTTOM</button>
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

document.addEventListener('click', (ev) => {
  const el = (ev.target as HTMLElement).closest<HTMLElement>(
    '[data-card-id],[data-target],[data-place],[data-give],[data-kick],#drawBtn,#passBtn,#againBtn,#cancelArm',
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
