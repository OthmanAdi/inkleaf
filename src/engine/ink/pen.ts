/**
 * The invisible pen that times a figure's strokes. Each stroke starts `gap` seconds after the previous stroke
 * STARTED and lasts `clamp(length / speed, min, max)`, so many strokes are in flight at once (a quick scribbled
 * build-up). `fit(T)` rescales every issued schedule in place so the whole pen body lasts exactly T seconds.
 */
import type { PenSchedule, PenScheduler } from '../contracts';

export interface PenOptions {
  /** Pen speed in mm/s. */
  speed?: number;
  /** Seconds between the starts of consecutive strokes. */
  gap?: number;
  /** Shortest stroke duration (s). */
  min?: number;
  /** Longest stroke duration (s). */
  max?: number;
}

export interface PenPreset extends Required<PenOptions> {
  /** Seconds the pen body is fitted to after building (`null` = no fit). */
  fit: number | null;
  /** One line on where this timing style suits. */
  help: string;
}

export const PEN_DEFAULTS: Required<PenOptions> = { speed: 300, gap: 0.035, min: 0.1, max: 0.55 };

/**
 * Measured pen timing styles of a ten-lesson reference book, keyed by its lesson numbering (which does not equal
 * the displayed lesson number in every case), plus the helper styles. Pick by name in `pen({ preset })`.
 */
export const PEN_PRESETS: Readonly<Record<string, PenPreset>> = {
  default: { ...PEN_DEFAULTS, fit: null, help: 'Engine defaults, no fit: slow and even.' },
  'lesson-1': { speed: 340, gap: 0.016, min: 0.1, max: 0.42, fit: 1.15, help: 'A crowded scene of many small things: fast pen, tight stagger.' },
  'lesson-3': { speed: 320, gap: 0.012, min: 0.1, max: 0.4, fit: 1.1, help: 'A single apparatus.' },
  'lesson-4': { speed: 320, gap: 0.012, min: 0.1, max: 0.4, fit: 1.1, help: 'A single apparatus.' },
  'lesson-5': { speed: 320, gap: 0.016, min: 0.1, max: 0.42, fit: 1.15, help: 'An apparatus with long strokes.' },
  'lesson-6': { speed: 330, gap: 0.014, min: 0.1, max: 0.4, fit: 1.15, help: 'A brisk medium scene.' },
  'lesson-7': { speed: 320, gap: 0.012, min: 0.1, max: 0.4, fit: 1.1, help: 'A single apparatus.' },
  'lesson-8': { speed: 320, gap: 0.012, min: 0.1, max: 0.4, fit: 1.1, help: 'A single apparatus with swappable parts.' },
  'lesson-8-sub': { speed: 300, gap: 0.012, min: 0.1, max: 0.4, fit: 0.95, help: 'A swapped sub-assembly redrawn on its own clock.' },
  'lesson-9': { speed: 320, gap: 0.014, min: 0.1, max: 0.42, fit: 1.15, help: 'A medium scene.' },
  'lesson-9-switch': { speed: 260, gap: 0.02, min: 0.1, max: 0.3, fit: 0.62, help: 'A switchable item redrawn when a switch changes.' },
  'lesson-10': { speed: 330, gap: 0.012, min: 0.1, max: 0.4, fit: 1.15, help: 'A brisk medium scene.' },
  ramp: { speed: 300, gap: 0.028, min: 0.1, max: 0.55, fit: 1.1, help: 'A ramp or track helper.' },
};

export class Pen implements PenScheduler {
  speed: number;
  gap: number;
  min: number;
  max: number;
  /** Start time of the next stroke. */
  t = 0;
  readonly issued: PenSchedule[] = [];

  constructor(opts: PenOptions = {}) {
    this.speed = opts.speed ?? PEN_DEFAULTS.speed;
    this.gap = opts.gap ?? PEN_DEFAULTS.gap;
    this.min = opts.min ?? PEN_DEFAULTS.min;
    this.max = opts.max ?? PEN_DEFAULTS.max;
  }

  /** Schedules a stroke of `lengthMm`, optionally `delay` seconds after the current pen time. */
  next(lengthMm: number, delay = 0): PenSchedule {
    const t0 = this.t + delay;
    const dur = Math.min(this.max, Math.max(this.min, Math.max(0, lengthMm) / this.speed));
    const s = { t0, dur };
    this.t = t0 + this.gap;
    this.issued.push(s);
    return s;
  }

  /** Holds the pen still for `seconds` before the next stroke starts. */
  pause(seconds: number): void {
    this.t += seconds;
  }

  /** Latest stroke end over everything issued. */
  get end(): number {
    let e = 0;
    for (const s of this.issued) e = Math.max(e, s.t0 + s.dur);
    return e;
  }

  /** Rescales every issued start and duration in place so the pen body ends at `totalSeconds`. */
  fit(totalSeconds: number): void {
    const e = this.end;
    if (e <= 0 || !(totalSeconds > 0)) return;
    const k = totalSeconds / e;
    for (const s of this.issued) {
      s.t0 *= k;
      s.dur *= k;
    }
    this.t *= k;
  }
}

/** Creates a pen from options or a preset name (`pen('lesson-1')`); explicit options override the preset. */
export function createPen(opts: PenOptions & { preset?: string } = {}): Pen & { preset: PenPreset | null } {
  const preset = opts.preset ? PEN_PRESETS[opts.preset] ?? null : null;
  const pen = new Pen({ ...(preset ?? {}), ...stripUndefined(opts) }) as Pen & { preset: PenPreset | null };
  pen.preset = preset;
  return pen;
}

function stripUndefined(o: PenOptions & { preset?: string }): PenOptions {
  const out: PenOptions = {};
  if (o.speed !== undefined) out.speed = o.speed;
  if (o.gap !== undefined) out.gap = o.gap;
  if (o.min !== undefined) out.min = o.min;
  if (o.max !== undefined) out.max = o.max;
  return out;
}
