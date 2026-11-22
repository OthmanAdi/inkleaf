import { describe, expect, it } from 'vitest';
import { fbm, fnv1a, gradientNoise, heightToNormal, lcg } from './noise';

describe('lcg', () => {
  it('advances first, then returns state / 2^32', () => {
    const r = lcg(1);
    expect(r()).toBe(((1664525 + 1013904223) >>> 0) / 4294967296);
  });

  it('treats seed 0 as 1', () => {
    const a = lcg(0), b = lcg(1);
    for (let i = 0; i < 5; i++) expect(a()).toBe(b());
  });

  it('matches a plain mod-2^32 multiply-add (BigInt reference)', () => {
    const r = lcg(162);
    let t = 162n;
    for (let i = 0; i < 1000; i++) {
      t = (t * 1664525n + 1013904223n) % 4294967296n;
      expect(r()).toBe(Number(t) / 4294967296);
    }
  });

  it('is deterministic per seed', () => {
    const a = lcg(4898), b = lcg(4898);
    const xs = Array.from({ length: 50 }, () => a());
    expect(xs).toEqual(Array.from({ length: 50 }, () => b()));
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe('gradientNoise', () => {
  it('is zero at lattice points', () => {
    const n = gradientNoise(5);
    for (const [x, y] of [[0, 0], [3, 7], [-4, 12], [255, 1]] as const) expect(n(x, y)).toBe(0);
  });

  it('is deterministic and seed dependent', () => {
    const a = gradientNoise(16), b = gradientNoise(16), c = gradientNoise(17);
    expect(a(1.37, 2.81)).toBe(b(1.37, 2.81));
    expect(a(1.37, 2.81)).not.toBe(c(1.37, 2.81));
  });

  it('tiles with its period', () => {
    const n = gradientNoise(24, 24);
    for (const [x, y] of [[0.3, 0.7], [5.5, 11.25], [23.9, 0.1]] as const) {
      expect(n(x + 24, y)).toBeCloseTo(n(x, y), 12);
      expect(n(x, y - 48)).toBeCloseTo(n(x, y), 12);
    }
  });

  it('stays roughly within [-1, 1]', () => {
    const n = gradientNoise(42);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 20000; i++) {
      const v = n(i * 0.173, i * 0.0911);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    expect(lo).toBeGreaterThan(-1.05);
    expect(hi).toBeLessThan(1.05);
    expect(hi - lo).toBeGreaterThan(1);
  });

  it('locks a few values of our own output', () => {
    const n = gradientNoise(5);
    expect(n(0.5, 0.5)).toBeCloseTo(LOCK.n5a, 12);
    expect(n(10.25, 3.75)).toBeCloseTo(LOCK.n5b, 12);
  });
});

describe('fbm', () => {
  it('normalises by the weight sum', () => {
    const one = () => 1;
    expect(fbm(one, 0.3, 0.3, 4, 0.5)).toBe(1);
    expect(fbm(one, 0.3, 0.3, 2, 0.5)).toBe(1);
  });
});

describe('heightToNormal', () => {
  it('maps a flat field to (127.5, 127.5, 255) rounded to even', () => {
    const out = heightToNormal(new Float32Array(9), 3, 3, 1, false);
    expect([...out.slice(0, 4)]).toEqual([128, 128, 255, 255]);
  });

  it('tilts away from a rising slope', () => {
    const h = new Float32Array([0, 1, 2, 0, 1, 2, 0, 1, 2]);
    const out = heightToNormal(h, 3, 3, 1, false);
    expect(out[4 * 4]!).toBeLessThan(128);
  });
});

describe('fnv1a', () => {
  it('fingerprints bytes', () => {
    expect(fnv1a([])).toBe('811c9dc5');
    expect(fnv1a([97])).toBe('e40c292c');
  });
});

const LOCK = { n5a: 0.11035174872726201, n5b: -0.34002681934137496 };
