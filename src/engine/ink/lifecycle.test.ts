import { describe, expect, it } from 'vitest';
import { peelAt, shadeAt, undrawAt, undrawDuration } from './lifecycle';

describe('pop life cycle timings', () => {
  it('peel: the print fades out with 1 - S(t / 0.28)', () => {
    expect(peelAt(0).printAlpha).toBe(1);
    expect(peelAt(0.14).printAlpha).toBeCloseTo(0.5, 10);
    expect(peelAt(0.14).copyAlpha).toBeCloseTo(0.5, 10);
    expect(peelAt(0.28).printAlpha).toBe(0);
    // measured samples of the boot trace
    expect(peelAt(0.1).printAlpha).toBeCloseTo(0.7075, 2);
    expect(peelAt(0.15).printAlpha).toBeCloseTo(0.4455, 2);
  });

  it('shade: surfaces fade in with S(t / 0.45)', () => {
    expect(shadeAt(0.225).surfaces).toBeCloseTo(0.5, 10);
    expect(shadeAt(0.2).surfaces).toBeCloseTo(0.417, 3);
    expect(shadeAt(0.44).done).toBe(false);
    expect(shadeAt(0.45).done).toBe(true);
  });

  it('undraw: 0.15 s linear surface fade, 0.35 s fold, print back over the last 22 %', () => {
    expect(undrawDuration()).toBeCloseTo(0.5, 10);
    const a = undrawAt(0.075);
    expect(a.surfaces).toBeCloseTo(0.5, 10);
    expect(a.lift).toBe(1);
    const b = undrawAt(0.15 + 0.175);
    expect(b.r).toBeCloseTo(0.5, 10);
    expect(b.lift).toBeCloseTo(0.5, 10);
    expect(b.printAlpha).toBe(0);
    const c = undrawAt(0.15 + 0.35 * 0.89);
    expect(c.printAlpha).toBeCloseTo(0.5, 10);
    expect(c.standAlpha).toBeCloseTo(0.5, 10);
    const d = undrawAt(0.5);
    expect(d.done).toBe(true);
    expect(d.lift).toBe(0);
    expect(d.printAlpha).toBe(1);
    expect(d.standAlpha).toBe(0);
    expect(undrawAt(0.49).done).toBe(false);
  });

  it('the print starts returning at t = 0.423 s', () => {
    expect(undrawAt(0.4229).printAlpha).toBe(0);
    expect(undrawAt(0.425).printAlpha).toBeGreaterThan(0);
  });
});
