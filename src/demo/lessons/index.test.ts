import { describe, expect, it } from 'vitest';
import { bounceState, catapultState, heatingState, interactiveLessons } from './index';

describe('interactive lesson sampling contract', () => {
  it('has seven distinct lessons with valid predictions and actions', () => {
    expect(new Set(interactiveLessons.map(lesson => lesson.kind)).size).toBe(7);
    for (const lesson of interactiveLessons) {
      expect(lesson.prediction.options[lesson.prediction.correct]).toBeTruthy();
      expect(lesson.action.length).toBeGreaterThan(5);
      expect(lesson.settings.options.length).toBeGreaterThan(1);
    }
  });

  it('samples deterministically with finite normalized poses, including invalid inputs', () => {
    for (const lesson of interactiveLessons) {
      for (const setting of [-1, ...lesson.settings.options.map((_, index) => index), 100, NaN]) {
        for (const seconds of [-10, 0, 0.01, lesson.duration / 2, lesson.duration, 1e6, NaN]) {
          const sample = lesson.sample(seconds, setting);
          expect(lesson.sample(seconds, setting)).toEqual(sample);
          for (const channel of Object.values(sample.pose)) {
            expect(Number.isFinite(channel)).toBe(true);
            expect(channel).toBeGreaterThanOrEqual(0);
            expect(channel).toBeLessThanOrEqual(1);
          }
          expect(JSON.stringify(sample)).not.toMatch(/NaN|Infinity/);
          expect(sample.readings.length).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('clamps playback at the end so a paused endpoint does not drift', () => {
    for (const lesson of interactiveLessons) {
      lesson.settings.options.forEach((_, setting) => {
        expect(lesson.sample(lesson.duration + 100, setting)).toEqual(lesson.sample(lesson.duration, setting));
      });
    }
  });
});

describe('energy model invariants', () => {
  it('quadruples catapult energy and peak height when extension doubles', () => {
    const short = catapultState(1, 0.04);
    const long = catapultState(1, 0.08);
    expect(short.initialJ).toBeCloseTo(0.032, 10);
    expect(long.initialJ / short.initialJ).toBeCloseTo(4, 10);
    expect(long.heightM / short.heightM).toBeCloseTo(4, 10);
    for (let i = 0; i <= 100; i++) {
      const s = catapultState(i / 100, 0.08);
      expect(s.kineticJ + s.gravitationalJ).toBeCloseTo(s.initialJ, 10);
    }
    expect(long.speed).toBeCloseTo(0, 10);
  });

  it('conserves the ball plus surroundings energy through impacts on both surfaces', () => {
    for (const kept of [0.75, 0.4]) {
      for (let i = 0; i <= 800; i++) {
        const s = bounceState(i / 100, kept);
        expect(s.gravitationalJ + s.kineticJ + s.dissipatedJ).toBeCloseTo(0.49, 10);
        expect(s.kineticJ).toBeGreaterThanOrEqual(0);
        expect(s.heightM).toBeGreaterThanOrEqual(0);
      }
      const firstPeakTime = Math.sqrt(2 / 9.8) + Math.sqrt(2 * 9.8 * kept) / 9.8;
      expect(bounceState(firstPeakTime, kept).heightM).toBeCloseTo(kept, 10);
      expect(bounceState(8, kept).dissipatedJ).toBeCloseTo(0.49, 10);
    }
  });

  it('accounts for insulation losses before using Q = mcΔθ', () => {
    for (const lidOn of [false, true]) {
      const s = heatingState(1, lidOn);
      expect(s.inputJ).toBe(30000);
      expect(s.retainedJ + s.lossJ).toBeCloseTo(s.inputJ, 10);
      expect((s.waterC - 20) * 4200).toBeCloseTo(s.retainedJ, 8);
      expect((s.aluminiumC - 20) * 900).toBeCloseTo(s.retainedJ, 8);
    }
    expect(heatingState(1, true).retainedJ).toBe(29400);
    expect(heatingState(1, false).retainedJ).toBe(24000);
  });

  it('finishes both lifts at the same height with fourfold power ratio', () => {
    const lesson = interactiveLessons.find(lesson => lesson.kind === 'lifting')!;
    const slow = lesson.sample(4, 0);
    const fast = lesson.sample(4, 1);
    expect(slow.pose.primary).toBe(1);
    expect(slow.pose.secondary).toBe(1);
    expect(slow.readings.find(r => r.label === 'Energy transferred')?.value).toBe('9.80 J');
    expect(fast.readings.find(r => r.label === 'Energy transferred')?.value).toBe('9.80 J');
    expect(slow.readings.find(r => r.label === 'Power while lifting')?.value).toBe('2.45 W');
    expect(fast.readings.find(r => r.label === 'Power while lifting')?.value).toBe('9.80 W');
  });

  it('matches lamp light at 7.5W and boils only with breezy wind', () => {
    const lamps = interactiveLessons.find(lesson => lesson.kind === 'lamps')!;
    expect(lamps.sample(1, 0).readings.find(r => r.label === 'LED visible light')?.value).toBe('3.0 W');
    expect(lamps.sample(1, 2).pose.highlight).toBeGreaterThan(lamps.sample(1, 0).pose.highlight);
    const grid = interactiveLessons.find(lesson => lesson.kind === 'grid')!;
    expect(grid.sample(12, 1).readings.find(r => r.label === 'Water temperature')?.value).toBe('100.0 °C');
    for (const setting of [0, 2]) {
      expect(grid.sample(12, setting).pose.secondary).toBe(0);
      expect(grid.sample(12, setting).pose.primary).toBe(0);
    }
  });
});
