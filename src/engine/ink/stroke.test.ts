import { describe, expect, it } from 'vitest';
import { FloatBuf, polylineLength, resample, STROKE_DEFAULTS, widthProfile } from './stroke';

describe('stroke width profile', () => {
  it('stays within 0.8 .. 1.26 without taper', () => {
    let lo = Infinity, hi = -Infinity;
    for (let seed = 0; seed < 40; seed++) {
      for (let s = 0; s < 400; s += 0.7) {
        const f = widthProfile(s, 400, seed, false);
        lo = Math.min(lo, f);
        hi = Math.max(hi, f);
      }
    }
    expect(lo).toBeGreaterThanOrEqual(0.8);
    expect(hi).toBeLessThanOrEqual(1.26);
    expect(lo).toBeLessThan(0.86);
    expect(hi).toBeGreaterThan(1.18);
  });

  it('tapers both ends from 42 % to full weight over 4.5 mm', () => {
    const L = 50, seed = 5;
    const plain = (s: number) => widthProfile(s, L, seed, false);
    expect(widthProfile(0, L, seed, true) / plain(0)).toBeCloseTo(0.42, 10);
    expect(widthProfile(L, L, seed, true) / plain(L)).toBeCloseTo(0.42, 10);
    expect(widthProfile(2.25, L, seed, true) / plain(2.25)).toBeCloseTo(0.42 + 0.58 * 0.5, 10);
    expect(widthProfile(4.5, L, seed, true) / plain(4.5)).toBeCloseTo(1, 10);
    expect(widthProfile(25, L, seed, true) / plain(25)).toBeCloseTo(1, 10);
  });

  it('a stroke shorter than 9 mm never reaches full weight', () => {
    const r = widthProfile(2, 4, 1, true) / widthProfile(2, 4, 1, false);
    expect(r).toBeCloseTo((0.42 + 0.58 * (2 / 4.5)) ** 2, 10);
  });

  it('is deterministic per seed', () => {
    expect(widthProfile(12.3, 80, 9, true)).toBe(widthProfile(12.3, 80, 9, true));
    expect(widthProfile(12.3, 80, 9, true)).not.toBe(widthProfile(12.3, 80, 10, true));
  });
});

describe('resampling', () => {
  const P = (x: number, y = 0, z = 0) => ({ x, y, z });

  it('splits each segment into ceil(len / maxSeg) equal parts', () => {
    const out = resample([P(0), P(10)], 1.6, false, 0, new FloatBuf());
    expect(out.points).toBe(1 + Math.ceil(10 / 1.6));
    const a = out.a;
    for (let i = 1; i < out.points; i++) expect(a[i * 3]! - a[(i - 1) * 3]!).toBeCloseTo(10 / 7, 5);
  });

  it('keeps short segments whole and uses the 1.6 mm default', () => {
    expect(STROKE_DEFAULTS.maxSeg).toBe(1.6);
    expect(resample([P(0), P(1), P(2)], 1.6, false, 0, new FloatBuf()).points).toBe(3);
  });

  it('closes a loop by appending the first point', () => {
    const out = resample([P(0), P(1), P(1, 1), P(0, 1)], 5, true, 0, new FloatBuf());
    expect(out.points).toBe(5);
    expect(out.a[12]).toBe(0);
    expect(out.a[13]).toBe(0);
  });

  it('overshoot extends both ends along their tangents', () => {
    const out = resample([P(0), P(10)], 100, false, 1.2, new FloatBuf());
    expect(out.a[0]).toBeCloseTo(-1.2, 5);
    expect(out.a[3]).toBeCloseTo(11.2, 5);
  });

  it('measures polylines', () => {
    expect(polylineLength([P(0), P(3, 4)])).toBe(5);
    expect(polylineLength([P(0), P(1), P(1, 1), P(0, 1)], true)).toBe(4);
  });
});
