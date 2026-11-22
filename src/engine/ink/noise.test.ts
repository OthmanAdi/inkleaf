import { describe, expect, it } from 'vitest';
import { hash, noise1, noise3, S01, smoothstep } from './noise';

describe('hash and value noise', () => {
  it('hash is deterministic and lies in [0, 1)', () => {
    const a = [0, 1, 2, 7919, -5, 123456789].map(hash);
    const b = [0, 1, 2, 7919, -5, 123456789].map(hash);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('hash follows the xor / multiply-xorshift recipe', () => {
    // (0 ^ 0x9E3779B9) then two multiply-xorshift rounds, computed by hand with 32-bit integer maths
    let t = 0 ^ 0x9e3779b9;
    t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
    t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
    t ^= t >>> 16;
    expect(hash(0)).toBe((t >>> 0) / 2 ** 32);
    expect(hash(1)).not.toBe(hash(0));
  });

  it('hash spreads values evenly', () => {
    let sum = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) sum += hash(i);
    expect(sum / n).toBeCloseTo(0.5, 1);
  });

  it('1D noise hits the lattice values at integers and is continuous', () => {
    expect(noise1(3, 5)).toBe(hash(3 * 7919 + 5));
    expect(noise1(3, 5.999999)).toBeCloseTo(hash(3 * 7919 + 6), 4);
    const mid = noise1(3, 5.5);
    expect(mid).toBeCloseTo((hash(3 * 7919 + 5) + hash(3 * 7919 + 6)) / 2, 10);
  });

  it('noise is deterministic per seed and differs between seeds', () => {
    expect(noise1(7, 2.3)).toBe(noise1(7, 2.3));
    expect(noise3(1.2, 3.4, 5.6, 9)).toBe(noise3(1.2, 3.4, 5.6, 9));
    expect(noise3(1.2, 3.4, 5.6, 9)).not.toBe(noise3(1.2, 3.4, 5.6, 10));
    const v = noise3(-4.5, 0.25, 17.75, 3);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('smoothstep helpers', () => {
    expect(S01(0.5)).toBe(0.5);
    expect(S01(-1)).toBe(0);
    expect(S01(2)).toBe(1);
    expect(smoothstep(0, 0.35, 0.175)).toBeCloseTo(0.5, 10);
  });
});
