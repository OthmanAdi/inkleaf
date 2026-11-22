/**
 * Colour blend along the hue circle, the short way round, in linear working space. Kinetic blue to thermal orange
 * passes through magenta (not grey): the colour itself says energy is changing store.
 */
import type { Color } from 'three';
import { energyConfig } from './config';

export interface Rgb { r: number; g: number; b: number }
export interface Hsv { h: number; s: number; v: number }

const fract = (x: number) => x - Math.floor(x);

export function rgbToHsv(c: Rgb, out: Hsv = { h: 0, s: 0, v: 0 }): Hsv {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6 : 0);
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h /= 6;
  }
  out.h = h;
  out.s = max > 0 ? d / max : 0;
  out.v = max;
  return out;
}

export function hsvToRgb(h: number, s: number, v: number, out: Rgb): Rgb {
  const ch = (n: number) => {
    const k = (((n + 6 * h) % 6) + 6) % 6;
    return v - v * s * Math.min(1, Math.max(0, Math.min(k, 4 - k)));
  };
  out.r = ch(5);
  out.g = ch(3);
  out.b = ch(1);
  return out;
}

/** Signed hue difference B - A wrapped to [-0.5, 0.5]. */
export function hueDelta(a: Rgb, b: Rgb): number {
  const ha = rgbToHsv(a, scratchA).h;
  const hb = rgbToHsv(b, scratchB).h;
  const dh = hb - ha;
  return dh - Math.floor(dh + 0.5);
}

/** Blend half width: 0.36 for equal hues down to 0.05 for distant ones. */
export function blendHalfWidth(a: Rgb, b: Rgb): number {
  const { hwMax, hwMin, hwGain } = energyConfig.hue;
  return hwMax + (hwMin - hwMax) * Math.min(1, hwGain * Math.abs(hueDelta(a, b)));
}

const scratchA: Hsv = { h: 0, s: 0, v: 0 };
const scratchB: Hsv = { h: 0, s: 0, v: 0 };

/** Blends A to B at t: hue the short way round, saturation and value linearly. Writes `out`. */
export function hueBlend<T extends Rgb>(a: Rgb, b: Rgb, t: number, out: T): T {
  const A = rgbToHsv(a, scratchA);
  const B = rgbToHsv(b, scratchB);
  let dh = B.h - A.h;
  dh -= Math.floor(dh + 0.5);
  const h = fract(A.h + dh * t);
  hsvToRgb(h, A.s + (B.s - A.s) * t, A.v + (B.v - A.v) * t, out);
  return out;
}

export const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Blend parameter along a flow: smoothstep(0.5 - hw, 0.5 + hw, u). */
export const flowBlendT = (u: number, hw: number): number => smoothstep(0.5 - hw, 0.5 + hw, u);

/** GLSL: the same blend for shaders. Defines `vec3 hueBlend(vec3 a, vec3 b, float t)` and `float hueDelta(vec3, vec3)`. */
export const HUE_GLSL = /* glsl */ `
vec3 ilRgb2hsv(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float d = mx - mn;
  float h = 0.0;
  if (d > 0.0) {
    if (mx == c.r) h = (c.g - c.b) / d + (c.g < c.b ? 6.0 : 0.0);
    else if (mx == c.g) h = (c.b - c.r) / d + 2.0;
    else h = (c.r - c.g) / d + 4.0;
    h /= 6.0;
  }
  return vec3(h, mx > 0.0 ? d / mx : 0.0, mx);
}
vec3 ilHsv2rgb(float h, float s, float v) {
  vec3 n = vec3(5.0, 3.0, 1.0);
  vec3 k = mod(n + 6.0 * h, 6.0);
  return v - v * s * clamp(min(k, 4.0 - k), 0.0, 1.0);
}
float hueDelta(vec3 a, vec3 b) {
  float dh = ilRgb2hsv(b).x - ilRgb2hsv(a).x;
  return dh - floor(dh + 0.5);
}
vec3 hueBlend(vec3 a, vec3 b, float t) {
  vec3 A = ilRgb2hsv(a);
  vec3 B = ilRgb2hsv(b);
  float dh = B.x - A.x;
  dh -= floor(dh + 0.5);
  return ilHsv2rgb(fract(A.x + dh * t), mix(A.y, B.y, t), mix(A.z, B.z, t));
}
`;

/** Copies a three Color into a plain Rgb (no allocation when `out` is given). */
export const toRgb = (c: Color, out: Rgb = { r: 0, g: 0, b: 0 }): Rgb => ((out.r = c.r), (out.g = c.g), (out.b = c.b), out);
