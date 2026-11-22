import { describe, expect, it } from 'vitest';
import { frameAt, sampleTrack, timeAt } from './frames';
import { DEMO_MOTIONS, magnifierAt, pageTurnAt, popupAt } from '../demo/motion';

describe('frame sampling', () => {
  it('seeks to integer frames in the closed interval and uses the authored frame rate', () => {
    const { turn } = DEMO_MOTIONS;
    expect([frameAt(turn, -8), frameAt(turn, 26.8), frameAt(turn, 200)]).toEqual([0, 27, 54]);
    expect(timeAt(turn, 27)).toBe(0.45);
    expect(frameAt(turn, NaN)).toBe(0);
  });

  it('can seek backwards and recompute the same value with no playback state', () => {
    const first = popupAt(0.35);
    expect(popupAt(1).lift).toBe(1);
    expect(popupAt(0).lift).toBe(0);
    expect(popupAt(0.35)).toEqual(first);
    expect(pageTurnAt(0.5).angleDeg).toBeCloseTo(-90);
    expect(pageTurnAt(1).angleDeg).toBe(-180);
  });

  it('uses the outgoing easing for each segment and holds the endpoints', () => {
    const sample = (frame: number) => sampleTrack([
      { frame: 4, value: 2, easeToNext: 'inQuad' },
      { frame: 8, value: 6 },
      { frame: 12, value: 10 },
    ], frame);
    expect([-1, 6, 8, 10, 20].map(sample)).toEqual([2, 3, 6, 8, 10]);
  });

  it('returns the same optical sample point after visiting a different frame', () => {
    const detail = magnifierAt(24);
    expect(detail.x).toBeCloseTo(0.5);
    expect(detail.y).toBe(0.62);
    expect(magnifierAt(48)).toEqual({ x: 0.64, y: 0.54 });
    expect(magnifierAt(24)).toEqual(detail);
  });
});
