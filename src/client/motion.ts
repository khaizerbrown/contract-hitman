/**
 * Cards that move.
 *
 * Two things live here. A flight layer, for a card travelling from one place to
 * another - off the deck into a hand, out of a hand onto the discard, across
 * the table when somebody steals. And FLIP, which is how the cards already in
 * your hand slide over to make room instead of jumping.
 *
 * Nothing here knows any rules. It is told where a card came from and where it
 * is going, and it moves it.
 */

export function motionWanted(): boolean {
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export interface Flight {
  from: DOMRect;
  to: DOMRect;
  /** The card face to show in flight. Left out for a face-down card. */
  html?: string;
  /** Turns over as it travels, for a card being drawn. */
  flip?: boolean;
  ms?: number;
  delay?: number;
  spin?: number;
}

/** Where a thing is on screen right now, or null if it is not there. */
export function rectOf(el: Element | null | undefined): DOMRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return r.width === 0 && r.height === 0 ? null : r;
}

export function fly(layer: HTMLElement, f: Flight): void {
  if (!motionWanted()) return;
  const el = document.createElement('div');
  el.className = f.html ? 'flyer' : 'flyer back';
  if (f.html) el.innerHTML = f.html;

  const w = f.to.width || f.from.width;
  const h = f.to.height || f.from.height;
  el.style.width = `${w}px`;
  el.style.height = `${h}px`;
  layer.appendChild(el);

  const dx = f.from.left + f.from.width / 2 - (f.to.left + w / 2);
  const dy = f.from.top + f.from.height / 2 - (f.to.top + h / 2);
  el.style.left = `${f.to.left}px`;
  el.style.top = `${f.to.top}px`;

  const spin = f.spin ?? 0;
  el.dataset.born = String(Date.now());
  const anim = el.animate(
    [
      {
        transform: `translate(${dx}px, ${dy}px) scale(${f.flip ? 0.72 : 0.9}) rotateY(${f.flip ? 180 : 0}deg) rotate(0deg)`,
        opacity: 0.2,
      },
      {
        transform: `translate(${dx * 0.35}px, ${dy * 0.35 - 16}px) scale(1.06) rotateY(${f.flip ? 60 : 0}deg) rotate(${spin * 0.6}deg)`,
        opacity: 1,
        offset: 0.55,
      },
      { transform: `translate(0,0) scale(1) rotateY(0deg) rotate(${spin}deg)`, opacity: 1 },
    ],
    {
      duration: f.ms ?? 420,
      delay: f.delay ?? 0,
      easing: 'cubic-bezier(0.22, 0.9, 0.28, 1)',
      fill: 'both',
    },
  );
  anim.onfinish = () => el.remove();
}

/**
 * A card in flight is removed when its animation finishes - but a browser that
 * has the tab in the background will happily pause an animation so it never
 * does, leaving a card stranded on screen. This runs on the match loop and
 * clears anything that has outstayed its welcome, whatever the animation did.
 */
export function sweepFlights(layer: HTMLElement, maxAgeMs = 1600): void {
  const now = Date.now();
  for (const el of Array.from(layer.children)) {
    const born = Number((el as HTMLElement).dataset.born ?? 0);
    if (!born || now - born > maxAgeMs) el.remove();
  }
}

/**
 * FLIP: measure where things were, let the layout change, then animate each one
 * from where it used to be to where it now is.
 */
export function measure(elements: Iterable<HTMLElement>): Map<HTMLElement, DOMRect> {
  const map = new Map<HTMLElement, DOMRect>();
  for (const el of elements) map.set(el, el.getBoundingClientRect());
  return map;
}

export function slideFrom(before: Map<HTMLElement, DOMRect>, ms = 260): void {
  if (!motionWanted()) return;
  for (const [el, was] of before) {
    if (!el.isConnected) continue;
    const now = el.getBoundingClientRect();
    const dx = was.left - now.left;
    const dy = was.top - now.top;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }],
      { duration: ms, easing: 'cubic-bezier(0.22, 0.9, 0.28, 1)' },
    );
  }
}
