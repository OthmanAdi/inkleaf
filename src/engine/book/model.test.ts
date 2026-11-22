import { describe, expect, it } from 'vitest';
import { arcSamples, makeDims } from './dims';
import { BookModel, bendLength, integralLookup, integralTable, type LocalPoint } from './model';

const d = makeDims({ N: 14 });
const pt = (): LocalPoint => ({ x: 0, y: 0, z: 0, a: 0, face: 'b' });

function at(position: number, extra?: (c: Float64Array) => void): BookModel {
  const m = new BookModel(d);
  m.setPosition(position);
  extra?.(m.c);
  m.markDirty();
  m.ensure();
  return m;
}

describe('book dims', () => {
  it('matches the stack and board constants', () => {
    expect(d.T).toBeCloseTo(19.15, 10);
    expect(d.Yb).toBeCloseTo(-9.575, 10);
    expect(d.BW).toBe(190);
    expect(d.BD).toBe(258);
  });
  it('samples arc length densely at the spine', () => {
    const S = arcSamples(190);
    expect(S[1]).toBeCloseTo(0.98694, 4);
    expect(S[30]).toBeCloseTo(61.75, 6);
    expect(S[60]).toBeCloseTo(190, 10);
  });
  it('integral table I(psi) agrees with a direct value', () => {
    const t = integralTable(2.5);
    expect(integralLookup(t, 0)).toBe(0);
    expect(integralLookup(t, 1.45458)).toBeCloseTo(0.359125, 4);
  });
});

describe('frame solve (appendix A)', () => {
  it('spread 2 open', () => {
    const m = at(2);
    const f = m.frame;
    expect(f.split).toBeCloseTo(12.6, 6);
    expect(f.omega).toBe(1);
    expect(f.apexX).toBeCloseTo(-3.065, 3);
    expect(f.apexY).toBeCloseTo(-8.114, 3);
    expect(f.betaR).toBeCloseTo(3.02538, 4);
    expect(f.RTx).toBeCloseTo(-9.45, 6);
    expect(f.RTy).toBeCloseTo(-9.575, 6);
    expect(f.famR.psi).toBeCloseTo(1.45458, 4);
    expect(f.famR.I).toBeCloseTo(0.359125, 4);
    expect(bendLength(f.famR, m.top(2))).toBeCloseTo(31.017, 2);
  });
  it.each([
    [0, 13.15, -3.622, -8.147, 0, 0, 0],
    [1, 13.15, -3.622, -8.147, 1.462, -1.3306, Math.PI],
    [7, 9.85, -0.279, -8.034, 1.4137, -1.4043, Math.PI],
    [14, 6.0, 3.622, -8.147, 1.3306, -1.462, Math.PI],
  ])('position %d', (pos, split, ax, ay, psiR, psiL, flat) => {
    const f = at(pos).frame;
    expect(f.split).toBeCloseTo(split, 6);
    expect(f.apexX).toBeCloseTo(ax, 3);
    expect(f.apexY).toBeCloseTo(ay, 3);
    expect(f.famR.psi).toBeCloseTo(psiR, 3);
    expect(f.famL.psi).toBeCloseTo(psiL, 3);
    expect(f.famL.flat).toBeCloseTo(flat, 6);
  });
  it('closed book hinges the cover at (9.45, 9.575)', () => {
    const f = at(0).frame;
    expect(f.RTx).toBeCloseTo(9.45, 6);
    expect(f.RTy).toBeCloseTo(9.575, 6);
  });
  it.each([
    [0.25, 0, 0.7854, 5.207, 7.818],
    [0.5, 0.1352, Math.PI / 2, 0.965, 4.392],
    [0.75, 0.67, 3 * Math.PI / 4, -7.434, -1.61],
  ])('cover only t0 = %d', (t0, omega, flat, rx, ry) => {
    const f = at(0, (c) => void (c[0] = t0)).frame;
    expect(f.omega).toBeCloseTo(omega, 3);
    expect(f.famL.flat).toBeCloseTo(flat, 4);
    expect(f.RTx).toBeCloseTo(rx, 2);
    expect(f.RTy).toBeCloseTo(ry, 2);
  });
});

describe('page integration (appendix A)', () => {
  const m = at(2);
  it.each([
    [0, 125, -3.065, -8.114, 0, 1.455],
    [14, 212, 6.121, 1.443, 87, 0.326],
    [20, 212, 11.979, 2.671, 87, 0.111],
    [95, 125, 86.966, 2.7, 0, -0.01],
    [190, 125, 181.95, 1.022, 0, -0.025],
  ])('right page of spread 2 at (%d, %d)', (u, v, x, y, z, a) => {
    const p = m.pageLocal(2, 'right', u, v, pt());
    expect(p.x).toBeCloseTo(x, 2);
    expect(p.y).toBeCloseTo(y, 2);
    expect(p.z).toBeCloseTo(z, 6);
    expect(p.a).toBeCloseTo(a, 2);
    expect(p.face).toBe('b');
  });
  it.each([
    [0, -190.975, -4.171, 3.155],
    [95, -95.98, -3.265, 3.148],
    [190, -3.065, -8.114, 1.796],
  ])('left page of spread 2 at u = %d', (u, x, y, a) => {
    const p = m.pageLocal(2, 'left', u, 125, pt());
    expect(p.x).toBeCloseTo(x, 2);
    expect(p.y).toBeCloseTo(y, 2);
    expect(p.a).toBeCloseTo(a, 2);
    expect(p.face).toBe('a');
  });
  it('flat pile heights: right top at 3.025, left top at -3.025', () => {
    const r = m.pageLocal(2, 'right', 150, 125, pt());
    expect(r.y).toBeLessThan(3.025);
    expect(r.y).toBeGreaterThan(1);
    expect(d.Yb + m.frame.split).toBeCloseTo(3.025, 6);
    expect(d.Yb + (d.T - m.frame.split)).toBeCloseTo(-3.025, 6);
  });
});

describe('turning leaf 2 from spread 2 (appendix A)', () => {
  const edge = (u: number, q: number) => {
    const m = at(2, (c) => void (c[2] = u));
    const c = m.curve(m.top(2), u, q, false);
    return { x: c.x[60]!, y: c.y[60]!, a: c.a[60]!, mid: m.sample(c, 95, { x: 0, y: 0, a: 0 }) };
  };
  it('u = 0.25: the near corner leads', () => {
    const a = edge(0.25, -1), b = edge(0.25, 0), c = edge(0.25, 1);
    expect([a.x, a.y]).toEqual([expect.closeTo(117.21, 1), expect.closeTo(136.96, 1)]);
    expect([b.x, b.y]).toEqual([expect.closeTo(108.54, 1), expect.closeTo(143.63, 1)]);
    expect([c.x, c.y]).toEqual([expect.closeTo(99.31, 1), expect.closeTo(149.46, 1)]);
    expect(b.mid.x).toBeCloseTo(54.7, 1);
    expect(b.mid.y).toBeCloseTo(65.54, 1);
  });
  it('u = 0.5: vertical with no curl', () => {
    for (const q of [-1, 0, 1]) {
      const e = edge(0.5, q);
      expect(e.x).toBeCloseTo(-6.1, 1);
      expect(e.y).toBeCloseTo(181.52, 1);
    }
    const e = edge(0.5, 0);
    expect(e.mid.x).toBeCloseTo(-6.49, 1);
    expect(e.mid.y).toBeCloseTo(86.52, 1);
    // The appendix quotes the angle to two digits (1.56); the free edge is at 1.5647 and the middle at 1.5687.
    expect(Math.trunc(e.a * 100) / 100).toBe(1.56);
    expect(Math.trunc(e.mid.a * 100) / 100).toBe(1.56);
  });
  it('u = 0.75: the near corner trails', () => {
    const a = edge(0.75, -1), b = edge(0.75, 0), c = edge(0.75, 1);
    expect([a.x, a.y]).toEqual([expect.closeTo(-128.48, 1), expect.closeTo(133.82, 1)]);
    expect([b.x, b.y]).toEqual([expect.closeTo(-119.77, 1), expect.closeTo(140.43, 1)]);
    expect([c.x, c.y]).toEqual([expect.closeTo(-110.5, 1), expect.closeTo(146.19, 1)]);
  });
});

describe('mapping', () => {
  it('open spread and piles', () => {
    const m = at(2);
    expect(m.openSpread()).toBe(2);
    expect(m.piles()).toEqual({ iR: 2, iL: 1 });
    expect(at(0).openSpread()).toBe(0);
    expect(at(2.5).openSpread()).toBe(0);
  });
  it('page -> local -> page round trips on both pages', () => {
    const m = at(5);
    for (const side of ['left', 'right'] as const) {
      for (const [u, v] of [[10, 20], [95, 125], [180, 240], [40, 212]] as const) {
        const p = m.pageLocal(5, side, u, v, pt());
        const back = m.localToPage(p.x, p.y, p.z)!;
        expect(back.k).toBe(5);
        expect(back.side).toBe(side);
        expect(back.u).toBeCloseTo(u, 1);
        expect(back.v).toBeCloseTo(v, 6);
        expect(back.distance).toBeLessThan(0.05);
      }
    }
  });
  it('is closed below position 0.5', () => {
    expect(at(0.3).localToPage(50, 0, 0)).toBeNull();
  });
});
