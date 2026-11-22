/** Controls for the sampled reading glass. Values are bounded before rendering. */
export interface LensOptics { zoom: number; refraction: number; dispersion: number }
export const DEFAULT_LENS_OPTICS: Readonly<LensOptics> = { zoom: 2, refraction: 0.38, dispersion: 0.025 };

export function resolveOptics(options: Partial<LensOptics> = {}): LensOptics {
  const bound = (value: number | undefined, fallback: number, min: number, max: number) =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  return {
    zoom: bound(options.zoom, DEFAULT_LENS_OPTICS.zoom, 1, 4),
    refraction: bound(options.refraction, DEFAULT_LENS_OPTICS.refraction, 0, 1),
    dispersion: bound(options.dispersion, DEFAULT_LENS_OPTICS.dispersion, 0, 0.12),
  };
}

/** Inverse radial mapping: the curved edge bends rays more than the clear center. */
export function lensSampleRadius(radius: number, refraction: number, chroma = 0): number {
  const r = Math.max(0, radius);
  const edge = Math.min(1, r * r);
  return r * (1 - refraction * edge * 0.38 + chroma * edge);
}

/** Precompute a bilinear lookup, then reuse it for every live frame. */
export function createRefractionMap(size: number, optics: LensOptics): (source: Uint8ClampedArray, output: Uint8ClampedArray) => void {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('Lens sample size must be an integer of at least two pixels.');
  const pixels = size * size;
  const indices = new Uint32Array(pixels * 3);
  const weights = new Float32Array(pixels * 6);
  const half = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (x - half) / half, dy = (y - half) / half;
    const r = Math.hypot(dx, dy);
    for (let c = 0; c < 3; c++) {
      const mapped = lensSampleRadius(r, optics.refraction, (c - 1) * optics.dispersion);
      const scale = r > 0 ? mapped / r : 1;
      const sx = Math.max(0, Math.min(size - 1.001, half + dx * scale * half));
      const sy = Math.max(0, Math.min(size - 1.001, half + dy * scale * half));
      const ix = Math.floor(sx), iy = Math.floor(sy);
      const p = (y * size + x) * 3 + c;
      indices[p] = (iy * size + ix) * 4 + c;
      weights[p * 2] = sx - ix;
      weights[p * 2 + 1] = sy - iy;
    }
  }
  return (source, output) => {
    for (let i = 0; i < pixels; i++) {
      for (let c = 0; c < 3; c++) {
        const p = i * 3 + c, j = indices[p]!, fx = weights[p * 2]!, fy = weights[p * 2 + 1]!;
        const a = source[j]! + (source[j + 4]! - source[j]!) * fx;
        const b = source[j + size * 4]! + (source[j + size * 4 + 4]! - source[j + size * 4]!) * fx;
        output[i * 4 + c] = a + (b - a) * fy;
      }
      const p = i * 3 + 1, j = indices[p]! + 2, fx = weights[p * 2]!, fy = weights[p * 2 + 1]!;
      const a = source[j]! + (source[j + 4]! - source[j]!) * fx;
      const b = source[j + size * 4]! + (source[j + size * 4 + 4]! - source[j + size * 4]!) * fx;
      output[i * 4 + 3] = a + (b - a) * fy;
    }
  };
}
