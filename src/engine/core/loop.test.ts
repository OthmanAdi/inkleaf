import { describe, expect, it } from 'vitest';
import { FrameClock, clampDt } from './clock';
import { createEmitter } from './emitter';
import type { EngineEvents } from '../contracts';

describe('frame clock', () => {
  it('clamps dt to [0, 0.05] s', () => {
    expect(clampDt(16)).toBeCloseTo(0.016, 10);
    expect(clampDt(500)).toBe(0.05);
    expect(clampDt(-3)).toBe(0);
  });

  it('skips hidden frames and resets the reference time', () => {
    const c = new FrameClock(0);
    expect(c.tick(16, false, false)!.dt).toBeCloseTo(0.016, 10);
    c.advance();
    expect(c.tick(5000, true, false)).toBeNull();
    const f = c.tick(5016, false, false)!;
    expect(f.dt).toBeCloseTo(0.016, 10);
    expect(f.time).toBeCloseTo(0.032, 10);
    expect(f.frame).toBe(1);
  });

  it('sums clamped steps into time', () => {
    const c = new FrameClock(0);
    c.tick(1000, false, true);
    expect(c.info.time).toBe(0.05);
    expect(c.info.still).toBe(true);
  });
});

describe('key shadow turn easing', () => {
  // The loop does x += (target - x)(1 - exp(-dt / 0.12)); check it against the closed form and the trace.
  const ease = (x0: number, target: number, frames: number, dt = 1 / 60) => {
    let x = x0;
    for (let i = 0; i < frames; i++) x += (target - x) * (1 - Math.exp(-dt / 0.12));
    return x;
  };

  it('follows x(t) = 0.42 + (x0 - 0.42) e^(-t / 0.12)', () => {
    for (const n of [1, 10, 30, 66]) expect(ease(1, 0.42, n)).toBeCloseTo(0.42 + 0.58 * Math.exp(-n / 60 / 0.12), 10);
  });

  it('matches the restore trace: 0.42 -> 0.4958 after one 16.6 ms frame, about 95 % of the way in 0.36 s', () => {
    expect(ease(0.42, 1, 1, 0.0166)).toBeCloseTo(0.4958, 2);
    expect((ease(0.42, 1, 18, 0.02) - 0.42) / 0.58).toBeCloseTo(0.95, 2);
  });
});

describe('emitter', () => {
  it('delivers typed payloads and unsubscribes', () => {
    const e = createEmitter<EngineEvents>();
    const got: number[] = [];
    const off = e.on('turn-end', (p) => got.push(p.spread));
    e.emit('turn-end', { spread: 3 });
    off();
    e.emit('turn-end', { spread: 4 });
    expect(got).toEqual([3]);
  });

  it('tolerates unsubscribing during emit', () => {
    const e = createEmitter<EngineEvents>();
    const got: string[] = [];
    const offA = e.on('still', () => {
      got.push('a');
      offA();
    });
    e.on('still', () => got.push('b'));
    e.emit('still', { on: true });
    e.emit('still', { on: false });
    expect(got).toEqual(['a', 'b', 'b']);
  });
});
