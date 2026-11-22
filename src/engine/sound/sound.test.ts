import { describe, expect, it } from 'vitest';
import { Registry } from '../core/registry';
import { BANDS, loopWrap, measure, rng, white } from './dsp';
import { createSound, jitter, layerGains, pickVariant, tailLength } from './engine';
import { RECIPES, defaults } from './recipes';

const SR = 44100;

describe('procedural cues match the measured targets', () => {
  for (const rec of RECIPES) {
    for (let v = 0; v < rec.variants; v++) {
      it(`${rec.name} v${v}: duration and spectral centroid within 25 %`, () => {
        const buf = rec.render(SR, defaults(rec), v);
        const m = measure(buf, SR);
        const t = rec.targets[v]!;
        expect(Math.abs(m.durMs - t.durMs) / t.durMs).toBeLessThan(0.25);
        expect(Math.abs(m.centroid - t.centroid) / t.centroid).toBeLessThan(0.25);
        expect(m.peakDb).toBeCloseTo(t.peakDb, 0);
        let finite = true;
        for (let i = 0; i < buf.length; i++) if (!Number.isFinite(buf[i]!) || Math.abs(buf[i]!) > 1) finite = false;
        expect(finite).toBe(true);
      });
    }
  }

  it('every band holds its measured share of the energy within 0.15', () => {
    for (const rec of RECIPES) {
      for (let v = 0; v < rec.variants; v++) {
        const m = measure(rec.render(SR, defaults(rec), v), SR);
        const t = rec.targets[v]!;
        BANDS.forEach(([lo, hi], b) => expect(Math.abs(m.bands[b]! - t.bands[b]!), `${rec.name} v${v} ${lo}-${hi} Hz`).toBeLessThan(0.15));
      }
    }
  });

  it('renders at another sample rate with the same length', () => {
    for (const rec of RECIPES) {
      const a = rec.render(44100, defaults(rec), 0).length / 44100;
      const b = rec.render(48000, defaults(rec), 0).length / 48000;
      expect(Math.abs(a - b)).toBeLessThan(0.001);
    }
  });

  it('loops wrap seamlessly: the jump across the loop point is an ordinary step', () => {
    for (const rec of RECIPES.filter((r) => r.loop)) {
      for (let v = 0; v < rec.variants; v++) {
        const b = rec.render(SR, defaults(rec), v);
        let sum = 0;
        for (let i = 1; i < b.length; i++) sum += Math.abs(b[i]! - b[i - 1]!);
        const mean = sum / (b.length - 1);
        expect(Math.abs(b[0]! - b[b.length - 1]!), `${rec.name} v${v}`).toBeLessThan(mean * 8 + 1e-4);
      }
    }
  });

  it('loopWrap crossfades the tail into the head', () => {
    const src = white(1100, rng(4));
    const out = loopWrap(src, 1000, 1, 0.1);
    expect(out.length).toBe(1000);
    expect(out[0]).toBeCloseTo(src[1000]!, 6);
    expect(out[999]).toBe(src[999]);
  });
});

describe('playback rules', () => {
  it('never repeats the last variant when choosing at random', () => {
    let lastV = -1;
    const r = rng(9);
    for (let i = 0; i < 200; i++) {
      const v = pickVariant(3, lastV, r);
      expect(v).not.toBe(lastV);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      lastV = v;
    }
    expect(pickVariant(3, 1, r, 4)).toBe(1);
    expect(pickVariant(1, 0, r)).toBe(0);
  });

  it('jitters pitch by up to 30 cents (55 when recent) and level by 1.2 dB (2.2), minus 3 dB for a double', () => {
    const cfg = { variation: true, cents: 30, centsRecent: 55, levelJitter: 1.2, levelJitterRecent: 2.2, doubleCut: 3 };
    const r = rng(2);
    for (let i = 0; i < 300; i++) {
      const a = jitter(cfg, false, false, r);
      expect(Math.abs(1200 * Math.log2(a.rate))).toBeLessThanOrEqual(30.0001);
      expect(Math.abs(20 * Math.log10(a.gain))).toBeLessThanOrEqual(1.2001);
      const b = jitter(cfg, true, true, r);
      expect(Math.abs(1200 * Math.log2(b.rate))).toBeLessThanOrEqual(55.0001);
      const db = 20 * Math.log10(b.gain);
      expect(db).toBeLessThanOrEqual(-3 + 2.2001);
      expect(db).toBeGreaterThanOrEqual(-3 - 2.2001);
    }
    expect(jitter({ ...cfg, variation: false }, true, false, r)).toEqual({ rate: 1, gain: 1 });
  });

  it('crossfades kettle layers with equal power, more boil when louder', () => {
    const [h0, b0] = layerGains(0.25);
    expect(h0).toBeCloseTo(0.25, 6);
    expect(b0).toBeCloseTo(0, 6);
    const [h1, b1] = layerGains(0.9);
    expect(h1).toBeCloseTo(0, 6);
    expect(b1).toBeCloseTo(0.9, 6);
    const [h, b] = layerGains(0.6, 0.5);
    expect(h * h + b * b).toBeCloseTo(0.36, 6);
  });

  it('tail of a truncated voice is min(0.08, T / 3r)', () => {
    expect(tailLength(0.5, 1, 0.08)).toBeCloseTo(0.08);
    expect(tailLength(0.12, 1, 0.08)).toBeCloseTo(0.04);
    expect(tailLength(0.12, 2, 0.08)).toBeCloseTo(0.02);
  });

  it('registers the engine and every cue with tunable parameters, off by default', () => {
    const reg = new Registry();
    const s = createSound(reg, { autoUnlock: false });
    expect(s.enabled).toBe(false);
    expect(reg.get('sound.engine')?.params.map((p) => p.key)).toContain('compRatio');
    for (const rec of RECIPES) {
      const e = reg.get(`sound.${rec.id}`);
      expect(e, rec.id).toBeTruthy();
      expect(e!.params.map((p) => p.key)).toEqual(expect.arrayContaining(['gain', 'level', 'length', 'pitch', 'seed']));
    }
    const before = s.samples('stamp', 0, 22050).length;
    reg.set('sound.stamp', 'length', 2);
    expect(s.samples('stamp', 0, 22050).length).toBeGreaterThan(before * 1.9);
    s.dispose();
    expect(reg.list('sound')).toHaveLength(0);
  });
});
