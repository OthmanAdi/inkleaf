/**
 * Turn scheduling (pure). `planTurns` decides which leaves move, for how long, with which delays and easings; a
 * `TurnClock` plays one animation at a time on the book clock, writing each leaf's turn fraction.
 */
import { ease } from '../core/ease';
import type { Table, Values } from './params';

export const TURN_TABLE = {
  duration: [1.15, 0.1, 6, 's', 'Seconds for a single page turn (next / previous)'],
  coverFactor: [1.25, 0.5, 3, 'x', 'The cover turning alone takes this multiple of the duration'],
} as const satisfies Table;

export const RIFFLE_TABLE = {
  leafDuration: [0.55, 0.1, 3, 's', 'Seconds per leaf in a multi-page jump'],
  stagger: [0.085, 0, 0.5, 's', 'Delay between consecutive leaves in a jump'],
  window: [1.6, 0.2, 6, 's', 'Stagger shrinks so leaf start times fit in (window - leaf duration)'],
} as const satisfies Table;

export const BOOT_TABLE = {
  duration: [1.1, 0.1, 6, 's', 'Cover duration of the opening move from the closed book'],
  delay: [0.45, 0, 5, 's', 'Wait after the page is ready before the book opens itself (read by the app)'],
  leafFactor: [0.86, 0.1, 2, 'x', 'Leaves after the cover take this multiple of the cover duration'],
  leafDelay: [0.2, 0, 2, 's', 'The first leaf starts this long after the cover'],
  leafStagger: [0.085, 0, 0.5, 's', 'Delay between further leaves of the opening move'],
} as const satisfies Table;

export interface TurnParams {
  turn: Values<typeof TURN_TABLE>;
  riffle: Values<typeof RIFFLE_TABLE>;
  boot: Values<typeof BOOT_TABLE>;
  /** Easing names from core/ease. */
  singleEase: string;
  riffleEase: string;
}

export interface EntrySpec {
  leaf: number;
  to: number;
  dur: number;
  delay: number;
  ease: string;
}

const roundPos = (c: ArrayLike<number>) => {
  let p = 0;
  for (let i = 0; i < c.length; i++) p += c[i]!;
  return Math.round(p);
};

/** The sequence of animations (each a list of leaf entries started together) that takes the book to spread L. */
export function planTurns(c: ArrayLike<number>, L: number, dur: number, p: TurnParams): EntrySpec[][] {
  const q = roundPos(c);
  if (L === q) return [];
  const R = (list: number[], to: number, single: boolean): EntrySpec[] => {
    const n = list.length;
    const K = single ? dur : Math.min(dur, p.riffle.leafDuration);
    const stagger = single ? 0 : Math.max(0, Math.min(p.riffle.stagger, (p.riffle.window - K) / Math.max(1, n - 1)));
    return list.map((leaf, j) => ({
      leaf, to,
      dur: leaf === 0 ? p.turn.coverFactor * dur : K,
      delay: j * stagger,
      ease: single || leaf === 0 ? p.singleEase : p.riffleEase,
    }));
  };
  const out: EntrySpec[][] = [];
  if (L > q) {
    if (q === 0 && L > 1) {
      const anim: EntrySpec[] = [{ leaf: 0, to: 1, dur, delay: 0, ease: p.singleEase }];
      for (let leaf = 1, j = 0; leaf < L; leaf++, j++) {
        anim.push({ leaf, to: 1, dur: p.boot.leafFactor * dur, delay: p.boot.leafDelay + j * p.boot.leafStagger, ease: p.riffleEase });
      }
      return [anim];
    }
    if (q === 0) out.push(R([0], 1, true));
    const list: number[] = [];
    for (let i = Math.max(1, q); i <= L - 1; i++) list.push(i);
    if (list.length) out.push(R(list, 1, list.length === 1));
    return out;
  }
  const list: number[] = [];
  for (let i = q - 1; i >= Math.max(1, L); i--) list.push(i);
  if (list.length) out.push(R(list, 0, list.length === 1));
  if (L === 0) out.push(R([0], 0, true));
  return out;
}

interface Entry { leaf: number; from: number; to: number; dur: number; t0: number; ease: string; done: boolean }

/** Plays one animation at a time on its own clock. */
export class TurnClock {
  time = 0;
  private entries: Entry[] = [];
  private resolve: (() => void) | null = null;

  get active(): boolean {
    return this.entries.length > 0;
  }

  /** Total seconds an animation of these entries lasts. */
  static length(specs: readonly EntrySpec[]): number {
    let t = 0;
    for (const s of specs) t = Math.max(t, s.delay + s.dur);
    return t;
  }

  start(specs: readonly EntrySpec[], c: Float64Array): Promise<void> {
    this.finish();
    if (!specs.length) return Promise.resolve();
    this.entries = specs.map((s) => ({ leaf: s.leaf, from: c[s.leaf] ?? 0, to: s.to, dur: s.dur, t0: this.time + s.delay, ease: s.ease, done: false }));
    return new Promise<void>((r) => (this.resolve = r));
  }

  /** Advances the clock and writes turn fractions. Returns true when any fraction changed. */
  update(dt: number, c: Float64Array, onLand?: (leaf: number, dur: number) => void): boolean {
    this.time += dt;
    if (!this.entries.length) return false;
    let all = true;
    for (const e of this.entries) {
      if (e.done) continue;
      const k = e.dur > 0 ? (this.time - e.t0) / e.dur : 1;
      const t = k < 0 ? 0 : k > 1 ? 1 : k;
      c[e.leaf] = e.from + (e.to - e.from) * ease(e.ease, t);
      if (t >= 1) {
        e.done = true;
        c[e.leaf] = e.to;
        onLand?.(e.leaf, e.dur);
      } else all = false;
    }
    if (all) this.finish();
    return true;
  }

  /** Ends the current animation where it is and resolves its promise. */
  finish(): void {
    this.entries = [];
    const r = this.resolve;
    this.resolve = null;
    r?.();
  }
}
