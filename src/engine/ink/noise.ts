/**
 * Deterministic CPU noise for the pen: an integer hash to [0, 1), smooth 1D value noise (stroke pressure) and
 * trilinear 3D value noise (optional stroke wobble). Same seed, same stroke, on every machine.
 */

/** Cubic smoothstep `x²(3 - 2x)` without clamping (callers pass 0..1). */
export const smooth = (x: number) => x * x * (3 - 2 * x);

/** `S(sat(x))`: the clamped cubic used by every fade in the pop life cycle. */
export const S01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

/** GLSL-style `smoothstep(a, b, x)` (works for a > b too). */
export const smoothstep = (a: number, b: number, x: number) => S01((x - a) / (b - a));

/** Integer hash to [0, 1): xor with the golden ratio constant, then two multiply-xorshift rounds. */
export function hash(n: number): number {
  let t = (n | 0) ^ 0x9e3779b9;
  t = Math.imul(t ^ (t >>> 16), 0x85ebca6b);
  t = Math.imul(t ^ (t >>> 13), 0xc2b2ae35);
  t ^= t >>> 16;
  return (t >>> 0) / 4294967296;
}

/** Smooth 1D value noise in [0, 1): lattice values `hash(k·7919 + i)` blended with the cubic fade. */
export function noise1(k: number, x: number): number {
  const i = Math.floor(x);
  const base = Math.imul(k | 0, 7919) + i;
  const h0 = hash(base);
  const h1 = hash(base + 1);
  return h0 + (h1 - h0) * smooth(x - i);
}

function lattice(ix: number, iy: number, iz: number, seed: number): number {
  return hash(Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^ Math.imul(iz, 83492791) ^ Math.imul(seed | 0, 2654435761 | 0));
}

/** Trilinear 3D value noise in [0, 1) with the cubic fade. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const c000 = lattice(ix, iy, iz, seed), c100 = lattice(ix + 1, iy, iz, seed);
  const c010 = lattice(ix, iy + 1, iz, seed), c110 = lattice(ix + 1, iy + 1, iz, seed);
  const c001 = lattice(ix, iy, iz + 1, seed), c101 = lattice(ix + 1, iy, iz + 1, seed);
  const c011 = lattice(ix, iy + 1, iz + 1, seed), c111 = lattice(ix + 1, iy + 1, iz + 1, seed);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy, y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}
