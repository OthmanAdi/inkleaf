/**
 * Procedural linoleum desk-pad texture: a seamless sage tile with soft mottling and fine light and dark speckles.
 * Produces colour (sRGB bytes), roughness and normal maps as RGBA8 buffers. Pure and deterministic for a seed.
 */
import { fbm, gradientNoise, heightToNormal, lcg } from './noise';
import type { TextureBuffers } from './oak';

export interface LinoOptions {
  /** Tile size in mm (the texture repeats every `tile` mm on the pad). */
  tile: number;
  /** Texture size in texels (square). */
  size: number;
  seed: number;
  /** Base colour, sRGB bytes. */
  base: readonly [number, number, number];
  /** Colour modulation by the mottle value p: channel * (1 + mod * p). */
  mottle: number;
  /** Extra green lift: G += greenLift * p. */
  greenLift: number;
  /** Speckles per texel. */
  speckleDensity: number;
  speckleMin: number;
  speckleRange: number;
  lightShare: number;
  lightValue: number;
  darkValue: number;
  blendMin: number;
  blendRange: number;
  roughBase: number;
  roughGain: number;
  normalStrength: number;
}

export const LINO_DEFAULTS: LinoOptions = {
  tile: 96, size: 512, seed: 21,
  base: [143, 154, 140], mottle: 0.045, greenLift: 1.5,
  speckleDensity: 0.004, speckleMin: 0.1, speckleRange: 0.18, lightShare: 0.6, lightValue: 196, darkValue: 104,
  blendMin: 0.35, blendRange: 0.3,
  roughBase: 210, roughGain: 12, normalStrength: 0.8,
};

export function linoTexture(opts: Partial<LinoOptions> = {}): TextureBuffers {
  const o: LinoOptions = { ...LINO_DEFAULTS, ...opts };
  const A = o.size;
  const s = o.seed;
  const s6 = gradientNoise(s, 6), s24 = gradientNoise(s + 3, 24), s64 = gradientNoise(s + 9, 64);
  const g = lcg(s);
  const map = new Uint8ClampedArray(A * A * 4);
  const roughness = new Uint8ClampedArray(A * A * 4);
  const height = new Float32Array(A * A);
  const [R0, G0, B0] = o.base;
  for (let y = 0; y < A; y++) {
    const v = y / A;
    for (let c = 0; c < A; c++) {
      const u = c / A;
      const n24 = s24(24 * u, 24 * v);
      const n64 = s64(64 * u, 64 * v);
      const p = fbm(s6, 6 * u, 6 * v, 2) * 0.6 + n24 * 0.3 + n64 * 0.25;
      const off = (y * A + c) * 4;
      const k = 1 + o.mottle * p;
      map[off] = R0 * k;
      map[off + 1] = G0 * k + o.greenLift * p;
      map[off + 2] = B0 * k;
      map[off + 3] = 255;
      height[y * A + c] = n64 * 0.5 + n24 * 0.3;
      const rb = o.roughBase + o.roughGain * p;
      roughness[off] = rb;
      roughness[off + 1] = rb;
      roughness[off + 2] = rb;
      roughness[off + 3] = 255;
    }
  }
  const m = A / o.tile;
  const count = A * A * o.speckleDensity;
  for (let i = 0; i < count; i++) {
    const cx = g() * A;
    const cy = g() * A;
    const radius = (o.speckleMin + g() * o.speckleRange) * m;
    const light = g() < o.lightShare;
    const blend = o.blendMin + g() * o.blendRange;
    const target = (light ? o.lightValue : o.darkValue) * blend;
    const keep = 1 - blend;
    for (let Y = Math.floor(cy - radius); Y <= cy + radius; Y++) {
      for (let X = Math.floor(cx - radius); X <= cx + radius; X++) {
        if ((X - cx) * (X - cx) + (Y - cy) * (Y - cy) > radius * radius) continue;
        const xx = ((X % A) + A) % A;
        const yy = ((Y % A) + A) % A;
        const off = (yy * A + xx) * 4;
        map[off] = map[off]! * keep + target;
        map[off + 1] = map[off + 1]! * keep + target;
        map[off + 2] = map[off + 2]! * keep + target;
      }
    }
  }
  const normal = heightToNormal(height, A, A, o.normalStrength, true);
  return { width: A, height: A, map, roughness, normal };
}
