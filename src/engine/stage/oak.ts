/**
 * Procedural oak desk texture: pale planks running along world X with growth-ring figure, latewood bands, fine
 * pores, occasional bright ray flecks and thin dark seams. Produces colour (sRGB bytes), roughness and normal maps
 * as RGBA8 buffers, deterministic for a seed. Pure: runs in a worker or in tests.
 */
import { gradientNoise, heightToNormal, lcg } from './noise';

export interface OakOptions {
  /** Tile width in mm (along the planks, world X). */
  width: number;
  /** Tile depth in mm (across the planks, world Z). */
  depth: number;
  /** Texels per mm. */
  px: number;
  seed: number;
  plankMin: number;
  plankRange: number;
  base: readonly [number, number, number];
  light: readonly [number, number, number];
  dark: readonly [number, number, number];
  fleck: number;
  ringPhase: number;
  ringWidth: number;
  ringWidthVar: number;
  latewoodMix: number;
  porePhase: number;
  poreWidth: number;
  poreThreshold: number;
  poreDarken: number;
  rayThreshold: number;
  rayGain: number;
  rayChance: number;
  fleckMax: number;
  seamWidth: number;
  seamDarken: number;
  /** Per-channel shift for cool (bluer) versus warm (redder) planks. */
  coolShift: readonly [number, number, number];
}

export const OAK_DEFAULTS: OakOptions = {
  width: 1400, depth: 900, px: 1.5, seed: 5,
  plankMin: 95, plankRange: 55,
  base: [204, 191, 168], light: [221, 210, 190], dark: [168, 150, 124], fleck: 238,
  ringPhase: 0.62, ringWidth: 0.18, ringWidthVar: 0.12, latewoodMix: 0.55,
  porePhase: 0.32, poreWidth: 0.12, poreThreshold: 0.42, poreDarken: 0.16,
  rayThreshold: 0.62, rayGain: 3.2, rayChance: 0.55, fleckMax: 0.35,
  seamWidth: 0.6, seamDarken: 0.9,
  coolShift: [-3, 0, 5],
};

export interface Plank {
  y0: number; y1: number; tone: number; cool: number; freq: number; phase: number; rays: number; tilt: number;
}

export interface TextureBuffers {
  width: number;
  height: number;
  map: Uint8ClampedArray;
  roughness: Uint8ClampedArray;
  normal: Uint8ClampedArray;
}

/** The plank layout: widths, tones and ring parameters, drawn from one LCG in a fixed order. */
export function oakPlanks(o: OakOptions = OAK_DEFAULTS): Plank[] {
  const g = lcg(o.seed * 31 + 7);
  const planks: Plank[] = [];
  let y = -g() * 60;
  while (y < o.depth + 10) {
    const width = o.plankMin + g() * o.plankRange;
    const tone = 0.975 + g() * 0.04;
    const cool = g();
    const freq = 0.45 + g() * 0.35;
    const phase = g() * 50;
    const test = g();
    const rays = test < o.rayChance ? 0.6 + g() * 0.4 : 0;
    const tilt = (g() - 0.5) * 0.004;
    planks.push({ y0: y, y1: y + width, tone, cool, freq, phase, rays, tilt });
    y += width;
  }
  return planks;
}

function oakChannel(Bc: number, Lc: number, Dc: number, shift: number, mix: number, tone: number, cool: number, G: number, lwMix: number, fleck: number, fl: number, pore: number, darken: number): number {
  let v = Bc + (Lc - Bc) * mix;
  v = v * tone + (cool - 0.5) * shift;
  v = v + (Dc - v) * G * lwMix;
  v = v + (fleck - v) * fl;
  if (pore > 0) v = v * darken;
  return v;
}

export function oakTexture(opts: Partial<OakOptions> = {}): TextureBuffers {
  const o: OakOptions = { ...OAK_DEFAULTS, ...opts };
  const w = Math.round(o.width * o.px);
  const h = Math.round(o.depth * o.px);
  const s = o.seed;
  const nA = gradientNoise(s), nB = gradientNoise(s + 11), nC = gradientNoise(s + 23);
  const nD = gradientNoise(s + 37), nE = gradientNoise(s + 51), nF = gradientNoise(s + 63);
  const planks = oakPlanks(o);
  const map = new Uint8ClampedArray(w * h * 4);
  const roughness = new Uint8ClampedArray(w * h * 4);
  const height = new Float32Array(w * h);
  const [B0, B1, B2] = o.base, [L0, L1, L2] = o.light, [D0, D1, D2] = o.dark, [c0, c1, c2] = o.coolShift;
  let pi = 0;
  for (let k = 0; k < h; k++) {
    const y = k / o.px;
    while (y > planks[pi]!.y1 && pi < planks.length - 1) pi++;
    const p = planks[pi]!;
    const a = y - p.y0;
    const seam = a < o.seamWidth || p.y1 - y < o.seamWidth;
    for (let C = 0; C < w; C++) {
      const x = C / o.px;
      const I = (a + x * p.tilt + nA(0.0016 * x, 0.006 * y + p.phase) * 5 + nB(0.004 * x, 0.05 * y + p.phase) * 1.2) * p.freq + p.phase;
      const N = I - Math.floor(I);
      const hw = o.ringWidth + o.ringWidthVar * (nC(0.002 * x, 0.21 * I) * 0.5 + 0.5);
      const r = Math.max(0, 1 - Math.abs(N - o.ringPhase) / hw);
      const G = r * r;
      const e = Math.max(0, 1 - Math.abs(N - o.porePhase) / o.poreWidth);
      const pore = e > 0 && nE(0.55 * x, 9 * I) > o.poreThreshold ? e : 0;
      const V = p.rays !== 0 ? Math.max(0, nF(0.09 * x, 0.9 * y + p.phase) - o.rayThreshold) * o.rayGain * p.rays : 0;
      const Pe = nC(0.0008 * x, 0.008 * y + p.phase) * 0.5 + 0.5;
      const ne = nD(0.003 * x, 0.25 * y) * 0.5 + 0.5;
      const mix = 0.9 * Pe + 0.4 * ne - 0.45;
      const fl = Math.min(o.fleckMax, V);
      const darken = 1 - o.poreDarken * pore;
      const off = (k * w + C) * 4;
      map[off] = oakChannel(B0, L0, D0, c0, mix, p.tone, p.cool, G, o.latewoodMix, o.fleck, fl, pore, darken);
      map[off + 1] = oakChannel(B1, L1, D1, c1, mix, p.tone, p.cool, G, o.latewoodMix, o.fleck, fl, pore, darken);
      map[off + 2] = oakChannel(B2, L2, D2, c2, mix, p.tone, p.cool, G, o.latewoodMix, o.fleck, fl, pore, darken);
      map[off + 3] = 255;
      if (seam) {
        map[off] = map[off]! * o.seamDarken;
        map[off + 1] = map[off + 1]! * o.seamDarken;
        map[off + 2] = map[off + 2]! * o.seamDarken;
      }
      height[k * w + C] = 0.1 * G - 0.35 * pore + 0.05 * V;
      const rb = 150 + 60 * pore - 30 * V - 8 * G;
      roughness[off] = rb;
      roughness[off + 1] = rb;
      roughness[off + 2] = rb;
      roughness[off + 3] = 255;
    }
  }
  const normal = heightToNormal(height, w, h, 1, false);
  return { width: w, height: h, map, roughness, normal };
}
