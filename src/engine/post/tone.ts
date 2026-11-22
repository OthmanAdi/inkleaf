/**
 * Hue-preserving neutral tone map (the Khronos PBR Neutral curve with a lighter desaturation): exposure, a quadratic
 * toe below `toe`, values under `start` pass unchanged, highlights roll off toward 1 without hue shift and fade
 * slightly toward grey. Applied in linear HDR after bloom and vignette; the glass effect reuses the same curve.
 */
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform } from 'three';

export interface ToneParams { exposure: number; desaturation: number; start: number; toe: number }
export const TONE_DEFAULTS: ToneParams = { exposure: 0.9, desaturation: 0.03, start: 0.76, toe: 0.08 };

/** The curve in JS (tests, colour pickers). Input and output are linear RGB. */
export function toneNeutral(rgb: readonly [number, number, number], p: ToneParams = TONE_DEFAULTS): [number, number, number] {
  let r = Math.max(rgb[0], 0) * p.exposure, g = Math.max(rgb[1], 0) * p.exposure, b = Math.max(rgb[2], 0) * p.exposure;
  const x = Math.min(r, g, b);
  const offset = x < p.toe ? x - (x * x) / (2 * p.toe) : p.toe / 2;
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, g, b);
  if (peak < p.start) return [r, g, b];
  const d = 1 - p.start;
  const newPeak = 1 - (d * d) / (peak + d - p.start);
  const s = newPeak / peak;
  r *= s;
  g *= s;
  b *= s;
  const k = 1 - 1 / (p.desaturation * (peak - newPeak) + 1);
  return [r + (newPeak - r) * k, g + (newPeak - g) * k, b + (newPeak - b) * k];
}

/** GLSL of the curve, parameterised by uniforms named with `prefix` (shared by the tone and glass effects). */
export const toneGlsl = (fn: string, u: { desat: string; start: string; toe: string }) => /* glsl */ `
vec3 ${fn}(vec3 c, float exposure) {
  c = max(c, 0.0) * exposure;
  float x = min(c.r, min(c.g, c.b));
  float offset = x < ${u.toe} ? x - x * x / (2.0 * ${u.toe}) : 0.5 * ${u.toe};
  c -= offset;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < ${u.start}) return c;
  float d = 1.0 - ${u.start};
  float newPeak = 1.0 - d * d / (peak + d - ${u.start});
  c *= newPeak / peak;
  float g = 1.0 - 1.0 / (${u.desat} * (peak - newPeak) + 1.0);
  return mix(c, vec3(newPeak), g);
}
`;

const fragment = /* glsl */ `
uniform float uExposure;
uniform float uDesat;
uniform float uStart;
uniform float uToe;
${toneGlsl('toneNeutral', { desat: 'uDesat', start: 'uStart', toe: 'uToe' })}
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  outputColor = vec4(toneNeutral(inputColor.rgb, uExposure), inputColor.a);
}
`;

export class HueToneEffect extends Effect {
  constructor(p: ToneParams = TONE_DEFAULTS) {
    super('HueToneMap', fragment, {
      attributes: EffectAttribute.NONE,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uExposure', new Uniform(p.exposure)],
        ['uDesat', new Uniform(p.desaturation)],
        ['uStart', new Uniform(p.start)],
        ['uToe', new Uniform(p.toe)],
      ]),
    });
  }

  private u(name: string): Uniform<number> {
    return this.uniforms.get(name) as Uniform<number>;
  }

  get exposure(): number { return this.u('uExposure').value; }
  set exposure(v: number) { this.u('uExposure').value = v; }
  get desaturation(): number { return this.u('uDesat').value; }
  set desaturation(v: number) { this.u('uDesat').value = v; }
  get start(): number { return this.u('uStart').value; }
  set start(v: number) { this.u('uStart').value = v; }
  get toe(): number { return this.u('uToe').value; }
  set toe(v: number) { this.u('uToe').value = v; }
}

/** The vignette factor of the library's default technique: smoothstep(0.8, offset * 0.799, d * (darkness + offset)). */
export function vignetteFactor(d: number, offset = 0.24, darkness = 0.52): number {
  const e0 = 0.8, e1 = offset * 0.799;
  let t = (d * (darkness + offset) - e0) / (e1 - e0);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
