/**
 * Input thresholds and the small pure pieces of gesture logic: click slop by pointer type, flick detection, the
 * touch picking probes and the wheel accumulator (one page turn per continuous wheel or trackpad gesture).
 */
import type { Registry } from '../core/registry';
import { tunable, type Tuned } from '../core/tune';

const SRC = 'src/engine/input/gesture.ts';

export const POINTER = {
  slopMouse: { value: 6, min: 0, max: 40, step: 1, unit: 'px', help: 'A mouse press that moves less than this is a click' },
  slopPen: { value: 8, min: 0, max: 40, step: 1, unit: 'px', help: 'Click slop for a pen' },
  slopTouch: { value: 12, min: 0, max: 60, step: 1, unit: 'px', help: 'Click slop for a finger' },
  touchGrow: { value: 2.5, min: 0, max: 20, step: 0.1, unit: 'mm', help: 'Page hit regions grow by this much for fingers' },
  probeNear: { value: 10, min: 0, max: 40, step: 1, unit: 'px', help: 'Touch picking: straight probe offset' },
  probeDiag: { value: 8, min: 0, max: 40, step: 1, unit: 'px', help: 'Touch picking: diagonal probe offset' },
  probeFar: { value: 14, min: 0, max: 60, step: 1, unit: 'px', help: 'Touch picking: outer probe offset' },
};
export const FLICK = {
  enabled: { value: true, help: 'A quick horizontal flick turns the page' },
  maxMs: { value: 350, min: 50, max: 2000, step: 10, unit: 'ms', help: 'A flick is shorter than this' },
  minPx: { value: 70, min: 5, max: 600, step: 1, unit: 'px', help: 'A flick travels further than this horizontally' },
};
export const WHEEL = {
  enabled: { value: true, help: 'The wheel or a trackpad swipe turns pages' },
  threshold: { value: 90, min: 1, max: 1000, step: 1, unit: 'px', help: 'Accumulated scroll that turns one page' },
  quietMs: { value: 300, min: 50, max: 3000, step: 10, unit: 'ms', help: 'A pause this long ends the gesture (one turn per gesture)' },
};
export const KEYS = {
  enabled: { value: true, help: 'Arrow keys and Page Up/Down turn pages' },
};
export const LONG_PRESS = {
  ms: { value: 480, min: 100, max: 3000, step: 10, unit: 'ms', help: 'Holding a finger on readable text this long shows the magnifier' },
};

export interface InputConfig {
  pointer: Tuned<typeof POINTER>;
  flick: Tuned<typeof FLICK>;
  wheel: Tuned<typeof WHEEL>;
  keys: Tuned<typeof KEYS>;
  longPress: Tuned<typeof LONG_PRESS>;
}

export function registerInputConfig(registry: Registry): InputConfig {
  const t = <P extends Record<string, import('../core/tune').Def>>(id: string, label: string, tags: string[], describe: string, params: P) =>
    tunable(registry, { id, label, tags, kind: 'input-control', describe, source: SRC, params });
  return {
    pointer: t('input.pointer', 'Pointer thresholds', ['input', 'control'], 'Click slop per pointer type, touch picking probes and touch region growth.', POINTER),
    flick: t('input.flick', 'Flick to turn', ['input', 'control'], 'A quick horizontal flick on the canvas turns the page: left flick = next.', FLICK),
    wheel: t('input.wheel', 'Wheel page turn', ['input', 'control'], 'Wheel and trackpad scrolling accumulate along the dominant axis; past the threshold one page turns, then the gesture is locked until it pauses.', WHEEL),
    keys: t('input.keys', 'Keyboard navigation', ['input', 'control', 'a11y'], 'ArrowRight/PageDown next, ArrowLeft/PageUp previous; Space pauses and Escape stops a tour.', KEYS),
    longPress: t('input.long-press', 'Long press for the magnifier', ['input', 'control', 'lens'], 'On touch screens the magnifier appears after holding a finger still on readable text.', LONG_PRESS),
  };
}

export type PointerKind = 'mouse' | 'pen' | 'touch';

export function slopFor(type: string, c: Pick<Tuned<typeof POINTER>, 'slopMouse' | 'slopPen' | 'slopTouch'>): number {
  return type === 'touch' ? c.slopTouch : type === 'pen' ? c.slopPen : c.slopMouse;
}

/** A flick: short press, long horizontal travel. Returns +1 (next, finger moved left), -1 (previous) or 0. */
export function flickDirection(durationMs: number, dx: number, c: { enabled: boolean; maxMs: number; minPx: number }): -1 | 0 | 1 {
  if (!c.enabled || durationMs >= c.maxMs || Math.abs(dx) <= c.minPx) return 0;
  return dx < 0 ? 1 : -1;
}

/** The 13 touch probe offsets in order: centre, near straight, diagonals, far straight. */
export function touchProbes(c: { probeNear: number; probeDiag: number; probeFar: number }): [number, number][] {
  const n = c.probeNear, d = c.probeDiag, f = c.probeFar;
  return [[0, 0], [n, 0], [-n, 0], [0, n], [0, -n], [d, d], [-d, d], [d, -d], [-d, -d], [f, 0], [-f, 0], [0, f], [0, -f]];
}

/** One page turn per continuous wheel gesture: accumulate the dominant axis, turn past the threshold, then lock. */
export class WheelAccumulator {
  acc = 0;
  locked = false;
  private last = -Infinity;
  constructor(private readonly c: { threshold: number; quietMs: number }) {}

  /** Feeds one wheel event at time `now` (ms). Returns +1 (next), -1 (previous) or 0. */
  push(dx: number, dy: number, now: number): -1 | 0 | 1 {
    this.quiet(now);
    this.last = now;
    if (this.locked) return 0;
    this.acc += Math.abs(dx) > Math.abs(dy) ? dx : dy;
    if (Math.abs(this.acc) > this.c.threshold) {
      const dir = this.acc > 0 ? 1 : -1;
      this.acc = 0;
      this.locked = true;
      return dir;
    }
    return 0;
  }

  /** Locks the current gesture without turning (used when the wheel skips the opening). */
  lock(now: number): void {
    this.quiet(now);
    this.last = now;
    this.locked = true;
  }

  private quiet(now: number): void {
    if (now - this.last > this.c.quietMs) {
      this.acc = 0;
      this.locked = false;
    }
  }
}

/** True for elements where keys type text (inputs other than buttons, radios and checkboxes; textareas; selects; editable). */
export function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color'].includes((el as HTMLInputElement).type);
  return (el as HTMLElement).isContentEditable === true;
}
