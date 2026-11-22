/**
 * The frame clock: turns requestAnimationFrame timestamps into clamped frame steps. A long frame advances motion by
 * at most `maxDt` (slow devices see slow motion, not jumps); a hidden document produces no frame and resets the
 * reference time so the first visible frame does not jump.
 */
import type { FrameInfo } from '../contracts';

export const DT_MAX = 0.05;

export const clampDt = (ms: number, maxDt = DT_MAX): number => {
  const dt = ms / 1000;
  return dt < 0 ? 0 : dt > maxDt ? maxDt : dt;
};

export class FrameClock {
  readonly info: FrameInfo = { dt: 0, time: 0, frame: 0, still: false };
  maxDt = DT_MAX;
  private last: number;

  constructor(now = 0) {
    this.last = now;
  }

  /** Returns the frame info for timestamp `ts`, or null when the document is hidden (nothing should update). */
  tick(ts: number, hidden: boolean, still: boolean): FrameInfo | null {
    if (hidden) {
      this.last = ts;
      return null;
    }
    const dt = clampDt(ts - this.last, this.maxDt);
    this.last = ts;
    const f = this.info;
    f.dt = dt;
    f.time += dt;
    f.still = still;
    return f;
  }

  /** Call after the frame ran. */
  advance(): void {
    this.info.frame++;
  }
}
