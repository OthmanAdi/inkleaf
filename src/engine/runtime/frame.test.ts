import { describe, expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { Registry } from '../core/registry';
import { computeLessonFrame, frameDirToWorld, frameOriginU, frameToWorld } from './frame';
import { runtimeTunables } from './tunables';
import { fakeBook } from './test-fakes';

const T = runtimeTunables(new Registry()).frame;

describe('lesson frame', () => {
  it('samples u 20..180 every 8 mm at v 212 (21 samples) and sits 0.05 mm above a flat page', () => {
    const seen: number[] = [];
    const book = fakeBook();
    const mapper = { pageToWorld: (k: number, side: 'left' | 'right', u: number, v: number, out?: Vector3) => {
      if (v === 212 && u !== 74) seen.push(u);
      return book.pageToWorld(k, side, u, v, out);
    } };
    const m = computeLessonFrame(mapper, 2, T);
    expect(seen).toEqual(Array.from({ length: 21 }, (_, i) => 20 + 8 * i));
    expect(frameOriginU(T)).toBe(20);
    const o = new Vector3().setFromMatrixPosition(m);
    expect(o.x).toBeCloseTo(20, 9);
    expect(o.y).toBeCloseTo(0.05, 9);
    expect(o.z).toBeCloseTo(87, 9);
    const x = new Vector3(), y = new Vector3(), z = new Vector3();
    m.extractBasis(x, y, z);
    expect(x.toArray().map((v) => +v.toFixed(9))).toEqual([1, 0, 0]);
    expect(y.toArray().map((v) => +v.toFixed(9))).toEqual([0, 1, 0]);
    expect(z.toArray().map((v) => +v.toFixed(9))).toEqual([0, 0, 1]);
  });

  it('fits a tilted page and lifts the floor to the highest bulge past the gutter samples', () => {
    const slope = -0.01037;
    const bump = (u: number) => (u === 100 ? 0.4 : 0) + (u === 20 ? 2 : 0);
    const book = fakeBook([], { bulge: (u) => 3 + slope * u + bump(u) });
    const m = computeLessonFrame(book, 2, T);
    const o = new Vector3().setFromMatrixPosition(m);
    const n = 21;
    const us = Array.from({ length: n }, (_, i) => 20 + 8 * i);
    const ys = us.map((u) => 3 + slope * u + bump(u));
    const mx = us.reduce((a, b) => a + b) / n, my = ys.reduce((a, b) => a + b) / n;
    let sxx = 0, sxy = 0;
    us.forEach((u, i) => { sxx += (u - mx) ** 2; sxy += (u - mx) * (ys[i]! - my); });
    const s = sxy / sxx;
    const line = (u: number) => my + s * (u - mx);
    const g = Math.max(0, ...us.slice(2).map((u, i) => ys[i + 2]! - line(u)));
    expect(o.y).toBeCloseTo(line(20) + g + 0.05, 9);
    const x = new Vector3();
    m.extractBasis(x, new Vector3(), new Vector3());
    expect(x.y / x.x).toBeCloseTo(s, 9);
  });

  it('transforms lesson-frame points and directions', () => {
    const m = new Matrix4().makeRotationY(Math.PI / 2).setPosition(10, 0, 5);
    expect(frameToWorld(m, [1, 2, 0]).toArray().map((v) => +v.toFixed(6))).toEqual([10, 2, 4]);
    const d = frameDirToWorld(m, [0, 0, 5]);
    expect(d.toArray().map((v) => +v.toFixed(6))).toEqual([5, 0, 0]);
  });
});
