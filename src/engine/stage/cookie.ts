/**
 * The window cookie (gobo) of the key spot light: a grey mask projected with the light's shadow matrix so the desk,
 * the pad and the book receive soft shadows of a four-pane window frame with a mullion cross. The mask is defined
 * per light ray: each texel's ray is intersected with the desk plane and evaluated in window coordinates there, so
 * objects above the desk get consistent window shading.
 */
import { DataTexture, LinearFilter, Matrix4, RGBAFormat, UnsignedByteType, Vector3, type SpotLight } from 'three';

export interface CookieOptions {
  size: number;
  /** Desk-plane point where the two bars cross (world x, z). */
  crossX: number;
  crossZ: number;
  /** Window opening across the light axis (T) and along it (A), mm on the desk relative to the cross point. */
  tMin: number;
  tMax: number;
  aMin: number;
  aMax: number;
  /** Edge softness of the outer frame, mm. */
  softness: number;
  /** Full width of the bar running along the light axis, mm. */
  barAlong: number;
  /** Full width of the bar running across the light axis, mm. */
  barAcross: number;
  /** Half width of the smoothstep that softens each bar edge, mm. */
  barSoftness: number;
}

export const COOKIE_DEFAULTS: CookieOptions = {
  size: 512, crossX: -560, crossZ: -210, tMin: -700, tMax: 620, aMin: -900, aMax: 980,
  softness: 26, barAlong: 30, barAcross: 44, barSoftness: 15.6,
};

export const smoothstep = (e0: number, e1: number, x: number): number => {
  let t = (x - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
};

/** Light transmitted at window coordinates (T across, A along the light axis), 0..1. */
export function cookieValue(T: number, A: number, o: CookieOptions = COOKIE_DEFAULTS): number {
  const r = o.softness;
  const box = (x: number, lo: number, hi: number) => smoothstep(lo - r, lo + r, x) * (1 - smoothstep(hi - r, hi + r, x));
  let C = box(T, o.tMin, o.tMax) * box(A, o.aMin, o.aMax);
  const ha = o.barAlong / 2, hc = o.barAcross / 2, s = o.barSoftness;
  C *= smoothstep(ha - s, ha + s, Math.abs(T));
  C *= smoothstep(hc - s, hc + s, Math.abs(A));
  return C;
}

/**
 * Computes the cookie bytes (RGBA, grey) for a light. `unproject` is shadowCamera.matrixWorld x
 * projectionMatrixInverse. Rows are stored bottom-up (row 0 = v 0), ready for a DataTexture with flipY false.
 */
export function cookieBytes(
  unproject: Matrix4, light: { x: number; y: number; z: number }, target: { x: number; z: number }, deskTop: number,
  o: CookieOptions = COOKIE_DEFAULTS, out: Uint8ClampedArray<ArrayBufferLike> = new Uint8ClampedArray(o.size * o.size * 4),
): Uint8ClampedArray<ArrayBufferLike> {
  const n = o.size;
  let dx = target.x - light.x, dz = target.z - light.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  const mx = dz, mz = -dx;
  const e = unproject.elements;
  for (let r = 0; r < n; r++) {
    const ny = (r + 0.5) / n * 2 - 1;
    for (let c = 0; c < n; c++) {
      const nx = (c + 0.5) / n * 2 - 1;
      const w = e[3]! * nx + e[7]! * ny + e[11]! * 0.5 + e[15]!;
      const qx = (e[0]! * nx + e[4]! * ny + e[8]! * 0.5 + e[12]!) / w;
      const qy = (e[1]! * nx + e[5]! * ny + e[9]! * 0.5 + e[13]!) / w;
      const qz = (e[2]! * nx + e[6]! * ny + e[10]! * 0.5 + e[14]!) / w;
      const ry = qy - light.y;
      let C = 0;
      if (ry < -1e-9) {
        const s = (deskTop - light.y) / ry;
        const X = light.x + (qx - light.x) * s;
        const Z = light.z + (qz - light.z) * s;
        const kx = X - o.crossX, kz = Z - o.crossZ;
        C = cookieValue(kx * mx + kz * mz, kx * dx + kz * dz, o);
      }
      const v = 255 * C;
      const off = (r * n + c) * 4;
      out[off] = v;
      out[off + 1] = v;
      out[off + 2] = v;
      out[off + 3] = 255;
    }
  }
  return out;
}

const _m = new Matrix4();
const _l = new Vector3();
const _t = new Vector3();

/** Builds (or refreshes) the cookie texture for a spot light and assigns it to `light.map`. */
export function applyWindowCookie(light: SpotLight, deskTop: number, o: CookieOptions = COOKIE_DEFAULTS, reuse?: DataTexture): DataTexture {
  light.updateMatrixWorld(true);
  light.target.updateMatrixWorld(true);
  light.shadow.updateMatrices(light);
  const cam = light.shadow.camera;
  _m.multiplyMatrices(cam.matrixWorld, cam.projectionMatrixInverse);
  light.getWorldPosition(_l);
  light.target.getWorldPosition(_t);
  let tex = reuse;
  if (!tex || tex.image.width !== o.size) {
    tex?.dispose();
    tex = new DataTexture(new Uint8ClampedArray(o.size * o.size * 4), o.size, o.size, RGBAFormat, UnsignedByteType);
    tex.minFilter = LinearFilter;
    tex.magFilter = LinearFilter;
    tex.generateMipmaps = false;
    tex.name = 'light.key.cookie';
  }
  cookieBytes(_m, _l, _t, deskTop, o, tex.image.data as unknown as Uint8ClampedArray);
  tex.needsUpdate = true;
  light.map = tex;
  return tex;
}
