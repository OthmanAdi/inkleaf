/** Small deterministic RNG and periodic 2D gradient noise for the procedural book textures. */

/** Linear congruential generator: state = state * 1664525 + 1013904223 mod 2^32, returns state / 2^32. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export type Noise2 = (x: number, y: number) => number;

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise with a lattice that wraps every `period` cells (256 when 0), output scaled by 1.41. */
export function gradientNoise(seed: number, period = 0): Noise2 {
  const r = rng(seed * 977 + 13);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = perm[i]!;
    perm[i] = perm[j]!;
    perm[j] = t;
  }
  const gx = new Float64Array(256), gy = new Float64Array(256);
  for (let i = 0; i < 256; i++) {
    const a = r() * Math.PI * 2;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const P = period || 256;
  const g = (i: number, j: number) => perm[(perm[i & 255]! + j) & 255]!;
  return (x, y) => {
    const xf = Math.floor(x), yf = Math.floor(y);
    const fx = x - xf, fy = y - yf;
    const i0 = ((xf % P) + P) % P, j0 = ((yf % P) + P) % P;
    const i1 = (i0 + 1) % P, j1 = (j0 + 1) % P;
    const a = g(i0, j0), b = g(i1, j0), c = g(i0, j1), d = g(i1, j1);
    const na = gx[a]! * fx + gy[a]! * fy;
    const nb = gx[b]! * (fx - 1) + gy[b]! * fy;
    const nc = gx[c]! * fx + gy[c]! * (fy - 1);
    const nd = gx[d]! * (fx - 1) + gy[d]! * (fy - 1);
    const u = fade(fx), v = fade(fy);
    const top = na + (nb - na) * u, bot = nc + (nd - nc) * u;
    return (top + (bot - top) * v) * 1.41;
  };
}

/** Fractal sum normalised by the sum of amplitudes. */
export function fbm(n: Noise2, x: number, y: number, oct = 4, gain = 0.5): number {
  let sum = 0, amp = 1, norm = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    sum += n(x * f, y * f) * amp;
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}

/** Height field to an RGBA normal map (tangent space, row index increasing with v). */
export function heightToNormal(h: Float32Array, w: number, hgt: number, strength: number, wrap: boolean, out = new Uint8Array(w * hgt * 4)): Uint8Array {
  const at = (x: number, y: number) => {
    if (wrap) {
      x = (x + w) % w;
      y = (y + hgt) % hgt;
    } else {
      x = x < 0 ? 0 : x >= w ? w - 1 : x;
      y = y < 0 ? 0 : y >= hgt ? hgt - 1 : y;
    }
    return h[y * w + x]!;
  };
  for (let y = 0; y < hgt; y++) {
    for (let x = 0; x < w; x++) {
      const nx = (at(x - 1, y) - at(x + 1, y)) * strength;
      const ny = (at(x, y - 1) - at(x, y + 1)) * strength;
      const l = Math.hypot(nx, ny, 1);
      const o = (y * w + x) * 4;
      out[o] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      out[o + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      out[o + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      out[o + 3] = 255;
    }
  }
  return out;
}
