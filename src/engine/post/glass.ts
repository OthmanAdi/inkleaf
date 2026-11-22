/**
 * Liquid glass: refracts the rendered frame under up to eight rounded rectangles (the capsule toolbar, cards, the
 * magnifier disc). Inside a rect the untonemapped frame is sampled with an edge-weighted refraction, a chromatic
 * split, a soft 5x5 frost blur (or a magnified, unblurred view for a lens), then tone mapped with the frame's own
 * curve, frosted, and lit with a bright top-left rim. Outside, each rect drops a soft shadow 7 px below.
 * Runs after the tone map; rect coordinates are device pixels with a top-left origin.
 */
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import { Uniform, Vector2, Vector3, Vector4 } from 'three';
import type { GlassRect } from '../contracts';
import { TONE_DEFAULTS, toneGlsl } from './tone';

export const GLASS_MAX = 8;

export interface GlassParams {
  refraction: number; bandMax: number; bandFraction: number; chroma: number;
  lensChroma: number; press: number; lensRefraction: number; blurStep: number;
  shadowOffset: number; shadowBlur: number; shadowAlpha: number; blurFalloff: number;
  frostTint: readonly [number, number, number]; frostGain: number; frostLift: number;
  rimOffset: number; rimWidth: number; rimSpec: number; rimDark: number;
  rimSpecBase: number; inner: number; chromaR: number; chromaB: number;
  light: readonly [number, number]; edgeAA: number;
}

export const GLASS_DEFAULTS: GlassParams = {
  refraction: 30, bandMax: 24, bandFraction: 0.9, chroma: 3,
  lensChroma: 1.5, press: 0.6, lensRefraction: 0.6, blurStep: 3.4,
  shadowOffset: 7, shadowBlur: 20, shadowAlpha: 0.16, blurFalloff: 0.12,
  frostTint: [1, 0.985, 0.96], frostGain: 1.04, frostLift: 0.015,
  rimOffset: 1.1, rimWidth: 2.4, rimSpec: 0.55, rimDark: 0.08,
  rimSpecBase: 0.45, inner: 0.06, chromaR: 1.08, chromaB: 0.92,
  light: [-0.6, -0.8], edgeAA: 0.8,
};

const fragment = /* glsl */ `
uniform vec4 uRects[8];
uniform vec4 uStyle[8];
uniform vec4 uExtra[8];
uniform float uCount;
uniform vec2 uRes;
uniform float uExposure;
uniform float uDesat;
uniform float uStart;
uniform float uToe;
uniform vec4 uP0;
uniform vec4 uP1;
uniform vec4 uP2;
uniform vec4 uRim;
uniform vec4 uRim2;
uniform vec3 uFrostTint;
uniform vec4 uFrost;
uniform float uEdgeAA;

${toneGlsl('glassTone', { desat: 'uDesat', start: 'uStart', toe: 'uToe' })}

float glassSd(vec2 p, vec2 hb, float r) {
  vec2 q = abs(p) - hb + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec3 glassBlur(vec2 at) {
  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  vec2 stepUv = uP1.w / uRes;
  for (int i = -2; i <= 2; i++) {
    for (int j = -2; j <= 2; j++) {
      float w = 1.0 - uP2.w * float(i * i + j * j);
      acc += textureLod(inputBuffer, at + vec2(float(i), float(j)) * stepUv, 0.0).rgb * w;
      wsum += w;
    }
  }
  return acc / wsum;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  float shade = 0.0;
  vec2 fragPx = vec2(uv.x * uRes.x, (1.0 - uv.y) * uRes.y);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= uCount) break;
    vec4 rect = uRects[i];
    vec4 style = uStyle[i];
    float strength = style.z;
    if (strength < 0.01) continue;
    vec2 hb = rect.zw * 0.5;
    vec2 ctr = rect.xy + hb;
    vec2 p = fragPx - ctr;
    float rad = min(style.x, min(hb.x, hb.y));
    float sd = glassSd(p, hb, rad);
    if (sd > 0.0) {
      float sd2 = glassSd(p - vec2(0.0, uP2.x), hb, rad);
      shade = max(shade, (1.0 - smoothstep(0.0, uP2.y, sd2)) * uP2.z * strength);
      continue;
    }
    vec2 grad = vec2(
      glassSd(p + vec2(1.0, 0.0), hb, rad) - glassSd(p - vec2(1.0, 0.0), hb, rad),
      glassSd(p + vec2(0.0, 1.0), hb, rad) - glassSd(p - vec2(0.0, 1.0), hb, rad));
    vec2 n = normalize(grad + 1e-5);
    float band = min(uP0.y, uP0.z * min(hb.x, hb.y));
    float edgeW = 1.0 - smoothstep(0.0, band, -sd);
    float lensW = edgeW * edgeW * (1.0 + uP1.y * style.w);
    vec2 off = -n * lensW * uP0.x / uRes;
    off.y = -off.y;
    float disp = edgeW * edgeW * uP0.w / uRes.x;
    vec3 refr;
    float zoom = uExtra[i].x;
    if (zoom > 1.01) {
      vec2 cuv = vec2(ctr.x / uRes.x, 1.0 - ctr.y / uRes.y);
      vec2 zuv = cuv + (uv - cuv) / zoom + uP1.z * off;
      refr.r = textureLod(inputBuffer, zuv + vec2(uP1.x * disp, 0.0), 0.0).r;
      refr.g = textureLod(inputBuffer, zuv, 0.0).g;
      refr.b = textureLod(inputBuffer, zuv - vec2(uP1.x * disp, 0.0), 0.0).b;
    } else {
      refr.r = glassBlur(uv + uRim2.z * off + vec2(disp, 0.0)).r;
      refr.g = glassBlur(uv + off).g;
      refr.b = glassBlur(uv + uRim2.w * off - vec2(disp, 0.0)).b;
    }
    vec3 f = glassTone(refr, uExposure);
    f = mix(f, uFrostTint, style.y);
    f = f * uFrost.x + uFrost.y;
    float rim = smoothstep(uRim.y, 0.0, abs(sd + uRim.x));
    vec2 lg = normalize(uFrost.zw);
    float nl = dot(n, lg);
    float spec = rim * (uRim2.x + (1.0 - uRim2.x) * max(0.0, nl));
    float dark = rim * max(0.0, -nl);
    float inner = edgeW * max(0.0, n.y) * uRim2.y;
    f += uRim.z * spec;
    f -= uRim.w * dark + inner;
    col = mix(col, f, smoothstep(uEdgeAA, -uEdgeAA, sd) * strength);
    shade = 0.0;
  }
  outputColor = vec4(col * (1.0 - shade), inputColor.a);
}
`;

export class LiquidGlassEffect extends Effect {
  readonly rects: Vector4[];
  readonly styles: Vector4[];
  readonly extras: Vector4[];

  constructor(p: GlassParams = GLASS_DEFAULTS) {
    const rects = Array.from({ length: GLASS_MAX }, () => new Vector4());
    const styles = Array.from({ length: GLASS_MAX }, () => new Vector4());
    const extras = Array.from({ length: GLASS_MAX }, () => new Vector4(1, 0, 0, 0));
    super('LiquidGlass', fragment, {
      attributes: EffectAttribute.NONE,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['uRects', new Uniform(rects)],
        ['uStyle', new Uniform(styles)],
        ['uExtra', new Uniform(extras)],
        ['uCount', new Uniform(0)],
        ['uRes', new Uniform(new Vector2(1, 1))],
        ['uExposure', new Uniform(TONE_DEFAULTS.exposure)],
        ['uDesat', new Uniform(TONE_DEFAULTS.desaturation)],
        ['uStart', new Uniform(TONE_DEFAULTS.start)],
        ['uToe', new Uniform(TONE_DEFAULTS.toe)],
        ['uP0', new Uniform(new Vector4())],
        ['uP1', new Uniform(new Vector4())],
        ['uP2', new Uniform(new Vector4())],
        ['uRim', new Uniform(new Vector4())],
        ['uRim2', new Uniform(new Vector4())],
        ['uFrostTint', new Uniform(new Vector3())],
        ['uFrost', new Uniform(new Vector4())],
        ['uEdgeAA', new Uniform(0.8)],
      ]),
    });
    this.rects = rects;
    this.styles = styles;
    this.extras = extras;
    this.setParams(p);
  }

  private uv<T>(name: string): Uniform<T> {
    return this.uniforms.get(name) as Uniform<T>;
  }

  setParams(p: GlassParams): void {
    this.uv<Vector4>('uP0').value.set(p.refraction, p.bandMax, p.bandFraction, p.chroma);
    this.uv<Vector4>('uP1').value.set(p.lensChroma, p.press, p.lensRefraction, p.blurStep);
    this.uv<Vector4>('uP2').value.set(p.shadowOffset, p.shadowBlur, p.shadowAlpha, p.blurFalloff);
    this.uv<Vector4>('uRim').value.set(p.rimOffset, p.rimWidth, p.rimSpec, p.rimDark);
    this.uv<Vector4>('uRim2').value.set(p.rimSpecBase, p.inner, p.chromaR, p.chromaB);
    this.uv<Vector3>('uFrostTint').value.set(p.frostTint[0], p.frostTint[1], p.frostTint[2]);
    this.uv<Vector4>('uFrost').value.set(p.frostGain, p.frostLift, p.light[0], p.light[1]);
    this.uv<number>('uEdgeAA').value = p.edgeAA;
  }

  /** Tone curve of the refracted samples; keep it equal to the frame's tone map. */
  setTone(exposure: number, desaturation: number, start: number, toe: number): void {
    this.uv<number>('uExposure').value = exposure;
    this.uv<number>('uDesat').value = desaturation;
    this.uv<number>('uStart').value = start;
    this.uv<number>('uToe').value = toe;
  }

  /** Viewport size in device pixels (CSS size x pixel ratio). */
  setResolution(width: number, height: number): void {
    this.uv<Vector2>('uRes').value.set(width, height);
  }

  setRects(list: readonly GlassRect[]): void {
    const n = Math.min(GLASS_MAX, list.length);
    for (let i = 0; i < n; i++) {
      const r = list[i]!;
      this.rects[i]!.set(r.x, r.y, r.w, r.h);
      this.styles[i]!.set(r.radius, r.tint, r.strength, r.pressed ? 1 : 0);
      this.extras[i]!.x = r.zoom;
    }
    this.uv<number>('uCount').value = n;
  }

  get count(): number {
    return this.uv<number>('uCount').value;
  }
}
