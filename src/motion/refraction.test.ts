import { describe, expect, it } from 'vitest';
import { createRefractionMap, lensSampleRadius, resolveOptics } from './refraction';
import { magnifierZoomAt } from '../demo/motion';

describe('optical detail', () => {
  it('preserves an unwarped sample when both optical effects are disabled', () => {
    const source = Uint8ClampedArray.from({ length: 64 }, (_, index) => index * 4);
    const out = new Uint8ClampedArray(source.length);
    createRefractionMap(4, resolveOptics({ refraction: 0, dispersion: 0 }))(source, out);
    expect(out).toEqual(source);
  });

  it('leaves the center fixed and separates color channels at the curved edge', () => {
    expect(lensSampleRadius(0, 0.38, 0.025)).toBe(0);
    expect(lensSampleRadius(0.9, 0.38, 0.025)).toBeGreaterThan(lensSampleRadius(0.9, 0.38, -0.025));
    expect(lensSampleRadius(0.9, 0.38)).toBeLessThan(0.9);
    expect(resolveOptics({ zoom: Infinity, refraction: -1, dispersion: 7 })).toEqual({ zoom: 2, refraction: 0, dispersion: 0.12 });
  });

  it('samples the same magnification again after seeking to a later frame', () => {
    const midpoint = magnifierZoomAt(24);
    expect(midpoint).toBeGreaterThan(magnifierZoomAt(0));
    expect(magnifierZoomAt(48)).toBe(2);
    expect(magnifierZoomAt(24)).toBe(midpoint);
  });
});
