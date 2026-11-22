import { describe, expect, it } from 'vitest';
import { Registry } from '../core/registry';
import { DEFAULT_FONTS, lcg, marginPlacements, paintLeftInk, paintRightInk, stampHoles, stampRotation, stampSeed, switchRingPoints, tickPath } from './ink';
import { runtimeTunables } from './tunables';

const T = runtimeTunables(new Registry());

/** A canvas 2D context that records calls and property writes. */
function recorder() {
  const calls: string[] = [];
  const target: Record<string, unknown> = { canvas: { width: 760, height: 1000 } };
  const ctx = new Proxy(target, {
    get: (t, key: string) => (key in t ? t[key] : (...args: unknown[]) => void calls.push(`${key}(${args.map((a) => (typeof a === 'number' ? +a.toFixed(4) : a)).join(',')})`)),
    set: (t, key: string, v) => {
      if (key !== 'canvas') calls.push(`${key}=${typeof v === 'number' ? +v.toFixed(4) : v}`);
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

describe('page ink geometry', () => {
  it('draws the prediction tick from (u0 + 2.1, v1 - 4.4) to (u0 + 7.7, v1 - 8.6)', () => {
    const k = tickPath({ u0: 54.5, v0: 150, u1: 172, v1: 157.4 });
    const r = k.map((v) => +v.toFixed(6));
    expect(r).toEqual([56.6, 153, 57.6, 154.4, 58, 155.2, 59.4, 151.2, 62.2, 148.8]);
  });

  it('places margin lines 1.12 x size + gap apart, tilting odd lines -0.012 and even lines +0.0072', () => {
    const p = marginPlacements([{ text: 'Ep = m g h' }, { text: '= 0.50 x 9.8 x 0.050', size: 5 }, { text: '= 0.24 J', gap: 3 }, { text: 'x' }], 94, T.ink);
    expect(p.map((x) => +x.v.toFixed(6))).toEqual([94, 100.272, 105.872, 115.144]);
    expect(p.map((x) => +x.rotation.toFixed(6))).toEqual([0.0072, -0.012, 0.0072, -0.012]);
    expect(p[1]!.size).toBe(5);
  });

  it('loops 2.15 pi around a switch option with 41 points and a 4 % wobble', () => {
    const box = { u0: 150, v0: 217.5, u1: 158, v1: 225 };
    const pts = switchRingPoints(box, T.ring);
    expect(pts.length).toBe(82);
    const cx = 154, cy = 221.25 - 0.4, rx = 4 + 1.2, ry = 3.75 + 0.6;
    expect(pts[0]).toBeCloseTo(cx + rx * Math.cos(-0.4), 9);
    expect(pts[1]).toBeCloseTo(cy + ry * Math.sin(-0.4), 9);
    const a = -0.4 + 2.15 * Math.PI;
    expect(pts[80]).toBeCloseTo(cx + rx * (1 + 0.04 * Math.sin(40)) * Math.cos(a), 9);
    expect(pts[81]).toBeCloseTo(cy + ry * Math.sin(a), 9);
  });

  it('rotates and wears each lesson stamp from its own seed', () => {
    expect(stampRotation(1, T.stamp)).toBeCloseTo(-0.09, 12);
    expect(stampRotation(3, T.stamp)).toBeCloseTo(-0.16, 12);
    expect(stampRotation(5, T.stamp)).toBeCloseTo(-0.02, 12);
    expect(stampSeed(2)).toBe(7 * 9973 + 62);
    const r = lcg(1);
    expect(r()).toBe(((1664525 + 1013904223) >>> 0) / 2 ** 32);
    const holes = stampHoles(2, 11.18, 70);
    expect(holes).toHaveLength(70);
    for (const h of holes) {
      expect(Math.hypot(h.x, h.y)).toBeLessThanOrEqual(1.05 * 11.18 + 1e-9);
      expect(h.r).toBeGreaterThanOrEqual(11.18 * 0.015);
      expect(h.r).toBeLessThanOrEqual(11.18 * 0.055);
    }
    expect(stampHoles(2, 11.18, 70)).toEqual(holes);
    expect(stampHoles(3, 11.18, 70)).not.toEqual(holes);
  });
});

describe('page ink painters', () => {
  it('paints tick, margin lines and the stamp in page millimetres', () => {
    const { ctx, calls } = recorder();
    paintLeftInk(ctx, 4, { predict: { u0: 54.5, v0: 150, u1: 172, v1: 157.4 }, equationTop: 90, lines: [{ text: 'Ep = m g h' }], n: 2, press: 0.5 }, T, DEFAULT_FONTS);
    expect(calls).toContain('setTransform(4,0,0,4,0,0)');
    expect(calls).toContain('strokeStyle=#273463');
    expect(calls).toContain('lineWidth=0.75');
    expect(calls).toContain('moveTo(56.6,153)');
    expect(calls).toContain('translate(12,94)');
    expect(calls).toContain('font=560 5.6px "Caveat Variable", "Caveat", cursive');
    expect(calls).toContain('fillText(Ep = m g h,0,0)');
    expect(calls).toContain('translate(31,194)');
    expect(calls).toContain('globalAlpha=0.43');
    expect(calls).toContain('strokeStyle=#b8412e');
    expect(calls.filter((c) => c === 'globalCompositeOperation=destination-out')).toHaveLength(1);
    expect(calls.indexOf('translate(12,94)')).toBeLessThan(calls.indexOf('translate(31,194)'));
  });

  it('falls back to v 80 for the margin and skips an unpressed stamp', () => {
    const { ctx, calls } = recorder();
    paintLeftInk(ctx, 4, { predict: null, equationTop: null, lines: [{ text: 'a' }], n: 1, press: 0 }, T, DEFAULT_FONTS);
    expect(calls).toContain('translate(12,84)');
    expect(calls.some((c) => c.startsWith('moveTo'))).toBe(false);
    expect(calls).not.toContain('translate(31,194)');
  });

  it('rings the chosen switch options on the right page', () => {
    const { ctx, calls } = recorder();
    paintRightInk(ctx, 4, [{ u0: 150, v0: 217.5, u1: 158, v1: 225 }], T);
    expect(calls).toContain('lineWidth=0.42');
    expect(calls.filter((c) => c.startsWith('lineTo'))).toHaveLength(40);
  });
});
