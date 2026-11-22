import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { blendHalfWidth, flowBlendT, hueBlend, hueDelta, rgbToHsv } from './hue';
import { defaultPalette } from './palette';

const pal = defaultPalette();
const mid = (a: string, b: string) => hueBlend(pal.color(a), pal.color(b), 0.5, new Color());

describe('store palette in linear space', () => {
  it('matches the measured linear values', () => {
    const k = pal.color('kinetic');
    expect(k.r).toBeCloseTo(0.0284, 3);
    expect(k.g).toBeCloseTo(0.1981, 3);
    expect(k.b).toBeCloseTo(1, 4);
    const g = pal.color('gravitational');
    expect([g.r, g.g, g.b].map((v) => +v.toFixed(4))).toEqual([0.2542, 0.0742, 1]);
    const hsv = rgbToHsv(pal.color('thermal'));
    expect(hsv.h).toBeCloseTo(0.0309, 3);
    expect(hsv.s).toBeCloseTo(0.9884, 3);
  });
});

describe('hue-path blend', () => {
  it('gravitational -> kinetic passes through #4640ff', () => {
    expect(hueDelta(pal.color('gravitational'), pal.color('kinetic'))).toBeCloseTo(-0.0615, 3);
    expect(blendHalfWidth(pal.color('gravitational'), pal.color('kinetic'))).toBeCloseTo(0.2933, 3);
    const c = mid('gravitational', 'kinetic');
    expect(c.r).toBeCloseTo(0.0607, 3);
    expect(c.g).toBeCloseTo(0.0513, 3);
    expect(c.b).toBeCloseTo(1, 4);
    expect(c.getHexString()).toBe('4640ff');
  });

  it('kinetic -> thermal goes through magenta (1, 0.02, 0.995), not grey', () => {
    expect(hueDelta(pal.color('kinetic'), pal.color('thermal'))).toBeCloseTo(0.3933, 3);
    expect(blendHalfWidth(pal.color('kinetic'), pal.color('thermal'))).toBeCloseTo(0.05, 6);
    const c = mid('kinetic', 'thermal');
    expect(c.r).toBeCloseTo(1, 3);
    expect(c.g).toBeCloseTo(0.02, 3);
    expect(c.b).toBeCloseTo(0.995, 3);
    expect(c.getHexString()).toBe('ff27fe');
  });

  it.each([
    ['elastic', 'kinetic', -0.2911, [0.7105, 0.0391, 1.0], 'db38ff'],
    ['chemical', 'thermal', -0.3275, [0.6568, 0.7856, 0.0179], 'd4e524'],
    ['chemical', 'gravitational', 0.3407, [0.0425, 0.6576, 0.7856], '3ad4e5'],
    ['nuclear', 'thermal', -0.0725, [1.0, 0.4091, 0.011], 'ffab1b'],
  ] as const)('%s -> %s', (a, b, dh, rgb, hex) => {
    expect(hueDelta(pal.color(a), pal.color(b))).toBeCloseTo(dh, 3);
    const c = mid(a, b);
    expect(c.r).toBeCloseTo(rgb[0], 3);
    expect(c.g).toBeCloseTo(rgb[1], 3);
    expect(c.b).toBeCloseTo(rgb[2], 3);
    expect(c.getHexString()).toBe(hex);
  });

  it('nuclear -> thermal blends over a wide window', () => {
    const hw = blendHalfWidth(pal.color('nuclear'), pal.color('thermal'));
    expect(hw).toBeCloseTo(0.2814, 3);
    expect(flowBlendT(0.5 - hw, hw)).toBe(0);
    expect(flowBlendT(0.5, hw)).toBeCloseTo(0.5, 9);
    expect(flowBlendT(0.5 + hw, hw)).toBe(1);
  });

  it('end points are the source and destination colours', () => {
    const a = pal.color('kinetic');
    const b = pal.color('thermal');
    const c0 = hueBlend(a, b, 0, new Color());
    const c1 = hueBlend(a, b, 1, new Color());
    expect(c0.r).toBeCloseTo(a.r, 9);
    expect(c0.b).toBeCloseTo(a.b, 9);
    expect(c1.r).toBeCloseTo(b.r, 9);
    expect(c1.g).toBeCloseTo(b.g, 9);
  });
});
