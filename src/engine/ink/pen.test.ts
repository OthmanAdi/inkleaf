import { describe, expect, it } from 'vitest';
import { createPen, Pen, PEN_DEFAULTS, PEN_PRESETS } from './pen';

describe('pen scheduler', () => {
  it('uses the measured defaults', () => {
    expect(PEN_DEFAULTS).toEqual({ speed: 300, gap: 0.035, min: 0.1, max: 0.55 });
  });

  it('starts each stroke `gap` after the previous START and clamps durations', () => {
    const pen = new Pen();
    const a = pen.next(60);
    const b = pen.next(3);
    const c = pen.next(600);
    expect(a).toEqual({ t0: 0, dur: 0.2 });
    expect(b.t0).toBeCloseTo(0.035, 10);
    expect(b.dur).toBe(0.1);
    expect(c.t0).toBeCloseTo(0.07, 10);
    expect(c.dur).toBe(0.55);
    expect(pen.end).toBeCloseTo(0.62, 10);
  });

  it('delay and pause shift later strokes', () => {
    const pen = new Pen({ gap: 0.02 });
    pen.next(30);
    pen.pause(0.5);
    const s = pen.next(30, 0.1);
    expect(s.t0).toBeCloseTo(0.62, 10);
  });

  it('fit rescales every issued schedule in place to end at T', () => {
    const pen = createPen({ preset: 'lesson-1' });
    const issued = Array.from({ length: 40 }, (_, i) => pen.next(10 + i * 7));
    const before = issued.map((s) => ({ ...s }));
    const k = 1.15 / pen.end;
    pen.fit(1.15);
    expect(pen.end).toBeCloseTo(1.15, 10);
    issued.forEach((s, i) => {
      expect(s.t0).toBeCloseTo(before[i]!.t0 * k, 10);
      expect(s.dur).toBeCloseTo(before[i]!.dur * k, 10);
    });
  });

  it('carries the per-lesson settings as presets', () => {
    expect(PEN_PRESETS['lesson-1']).toMatchObject({ speed: 340, gap: 0.016, max: 0.42, fit: 1.15 });
    expect(PEN_PRESETS['lesson-3']).toMatchObject({ speed: 320, gap: 0.012, max: 0.4, fit: 1.1 });
    expect(PEN_PRESETS['lesson-6']).toMatchObject({ speed: 330, gap: 0.014, max: 0.4, fit: 1.15 });
    expect(PEN_PRESETS['lesson-8-sub']).toMatchObject({ speed: 300, gap: 0.012, max: 0.4, fit: 0.95 });
    expect(PEN_PRESETS['lesson-9-switch']).toMatchObject({ speed: 260, gap: 0.02, max: 0.3, fit: 0.62 });
    expect(PEN_PRESETS.ramp).toMatchObject({ speed: 300, gap: 0.028, fit: 1.1 });
    const p = createPen({ preset: 'lesson-1', gap: 0.05 });
    expect(p.speed).toBe(340);
    expect(p.gap).toBe(0.05);
  });
});
