import { beforeAll, describe, expect, it } from 'vitest';
import { fnv1a } from './noise';
import { oakPlanks, oakTexture, type TextureBuffers } from './oak';
import { linoTexture } from './lino';

function stats(buf: Uint8ClampedArray) {
  const n = buf.length / 4;
  const mean = [0, 0, 0], lo = [255, 255, 255], hi = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      const v = buf[i * 4 + c]!;
      mean[c]! += v;
      if (v < lo[c]!) lo[c] = v;
      if (v > hi[c]!) hi[c] = v;
    }
  }
  return { mean: mean.map((m) => m / n), lo, hi };
}

const px = (t: TextureBuffers, b: Uint8ClampedArray, x: number, y: number) => [...b.slice((y * t.width + x) * 4, (y * t.width + x) * 4 + 4)];

describe('oak planks', () => {
  it('reproduces the measured plank table (seed 5)', () => {
    const p = oakPlanks();
    expect(p).toHaveLength(8);
    const table = [
      [-17.9311, 130.5606, 1.0047, 0.6645, 0.5731, 37.5484, 0.6227, 0.0017],
      [130.5606, 274.4256, 0.987, 0.6771, 0.7529, 3.9785, 0, -0.0019],
      [274.4256, 397.9549, 1.006, 0.7547, 0.5561, 24.0473, 0, 0.0019],
      [397.9549, 540.4802, 0.9762, 0.8388, 0.4761, 43.9208, 0, -0.0014],
      [540.4802, 664.9001, 0.9811, 0.4275, 0.6643, 18.2898, 0.7498, -0.0007],
      [664.9001, 788.7741, 0.987, 0.8905, 0.5218, 12.4039, 0, 0.0017],
      [788.7741, 884.8765, 0.9913, 0.6274, 0.642, 43.9945, 0.7805, -0.0017],
      [884.8765, 983.971, 0.9935, 0.2203, 0.7217, 46.8474, 0.6002, 0.0019],
    ];
    p.forEach((pl, i) => {
      const row = table[i]!;
      [pl.y0, pl.y1, pl.tone, pl.cool, pl.freq, pl.phase, pl.rays, pl.tilt].forEach((v, j) => expect(v).toBeCloseTo(row[j]!, 4));
    });
  });
});

describe('oak texture', () => {
  let oak: TextureBuffers;
  beforeAll(() => {
    oak = oakTexture();
  });

  it('is 2100 x 1350 at 1.5 px/mm', () => {
    expect([oak.width, oak.height]).toEqual([2100, 1350]);
  });

  it('matches the measured colour statistics', () => {
    const s = stats(oak.map);
    expect(s.mean[0]!).toBeCloseTo(201.2, 1);
    expect(s.mean[1]!).toBeCloseTo(188.8, 1);
    expect(s.mean[2]!).toBeCloseTo(167.3, 1);
    expect(s.lo).toEqual([152, 141, 124]);
    expect(s.hi).toEqual([222, 214, 201]);
  });

  it('matches the measured roughness and normal statistics', () => {
    const r = stats(oak.roughness);
    expect(r.mean[0]!).toBeCloseTo(149.3, 1);
    expect([r.lo[0], r.hi[0]]).toEqual([119, 210]);
    expect(stats(oak.normal).lo[2]!).toBeGreaterThanOrEqual(243);
  });

  it('locks our own bytes', () => {
    expect([fnv1a(oak.map), fnv1a(oak.roughness), fnv1a(oak.normal)]).toEqual(['6f3622a5', '8bf98a4c', '98807552']);
    expect(px(oak, oak.map, 0, 0)).toEqual([205, 193, 170, 255]);
    expect(px(oak, oak.map, 1000, 700)).toEqual([201, 189, 169, 255]);
    expect(px(oak, oak.map, 333, 222)).toEqual([202, 190, 169, 255]);
    expect(px(oak, oak.roughness, 1000, 700)).toEqual([150, 150, 150, 255]);
    expect(px(oak, oak.normal, 1000, 700)).toEqual([128, 131, 255, 255]);
  });
});

describe('lino texture', () => {
  let lino: TextureBuffers;
  beforeAll(() => {
    lino = linoTexture();
  });

  it('matches the measured statistics', () => {
    const s = stats(lino.map);
    expect(s.mean[0]!).toBeCloseTo(143.1, 1);
    expect(s.mean[1]!).toBeCloseTo(154.0, 1);
    expect(s.mean[2]!).toBeCloseTo(140.1, 1);
    expect(s.lo).toEqual([114, 116, 112]);
    expect(s.hi).toEqual([187, 189, 186]);
    const r = stats(lino.roughness);
    expect([r.lo[0], r.hi[0]]).toEqual([202, 218]);
    expect(r.mean[0]!).toBeCloseTo(210, 0);
  });

  it('has the exact base colour at the lattice point (0, 0)', () => {
    expect(px(lino, lino.map, 0, 0)).toEqual([143, 154, 140, 255]);
  });

  it('locks our own bytes', () => {
    expect([fnv1a(lino.map), fnv1a(lino.roughness), fnv1a(lino.normal)]).toEqual(['bd007c94', '83dd26d6', '99ddd961']);
    expect(px(lino, lino.normal, 100, 200)).toEqual([141, 126, 254, 255]);
    expect(px(lino, lino.map, 300, 50)).toEqual([143, 153, 140, 255]);
  });

  it('changes with the seed', () => {
    expect(fnv1a(linoTexture({ seed: 22 }).map)).not.toBe('bd007c94');
  });
});
