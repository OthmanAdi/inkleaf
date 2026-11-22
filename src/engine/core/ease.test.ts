import { describe, expect, it } from 'vitest';
import { EASES, bezier, damp, dampFactor, ease, stepSpring, window01 } from './ease';

describe('easing', () => {
  it('every ease starts at 0 and ends at 1', () => {
    for (const [name, f] of Object.entries(EASES)) {
      expect(f(0), name).toBeCloseTo(0, 6);
      expect(f(1), name).toBeCloseTo(1, 6);
    }
  });

  it('smoothstep is 3t^2 - 2t^3', () => {
    expect(EASES.smoothstep(0.25)).toBeCloseTo(0.15625, 6);
  });

  it('falls back to linear for an unknown name and clamps t', () => {
    expect(ease('nope', 0.3)).toBeCloseTo(0.3);
    expect(ease('inOutCubic', 2)).toBe(1);
  });

  it('bezier matches CSS ease-in-out at the midpoint and the ends', () => {
    const f = bezier(0.42, 0, 0.58, 1);
    expect(f(0)).toBeCloseTo(0, 5);
    expect(f(0.5)).toBeCloseTo(0.5, 4);
    expect(f(1)).toBeCloseTo(1, 5);
  });

  it('damping is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 60; i++) a = damp(a, 1, 1 / 60, 0.2);
    let b = 0;
    for (let i = 0; i < 30; i++) b = damp(b, 1, 1 / 30, 0.2);
    expect(a).toBeCloseTo(b, 6);
    expect(a).toBeCloseTo(1 - Math.exp(-5), 6);
    expect(dampFactor(0.1, 0)).toBe(1);
  });

  it('a critically damped spring settles without overshoot', () => {
    const s = { x: 0, v: 0 };
    let max = 0;
    for (let i = 0; i < 120; i++) {
      stepSpring(s, 1, 1 / 60, 12, 1);
      max = Math.max(max, s.x);
    }
    expect(s.x).toBeCloseTo(1, 3);
    expect(max).toBeLessThanOrEqual(1.0001);
  });

  it('window01 maps a time window to 0..1', () => {
    expect(window01(0.5, 0, 1)).toBe(0.5);
    expect(window01(-1, 0, 1)).toBe(0);
    expect(window01(0.7, 0.6, 0.8)).toBeCloseTo(0.5);
  });
});
