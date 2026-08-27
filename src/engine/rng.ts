/**
 * Seeded random numbers. Same seed always gives the same game, which is what
 * makes the tests trustworthy and lets us replay a match from its log.
 */
export interface RngHolder {
  rngState: number;
}

export function nextRandom(h: RngHolder): number {
  h.rngState = (h.rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(h.rngState ^ (h.rngState >>> 15), 1 | h.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randomInt(h: RngHolder, maxExclusive: number): number {
  return Math.floor(nextRandom(h) * maxExclusive);
}

/** Fisher-Yates, in place. */
export function shuffleInPlace<T>(h: RngHolder, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randomInt(h, i + 1);
    const a = arr[i];
    arr[i] = arr[j];
    arr[j] = a;
  }
  return arr;
}
