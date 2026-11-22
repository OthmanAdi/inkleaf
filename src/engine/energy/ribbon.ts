/**
 * A sankey ribbon: a flat glowing band whose width is proportional to power. Bands taper, split into lanes, carry
 * rays, waver when heating, reveal as the energy arrives and fade at their ends. Several bands chain end to end.
 */
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, DoubleSide, Group, Mesh, ShaderMaterial, Vector2, Vector3,
  type IUniform, type Object3D,
} from 'three';
import type { GlowSource } from '../contracts';
import type { Registry } from '../core/registry';
import { energyConfig, registerEnergy } from './config';
import { HUE_GLSL, hueDelta } from './hue';
import { defaultPalette, modeIndex, type Palette, type Pathway, type PathwayMode } from './palette';
import type { ColorSource } from './stream';

export interface RibbonOptions {
  id?: string;
  label?: string;
  registry?: Registry;
  palette?: Palette;
  points: readonly Vector3[];
  from: ColorSource;
  to?: ColorSource;
  pathway?: string;
  segments?: number;
  /** Width profile along the band (1 = full). */
  widthAt?: (u: number) => number;
  /** Twist of the band about its tangent (radians). */
  twistAt?: (u: number) => number;
  /** Preferred band normal at u. */
  face?: (u: number) => Vector3;
  taperIn?: number;
  taperOut?: number;
  /** Fade toward the end (0..1). */
  fade?: number;
  fadeIn?: number;
  lanes?: number;
  tension?: 'centripetal' | 'chordal' | 'catmullrom';
  blend?: readonly [number, number];
  /** Shared drawing-buffer size uniform (the pop's uRes); default 1600 x 900. */
  res?: IUniform<Vector2>;
  /** Hairline floor: bands never draw thinner than this many pixels. */
  minPx?: number;
  parent?: Object3D;
}

/** Ribbon speed (mm/s) per pathway mode at a level. */
export function ribbonSpeed(mode: PathwayMode, level: number): number {
  const R = energyConfig.ribbon;
  switch (mode) {
    case 'electrical': return R.electrical;
    case 'heating': return R.heating;
    case 'radiation': return R.radiation;
    default: return R.mechanical + R.mechanicalGain * level;
  }
}

/** Width of a band carrying P watts: max(minWidth, P mmPerW), or 0 without power. */
export const ribbonWidth = (P: number, mmPerW = energyConfig.ribbon.mmPerW, minWidth = 0): number => (P > 1e-9 ? Math.max(minWidth, P * mmPerW) : 0);

const VERTEX = /* glsl */ `
attribute vec3 aSide;
attribute vec3 aNrm;
attribute float aV;
attribute float aU;
attribute float aW;
uniform float uWidth, uGlow, uTime, uLen, uMode, uTaperIn, uTaperOut, uMinPx, uWidthGate;
uniform vec2 uRes;
varying float vU;
varying float vV;
void main() {
  float taper = 1.0;
  if (uTaperIn > 0.0) taper *= 0.4 + 0.6 * smoothstep(0.0, uTaperIn, aU);
  if (uTaperOut > 0.0) taper *= 0.4 + 0.6 * (1.0 - smoothstep(1.0 - uTaperOut, 1.0, aU));
  float gk = clamp(uWidthGate * uGlow, 0.0, 1.0) * step(1e-6, uWidth);
  float w = 0.5 * uWidth * aW * taper * gk;
  float s = aU * uLen;
  vec3 c = position;
  vec3 p = c + aSide * aV * w;
  if (uMode > 1.5 && uMode < 2.5) {
    float amp = (0.35 + 0.12 * uWidth) * smoothstep(0.0, 0.15, aU) * gk;
    p += aNrm * amp * sin(0.16 * s - 1.3 * uTime + 0.8 * aV);
    c += aNrm * amp * sin(0.16 * s - 1.3 * uTime);
    p += aSide * aV * w * 0.12 * sin(0.11 * s - 0.9 * uTime);
  }
  mat4 pmv = projectionMatrix * modelViewMatrix;
  vec4 clipC = pmv * vec4(c, 1.0);
  vec4 clip = pmv * vec4(p, 1.0);
  if (uMinPx > 0.0 && gk > 0.0) {
    float pxPerMm = 0.5 * uRes.y * projectionMatrix[1][1] / clipC.w;
    if (w * pxPerMm < 0.5 * uMinPx) {
      vec4 clipT = pmv * vec4(c + normalize(cross(aSide, aNrm)), 1.0);
      vec2 d = clipT.xy / clipT.w - clipC.xy / clipC.w;
      d *= 0.5 * uRes;
      d = length(d) > 1e-6 ? normalize(d) : vec2(1.0, 0.0);
      vec2 off = vec2(-d.y, d.x) * aV * 0.5 * uMinPx * gk;
      clip = clipC;
      clip.xy += off / (0.5 * uRes) * clipC.w;
    }
  }
  vU = aU;
  vV = aV;
  gl_Position = clip;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uGlow, uTime, uSpeed, uLen, uMode, uLanes, uReveal, uFade, uFadeIn, uDh, uBlendNarrow;
uniform float uSplit, uSplitSide, uMode2, uRaySpeed, uShimmer;
uniform vec2 uBlend;
varying float vU;
varying float vV;
${HUE_GLSL}
float pattern(float mode, float s, float T, float S) {
  float f = 1.0;
  if (mode < 0.5) {
    f = 0.82 + 0.18 * sin(0.35 * (s - T * S) + 0.6 * vV);
    if (uLanes > 1.5) {
      float lp = (0.5 * vV + 0.5) * uLanes;
      float lf = fract(lp);
      f *= 0.12 + 0.88 * smoothstep(0.08, 0.3, lf) * (1.0 - smoothstep(0.7, 0.92, lf));
      f *= 0.85 + 0.3 * step(0.5, fract((s - T * S) / 14.0 + 0.41 * floor(lp)));
    }
  } else if (mode < 1.5) {
    float k = fract((s - 3.0 * T * S) / 16.0);
    f = 0.6 + 1.1 * smoothstep(0.72, 0.96, k) * (1.0 - smoothstep(0.96, 1.0, k));
  } else if (mode < 2.5) {
    f = 0.8 + 0.2 * sin(0.2 * (s - uShimmer * T) + sin(0.07 * s + T) + 1.4 * vV);
    float q = 3.0 * (0.5 * vV + 0.5) + 0.16 * sin(0.42 * s - 2.2 * T);
    float d = abs(fract(q) - 0.5);
    f *= 0.72 + 0.28 * smoothstep(0.32, 0.46, d);
  } else {
    float lp = (0.5 * vV + 0.5) * uLanes;
    float lane = floor(lp);
    float lf = fract(lp);
    float g = fract(0.618 * lane);
    float k = fract((s - uRaySpeed * T) / (11.0 + 3.0 * g) + 3.7 * g);
    f = 0.32 + step(0.36, k);
    if (uLanes > 1.5) f = mix(0.18, f, smoothstep(0.0, 0.22, lf) * (1.0 - smoothstep(0.78, 1.0, lf)));
  }
  return f;
}
void main() {
  if (vU > uReveal) discard;
  float s = vU * uLen;
  float mode = uMode;
  float seam = 1.0;
  if (uSplit > 0.0) {
    float edge = uSplitSide * vV;
    float cut = 1.0 - 2.0 * uSplit;
    if (edge > cut) mode = uMode2;
    seam = 0.55 + 0.45 * smoothstep(0.0, 0.07, abs(edge - cut));
  }
  float bm = 0.5 * (uBlend.x + uBlend.y);
  float bh = 0.5 * (uBlend.y - uBlend.x) * mix(1.0, uBlendNarrow, clamp(3.5 * abs(uDh), 0.0, 1.0));
  vec3 c = hueBlend(uA, uB, smoothstep(bm - bh, bm + bh, vU));
  float body = 0.66 + 0.34 * (1.0 - vV * vV) + 0.18 * smoothstep(0.82, 1.0, abs(vV));
  float f = pattern(mode, s, uTime, uSpeed);
  f *= 1.0 + 0.6 * smoothstep(uReveal - 0.04, uReveal, vU) * step(uReveal, 0.999);
  float alpha = (1.0 - uFade * smoothstep(0.5, 1.0, vU)) * mix(1.0, smoothstep(0.0, 0.5, vU), uFadeIn);
  gl_FragColor = vec4(c * max(uGlow, 1.0) * body * f * seam, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

const _t = new Vector3();
const _up = new Vector3();
const UP = new Vector3(0, 1, 0);
const BACK = new Vector3(0, 0, 1);
const XAX = new Vector3(1, 0, 0);

export class Ribbon {
  readonly id: string | undefined;
  readonly group = new Group();
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  readonly curve: CatmullRomCurve3;
  readonly len: number;
  readonly palette: Palette;
  from: ColorSource;
  to: ColorSource;
  pathway: Pathway;
  power = 0;
  glow = 0;
  level = 0;
  on = true;
  private revealValue = 1;
  private readonly sides: Vector3[] = [];
  private readonly colA = new Color();
  private readonly colB = new Color();

  constructor(opts: RibbonOptions) {
    if (opts.registry) registerEnergy(opts.registry);
    const R = energyConfig.ribbon;
    this.id = opts.id;
    this.palette = opts.palette ?? defaultPalette();
    this.from = opts.from;
    this.to = opts.to ?? opts.from;
    this.pathway = this.palette.pathway(opts.pathway ?? 'mechanical');
    this.curve = new CatmullRomCurve3(opts.points.map((p) => p.clone()), false, opts.tension ?? 'centripetal');
    this.len = this.curve.getLength();
    const segments = opts.segments ?? 140;
    const n = segments + 1;
    const pos = new Float32Array(n * 6);
    const side = new Float32Array(n * 6);
    const nrm = new Float32Array(n * 6);
    const av = new Float32Array(n * 2);
    const au = new Float32Array(n * 2);
    const aw = new Float32Array(n * 2);
    const c = new Vector3();
    const sd = new Vector3();
    const nm = new Vector3();
    let prev: Vector3 | null = null;
    for (let k = 0; k < n; k++) {
      const u = k / segments;
      this.curve.getPointAt(u, c);
      this.curve.getTangentAt(u, _t).normalize();
      if (opts.face) sd.crossVectors(_t, opts.face(u)).normalize();
      else {
        _up.copy(UP).lerp(BACK, Math.min(1, 1.25 * Math.abs(_t.y))).normalize();
        sd.crossVectors(_t, _up);
        if (sd.lengthSq() < 1e-10) sd.crossVectors(_t, XAX);
        sd.normalize();
      }
      if (prev && sd.dot(prev) < 0) sd.negate();
      const tw = opts.twistAt?.(u) ?? 0;
      if (tw) sd.applyAxisAngle(_t, tw);
      nm.crossVectors(_t, sd).normalize();
      prev = sd.clone();
      this.sides.push(prev);
      for (let s = 0; s < 2; s++) {
        const v = k * 2 + s;
        pos.set([c.x, c.y, c.z], v * 3);
        side.set([sd.x, sd.y, sd.z], v * 3);
        nrm.set([nm.x, nm.y, nm.z], v * 3);
        av[v] = s === 0 ? -1 : 1;
        au[v] = u;
        aw[v] = opts.widthAt?.(u) ?? 1;
      }
    }
    const idx: number[] = [];
    for (let k = 0; k < segments; k++) {
      const a = 2 * k;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSide', new BufferAttribute(side, 3));
    g.setAttribute('aNrm', new BufferAttribute(nrm, 3));
    g.setAttribute('aV', new BufferAttribute(av, 1));
    g.setAttribute('aU', new BufferAttribute(au, 1));
    g.setAttribute('aW', new BufferAttribute(aw, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    if (g.boundingSphere) g.boundingSphere.radius += 30;
    const fade = opts.fade ?? 0;
    const fadeIn = opts.fadeIn ?? 0;
    const blend = opts.blend ?? [R.blend0, R.blend1];
    this.material = new ShaderMaterial({
      uniforms: {
        uA: { value: new Color() }, uB: { value: new Color() }, uWidth: { value: 0 }, uGlow: { value: 0 },
        uTime: { value: Math.random() * 10 }, uSpeed: { value: 26 }, uLen: { value: this.len },
        uMode: { value: modeIndex(this.pathway.mode) }, uLanes: { value: opts.lanes ?? 1 }, uReveal: { value: 1.01 },
        uFade: { value: fade }, uFadeIn: { value: fadeIn }, uTaperIn: { value: opts.taperIn ?? 0 }, uTaperOut: { value: opts.taperOut ?? 0 },
        uBlend: { value: new Vector2(blend[0], blend[1]) }, uBlendNarrow: { value: R.blendNarrow }, uDh: { value: 0 },
        uSplit: { value: 0 }, uSplitSide: { value: 1 }, uMode2: { value: 0 }, uRes: opts.res ?? { value: new Vector2(1600, 900) },
        uMinPx: { value: opts.minPx ?? 0 }, uWidthGate: { value: R.widthGate }, uRaySpeed: { value: R.raySpeed }, uShimmer: { value: R.shimmer },
      },
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      side: DoubleSide,
      transparent: fade > 0 || fadeIn > 0,
      depthWrite: !(fade > 0 || fadeIn > 0),
    });
    this.material.name = 'energy-ribbon';
    this.mesh = new Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.mesh.name = `${opts.id ?? 'ribbon'}.band`;
    this.mesh.userData.glowGain = 'ribbon';
    if (this.material.transparent) this.mesh.renderOrder = 4;
    this.group.name = opts.id ?? 'ribbon';
    this.group.add(this.mesh);
    opts.parent?.add(this.group);
    if (opts.registry && opts.id) this.register(opts.registry, opts.id, opts.label);
  }

  get mode(): PathwayMode {
    return this.pathway.mode;
  }

  /** Band width from power: max(minWidth, P mmPerW). */
  setPower(P: number, mmPerW = energyConfig.ribbon.mmPerW, minWidth = 0): void {
    this.power = Math.max(0, P);
    (this.material.uniforms.uWidth as IUniform<number>).value = ribbonWidth(this.power, mmPerW, minWidth);
  }

  get reveal(): number {
    return this.revealValue;
  }
  /** How far along the band the energy has arrived (0..1). */
  set reveal(v: number) {
    this.revealValue = v;
    this.material.uniforms.uReveal!.value = v >= 1 ? 1.01 : v;
  }

  /** Two flows in one band: the `split` share on `side` (+1/-1) runs in pathway mode `mode2`. */
  carry(split: number, side: 1 | -1 = 1, mode2: PathwayMode = 'heating'): void {
    const u = this.material.uniforms;
    u.uSplit!.value = split;
    u.uSplitSide!.value = side;
    u.uMode2!.value = modeIndex(mode2);
  }

  /** End point, tangent and side of the band, for attaching a child band. */
  endFrame(): { point: Vector3; tangent: Vector3; side: Vector3 } {
    return { point: this.curve.getPointAt(1), tangent: this.curve.getTangentAt(1).normalize(), side: this.sides[this.sides.length - 1]!.clone() };
  }

  update(dt: number, f: { live: boolean; still?: boolean; paused?: boolean }, maxW = energyConfig.ribbon.maxW): void {
    const R = energyConfig.ribbon;
    const still = !!f.still;
    const target = f.live && this.on && this.power > 1e-9 ? 1 : 0;
    this.glow = still ? target : this.glow + (target - this.glow) * (1 - Math.exp(-R.glowRate * dt));
    this.level = Math.min(1, this.power / maxW);
    this.mesh.visible = this.glow > 0.01;
    const u = this.material.uniforms;
    if (!(still || f.paused)) u.uTime!.value += dt;
    u.uSpeed!.value = ribbonSpeed(this.mode, this.level);
    u.uGlow!.value = energyConfig.glow.ribbon * this.glow;
    u.uMode!.value = modeIndex(this.mode);
    u.uWidthGate!.value = R.widthGate;
    u.uRaySpeed!.value = R.raySpeed;
    u.uShimmer!.value = R.shimmer;
    u.uBlendNarrow!.value = R.blendNarrow;
    this.resolve(this.from, this.colA);
    this.resolve(this.to, this.colB);
    (u.uA!.value as Color).copy(this.colA);
    (u.uB!.value as Color).copy(this.colB);
    u.uDh!.value = hueDelta(this.colA, this.colB);
  }

  private resolve(c: ColorSource, out: Color): Color {
    if (typeof c !== 'string') return out.copy(c);
    if (this.palette.has(c)) return out.copy(this.palette.color(c));
    return out.set(c);
  }

  /** Light from the middle of the band: plain RGB mix of the end colours. */
  lightInfo(out?: GlowSource): GlowSource {
    const o = out ?? { id: this.id ?? this.group.name, position: new Vector3(), color: new Color(), strength: 0 };
    this.group.updateWorldMatrix(true, false);
    this.curve.getPointAt(0.5, o.position);
    this.group.localToWorld(o.position);
    o.color.copy(this.colA).lerp(this.colB, 0.5);
    o.strength = this.glow * Math.min(1, energyConfig.ribbon.lightFloor + this.level) * Math.min(1, this.revealValue);
    return o;
  }

  glowObjects(): Object3D[] {
    return [this.mesh];
  }

  register(registry: Registry, id: string, label?: string): void {
    const self = this;
    registry.add({
      id, label: label ?? 'Sankey ribbon', kind: 'energy-ribbon', tags: ['object', 'energy', 'flow', 'shader'], object: this.group,
      describe: 'A glowing band whose width shows power; reveal shows how far the energy has arrived.',
      source: 'src/engine/energy/ribbon.ts',
      params: [
        { key: 'power', label: 'Power', type: 'number', min: 0, unit: 'W', help: 'Power carried (width = power x mmPerW)', get: () => self.power, set: (v) => self.setPower(Number(v)) },
        { key: 'reveal', label: 'Reveal', type: 'number', min: 0, max: 1, help: 'How far along the band the energy has arrived', get: () => self.reveal, set: (v) => void (self.reveal = Number(v)) },
        { key: 'on', label: 'On', type: 'boolean', help: 'Band switched on', get: () => self.on, set: (v) => void (self.on = Boolean(v)) },
        { key: 'pathway', label: 'Pathway', type: 'enum', options: this.palette.pathways().map((p) => p.id), help: 'Pattern', get: () => self.pathway.id, set: (v) => void (self.pathway = self.palette.pathway(String(v))) },
      ],
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
