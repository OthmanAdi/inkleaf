import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { foldModel, foldParts, popWorld } from './fold';
import { obliqueProject } from './print';
import { undrawAt } from './lifecycle';

const fold = (x: number, y: number, z: number, lift: number) => foldModel(x, y, z, lift, 0.12, 0.32, { x: 0, y: 0, z: 0 });

describe('popWorld fold', () => {
  it('is the identity when standing (lift 1)', () => {
    expect(fold(12, 30, -40, 1)).toEqual({ x: 12, y: 30, z: -40 });
  });

  it('lies on the page as the cabinet-oblique drawing at lift 0', () => {
    const r = fold(12, 30, -40, 0);
    // drawing coordinates (x + 0.12 d, y + 0.32 d) with d = 40; the drawing's Y points toward the page head (-Z)
    expect(r.x).toBeCloseTo(12 + 0.12 * 40, 10);
    expect(r.z).toBeCloseTo(-(30 + 0.32 * 40), 10);
    expect(r.y).toBeCloseTo(0.06, 10);
    // matches where the print camera puts the same point: image (x - 0.12 z, y - 0.32 z)
    const [ix, iy] = obliqueProject(12, 30, -40);
    expect(r.x).toBeCloseTo(ix, 10);
    expect(-r.z).toBeCloseTo(iy, 10);
  });

  it('at lift 0.5 stands at 45 degrees with almost no depth', () => {
    const { angle, lambda } = foldParts(0.5);
    expect(angle).toBeCloseTo(Math.PI / 4, 10);
    expect(lambda).toBeCloseTo(1 / 256, 12);
    const r = fold(12, 30, -40, 0.5);
    const X = 12 + (1 - lambda) * 40 * 0.12, Y = 30 + (1 - lambda) * 40 * 0.32;
    const s = Math.SQRT1_2;
    expect(r.x).toBeCloseTo(X, 10);
    expect(r.y).toBeCloseTo(Y * s - lambda * 40 * s, 10);
    expect(r.z).toBeCloseTo(-Y * s - lambda * 40 * s, 10);
  });

  it('never sinks below the paper floor 0.06 + 0.02 u', () => {
    expect(fold(5, -20, 0, 0.3).y).toBeCloseTo(0.06 + 0.02 * 0.3, 10);
  });

  it('does not shear points in front of the hinge plane', () => {
    const r = fold(10, 5, 8, 0);
    expect(r.x).toBe(10);
    expect(r.z).toBeCloseTo(-5, 10);
  });

  it('matches the undraw timeline table (u, lambda, angle per fold progress r)', () => {
    const rows: [number, number, number, number][] = [
      [0.1, 0.972, 0.8, 89.8],
      [0.2, 0.896, 0.42, 87],
      [0.3, 0.784, 0.14, 79],
      [0.4, 0.648, 0.03, 64],
    ];
    for (const [r, u, lam, deg] of rows) {
      const t = 0.15 + r * 0.35;
      const lift = undrawAt(t).lift;
      expect(lift).toBeCloseTo(u, 3);
      const p = foldParts(lift);
      expect(p.lambda).toBeCloseTo(lam, 1);
      expect((p.angle * 180) / Math.PI).toBeCloseTo(deg, 0);
    }
    expect((foldParts(undrawAt(0.15 + 0.5 * 0.35).lift).angle * 180) / Math.PI).toBeCloseTo(45, 6);
    expect((foldParts(undrawAt(0.15 + 0.7 * 0.35).lift).angle * 180) / Math.PI).toBeCloseTo(11, 0);
    expect((foldParts(undrawAt(0.15 + 0.8 * 0.35).lift).angle * 180) / Math.PI).toBeCloseTo(2.7, 1);
  });

  it('world version goes through the frame', () => {
    const frame = new Matrix4().makeTranslation(100, 5, 80);
    const inv = frame.clone().invert();
    const w = popWorld(new Vector3(112, 35, 40), 0, frame, inv, 0.12, 0.32);
    expect(w.x).toBeCloseTo(100 + 12 + 4.8, 8);
    expect(w.y).toBeCloseTo(5 + 0.06, 8);
    expect(w.z).toBeCloseTo(80 - (30 + 12.8), 8);
  });
});
