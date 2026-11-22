import { describe, expect, it } from 'vitest';
import { toneNeutral, vignetteFactor, TONE_DEFAULTS } from './tone';

const grey = (v: number) => toneNeutral([v, v, v])[0];

describe('hue-preserving neutral tone map', () => {
  it('matches the measured grey samples at exposure 0.9', () => {
    expect(grey(0.5)).toBeCloseTo(0.41, 4);
    expect(grey(1)).toBeCloseTo(0.8306, 4);
    expect(grey(2)).toBeCloseTo(0.9535, 4);
    expect(grey(4)).toBeCloseTo(0.981, 3);
  });

  it('crushes the toe quadratically below 0.08 (after exposure)', () => {
    const x = 0.05;
    expect(grey(x / 0.9)).toBeCloseTo(6.25 * x * x, 10);
    expect(grey(0)).toBe(0);
    expect(grey(-1)).toBe(0);
  });

  it('is continuous at the toe and at the compression start', () => {
    const t = 0.08 / 0.9;
    expect(grey(t - 1e-9)).toBeCloseTo(grey(t + 1e-9), 6);
    const s = (0.76 + 0.04) / 0.9;
    expect(grey(s - 1e-9)).toBeCloseTo(grey(s + 1e-9), 6);
  });

  it('keeps the hue of saturated highlights (channel ratios before the grey mix)', () => {
    const [r, g, b] = toneNeutral([4, 2, 0.5]);
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
    expect(Math.max(r, g, b)).toBeLessThan(1);
  });

  it('desaturates highlights a little toward the new peak', () => {
    const lowDesat = toneNeutral([6, 0.2, 0.2], { ...TONE_DEFAULTS, desaturation: 0 });
    const ours = toneNeutral([6, 0.2, 0.2]);
    expect(ours[1]).toBeGreaterThan(lowDesat[1]);
    expect(ours[0]).toBeCloseTo(lowDesat[0], 10);
  });

  it('follows exposure', () => {
    expect(toneNeutral([0.5, 0.5, 0.5], { ...TONE_DEFAULTS, exposure: 1 })[0]).toBeCloseTo(0.46, 10);
  });
});

describe('vignette factor', () => {
  it('matches the measured falloff (offset 0.24, darkness 0.52)', () => {
    expect(vignetteFactor(0.2)).toBe(1);
    expect(vignetteFactor(0.2523)).toBeCloseTo(1, 3);
    expect(vignetteFactor(0.4)).toBeCloseTo(0.91, 3);
    expect(vignetteFactor(0.5)).toBeCloseTo(0.772, 3);
    expect(vignetteFactor(Math.SQRT1_2)).toBeCloseTo(0.398, 3);
  });
});
