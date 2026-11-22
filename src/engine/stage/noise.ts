/**
 * Deterministic randomness and noise shared by the procedural desk textures. Same seed, same bytes, on every
 * machine: a 32-bit LCG, a seeded 2D gradient noise with optional integer tiling period, an fBm sum, and a height
 * field to tangent-space normal map converter. Pure functions, no three.js.
 */

/** 32-bit LCG (Numerical Recipes constants). Each call advances the state, then returns state / 2^32 in [0, 1). */
export function lcg(seed: number): () => number {
  let t = seed >>> 0 || 1;
  return () => {
    t = (Math.imul(t, 1664525) + 1013904223) >>> 0;
    return t / 4294967296;
  };
}

export type Noise2 = (x: number, y: number) => number;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Seeded 2D gradient noise. The value is 0 at lattice points and roughly in [-1, 1]. With `period > 0` the lattice
 * wraps every `period` units, so a texture sampled over whole periods tiles seamlessly.
 */
export function gradientNoise(seed: number, period = 0): Noise2 {
  const rand = lcg(seed * 977 + 13);
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  for (let l = 255; l >= 1; l--) {
    const j = Math.floor(rand() * (l + 1));
    const tmp = s[l]!;
    s[l] = s[j]!;
    s[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = s[i & 255]!;
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const th = rand() * Math.PI * 2;
    gx[i] = Math.cos(th);
    gy[i] = Math.sin(th);
  }
  const P = period > 0 ? period : 256;
  const hash = (I: number, J: number) => perm[(perm[I & 255]! + J) & 255]!;
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const u = ((xi % P) + P) % P;
    const v = ((yi % P) + P) % P;
    const u1 = (u + 1) % P;
    const v1 = (v + 1) % P;
    const h00 = hash(u, v), h10 = hash(u1, v), h01 = hash(u, v1), h11 = hash(u1, v1);
    const n00 = gx[h00]! * fx + gy[h00]! * fy;
    const n10 = gx[h10]! * (fx - 1) + gy[h10]! * fy;
    const n01 = gx[h01]! * fx + gy[h01]! * (fy - 1);
    const n11 = gx[h11]! * (fx - 1) + gy[h11]! * (fy - 1);
    const sx = fade(fx);
    const sy = fade(fy);
    const a = n00 + (n10 - n00) * sx;
    const b = n01 + (n11 - n01) * sx;
    return (a + (b - a) * sy) * 1.41;
  };
}

/** Fractional Brownian motion: octaves of `n` at doubling frequency, weighted by gain^k, normalised by the weight sum. */
export function fbm(n: Noise2, x: number, y: number, octaves = 4, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let k = 0; k < octaves; k++) {
    sum += n(x * f, y * f) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/**
 * Height field to an RGBA8 tangent-space normal map. Neighbours either wrap (tileable) or clamp at the border.
 * dx = (h[x-1] - h[x+1]) * strength, dy likewise along rows, n = normalize(dx, dy, 1), byte = (n * 0.5 + 0.5) * 255.
 */
export function heightToNormal(height: Float32Array, w: number, h: number, strength: number, wrap: boolean, out = new Uint8ClampedArray(w * h * 4)): Uint8ClampedArray {
  for (let y = 0; y < h; y++) {
    const ym = wrap ? (y - 1 + h) % h : Math.max(0, y - 1);
    const yp = wrap ? (y + 1) % h : Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xm = wrap ? (x - 1 + w) % w : Math.max(0, x - 1);
      const xp = wrap ? (x + 1) % w : Math.min(w - 1, x + 1);
      const dx = (height[y * w + xm]! - height[y * w + xp]!) * strength;
      const dy = (height[ym * w + x]! - height[yp * w + x]!) * strength;
      const len = Math.sqrt(dx * dx + dy * dy + 1);
      const o = (y * w + x) * 4;
      out[o] = (dx / len * 0.5 + 0.5) * 255;
      out[o + 1] = (dy / len * 0.5 + 0.5) * 255;
      out[o + 2] = (1 / len * 0.5 + 0.5) * 255;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** FNV-1a over bytes: a cheap fingerprint for golden tests of generated textures. */
export function fnv1a(bytes: ArrayLike<number>): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i]!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
