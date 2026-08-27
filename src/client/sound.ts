/**
 * Every sound in the game is made in the browser rather than loaded from a
 * file. Nothing to download, nothing to host, and it works with no connection.
 *
 * Browsers refuse to make noise until the player has interacted with the page,
 * so the audio is only woken up on the first tap or click.
 */

export type Beat = 'draw' | 'play' | 'angel' | 'hitman' | 'burn' | 'out';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let on = true;

export function soundIsOn(): boolean {
  return on;
}

export function setSoundOn(next: boolean): void {
  on = next;
  try {
    localStorage.setItem('hitman.sound', next ? 'on' : 'off');
  } catch {
    /* private browsing, and it does not matter */
  }
  if (master) master.gain.value = next ? 0.9 : 0;
}

export function loadSoundPreference(): void {
  try {
    on = localStorage.getItem('hitman.sound') !== 'off';
  } catch {
    on = true;
  }
}

/** Called on the first interaction, which is what browsers wait for. */
export function wakeAudio(): void {
  if (ctx) {
    if (ctx.state === 'suspended') void ctx.resume();
    return;
  }
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = on ? 0.9 : 0;
    master.connect(ctx.destination);
  } catch {
    ctx = null;
  }
}

function tone(
  shape: OscillatorType,
  from: number,
  to: number,
  seconds: number,
  volume: number,
  delay = 0,
): void {
  if (!ctx || !master) return;
  const at = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = shape;
  osc.frequency.setValueAtTime(from, at);
  if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + seconds);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + seconds + 0.05);
}

/** A short burst of noise - paper, matches, and bad news. */
function noise(seconds: number, volume: number, from: number, to: number, delay = 0): void {
  if (!ctx || !master) return;
  const at = ctx.currentTime + delay;
  const frames = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(from, at);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), at + seconds);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(volume, at);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds);
  src.connect(filter).connect(gain).connect(master);
  src.start(at);
}

export function sound(beat: Beat): void {
  if (!on) return;
  wakeAudio();
  if (!ctx) return;

  switch (beat) {
    case 'draw': // a card sliding off the top
      noise(0.09, 0.12, 2400, 900);
      break;
    case 'play': // it lands on the table
      tone('triangle', 190, 120, 0.1, 0.12);
      noise(0.06, 0.08, 1200, 400);
      break;
    case 'angel': // brass, two notes, upward
      tone('sine', 528, 528, 0.5, 0.14);
      tone('sine', 792, 792, 0.55, 0.1, 0.07);
      break;
    case 'hitman': // the floor drops out
      tone('sawtooth', 220, 42, 0.7, 0.2);
      noise(0.35, 0.16, 900, 120, 0.02);
      break;
    case 'burn':
      noise(0.5, 0.16, 500, 3400);
      break;
    case 'out': // a file closing
      tone('sine', 130, 62, 0.45, 0.16);
      noise(0.12, 0.1, 700, 200);
      break;
  }
}
