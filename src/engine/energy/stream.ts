/**
 * An energy stream: a glowing tube arching from one store to another. Its thickness grows with the square root of
 * the power, a travelling brightness pattern names the pathway (mechanical wave, electrical pulses, heating shimmer,
 * radiation dashes), bright beads ride along it, and its colour turns from the source colour to the destination
 * colour the short way round the hue circle. When the flow reverses, colours and motion flip at once.
 */
import {
  BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, FrontSide, Group, InstancedMesh, Matrix4, Mesh,
  MeshBasicMaterial, ShaderMaterial, SphereGeometry, Vector3, type IUniform, type Material, type Object3D,
} from 'three';
import type { GlowSource } from '../contracts';
import type { Registry } from '../core/registry';
import { energyConfig, registerEnergy } from './config';
import { HUE_GLSL, blendHalfWidth, hueBlend, smoothstep } from './hue';
import { defaultPalette, modeIndex, type Palette, type Pathway, type PathwayMode } from './palette';

// ------------------------------------------------------------------------------------------------- pure stream math

/** Tube radius: (base + gain sqrt(level)) * m, electrical capped at 0.9 m. */
export function streamRadius(level: number, m: number, mode: PathwayMode = 'mechanical'): number {
  const S = energyConfig.stream;
  const r = (S.radiusBase + S.radiusGain * Math.sqrt(Math.max(0, level))) * m;
  return mode === 'electrical' ? Math.min(r, S.electricalMax * m) : r;
}

/** Bead and pattern speed in mm/s for a pathway mode at a power level. */
export function streamSpeed(mode: PathwayMode, level: number): number {
  const v = energyConfig.speeds;
  switch (mode) {
    case 'electrical': return v.electrical;
    case 'heating': return v.heating;
    case 'radiation': return v.radiation;
    default: return v.mechanical + v.mechanicalGain * level;
  }
}

/** One frame of the glow approach: snaps when still, else glow += (target - glow)(1 - exp(-rate dt)). */
export const glowStep = (glow: number, target: number, dt: number, still = false, rate = energyConfig.stream.glowRate): number =>
  still ? target : glow + (target - glow) * (1 - Math.exp(-rate * dt));

/** Thickness ramp of the glow: smoothstep(0.01, 0.9, glow). */
export const glowRamp = (glow: number): number => smoothstep(energyConfig.stream.fadeEdge0, energyConfig.stream.fadeEdge1, glow);

/** Beads shown out of `count`: all, or 40 % on heating streams, times the quality scale. */
export const beadsShown = (count: number, mode: PathwayMode, scale = energyConfig.stream.beadScale): number =>
  Math.ceil((mode === 'heating' ? energyConfig.stream.heatingShare * count : count) * scale);

/** Bead i: its flow position w (from the actual source), curve parameter h, and size. */
export function beadAt(i: number, count: number, phase: number, dir: number, base: number, shown: number): { w: number; h: number; size: number } {
  const S = energyConfig.stream;
  const w = (((i / count + phase) % 1) + 1) % 1;
  const h = dir < 0 ? 1 - w : w;
  const size = i < shown && h > S.beadCut && h < 1 - S.beadCut ? base * (1 - S.beadVary + S.beadVary * Math.sin(1.7 * i)) * Math.min(1, h / S.beadEnd, (1 - h) / S.beadEnd) : 0;
  return { w, h, size };
}

/**
 * Control points of an arch from a to b: [a, a + (inward, 0.6 H), midpoint + (0, H), b + (-inward, 0.6 H), b], the
 * shoulder points pulled 2 mm toward the other end.
 */
export function archPoints(a: Vector3, b: Vector3, height: number, inward = 2): Vector3[] {
  const d = new Vector3(b.x - a.x, 0, b.z - a.z);
  if (d.lengthSq() < 1e-12) d.set(1, 0, 0);
  d.normalize().multiplyScalar(inward);
  return [
    a.clone(),
    a.clone().add(new Vector3(d.x, 0.6 * height, d.z)),
    a.clone().add(b).multiplyScalar(0.5).add(new Vector3(0, height, 0)),
    b.clone().add(new Vector3(-d.x, 0.6 * height, -d.z)),
    b.clone(),
  ];
}

/** Tube geometry along a curve: rings of `radial` vertices sharing their centre, radius applied in the shader. */
export function tubeGeometry(curve: CatmullRomCurve3, segments: number, radial: number, into?: BufferGeometry): BufferGeometry {
  const rings = segments + 1;
  const per = radial + 1;
  const count = rings * per;
  const g = into ?? new BufferGeometry();
  const pos = (g.getAttribute('position') as BufferAttribute | undefined) ?? new BufferAttribute(new Float32Array(count * 3), 3);
  const off = (g.getAttribute('aOff') as BufferAttribute | undefined) ?? new BufferAttribute(new Float32Array(count * 3), 3);
  const au = (g.getAttribute('aU') as BufferAttribute | undefined) ?? new BufferAttribute(new Float32Array(count), 1);
  const frames = curve.computeFrenetFrames(segments, false);
  const c = new Vector3();
  for (let k = 0; k < rings; k++) {
    const u = k / segments;
    curve.getPointAt(u, c);
    const N = frames.normals[k]!;
    const B = frames.binormals[k]!;
    for (let j = 0; j < per; j++) {
      const th = (j / radial) * Math.PI * 2;
      const cs = Math.cos(th);
      const sn = Math.sin(th);
      const v = k * per + j;
      pos.setXYZ(v, c.x, c.y, c.z);
      off.setXYZ(v, N.x * cs + B.x * sn, N.y * cs + B.y * sn, N.z * cs + B.z * sn);
      au.setX(v, u);
    }
  }
  if (!into) {
    const idx: number[] = [];
    for (let k = 0; k < segments; k++)
      for (let j = 0; j < radial; j++) {
        const a = k * per + j;
        const b = (k + 1) * per + j;
        idx.push(a, b, a + 1, b, b + 1, a + 1);
      }
    g.setIndex(idx);
    g.setAttribute('position', pos);
    g.setAttribute('aOff', off);
    g.setAttribute('aU', au);
  } else {
    pos.needsUpdate = true;
    off.needsUpdate = true;
    au.needsUpdate = true;
  }
  g.computeBoundingSphere();
  if (g.boundingSphere) g.boundingSphere.radius += 6;
  return g;
}

// ------------------------------------------------------------------------------------------------- shader

/** Pattern constants shared by every stream. */
const pattern = {
  uBodyBase: { value: 0.55 }, uBodyGain: { value: 0.45 },
  uMechFloor: { value: 0.82 }, uMechAmp: { value: 0.18 }, uMechFreq: { value: 0.45 },
  uElecPeriod: { value: 18 }, uElecMul: { value: 3 }, uElecFloor: { value: 0.35 }, uElecGain: { value: 1.4 }, uElecRise: { value: 0.75 }, uElecPeak: { value: 0.97 },
  uHeatFloor: { value: 0.78 }, uHeatAmp: { value: 0.22 }, uHeatFreq: { value: 0.22 }, uHeatMul: { value: 0.4 }, uHeatWarp: { value: 0.07 },
  uRadPeriod: { value: 9 }, uRadMul: { value: 1.6 }, uRadFloor: { value: 0.25 }, uRadGain: { value: 1.1 }, uRadDuty: { value: 0.45 },
  uTaperMin: { value: 0.45 }, uTaperSpan: { value: 0.06 }, uWaver: { value: 0.18 }, uWaverFreq: { value: 40 }, uWaverSpeed: { value: 1.6 },
} satisfies Record<string, IUniform<number>>;

export function syncStreamUniforms(): void {
  const M = energyConfig.modes;
  const S = energyConfig.stream;
  pattern.uBodyBase.value = M.bodyBase;
  pattern.uBodyGain.value = M.bodyGain;
  pattern.uMechFloor.value = M.mechFloor;
  pattern.uMechAmp.value = M.mechAmp;
  pattern.uMechFreq.value = M.mechFreq;
  pattern.uElecPeriod.value = M.elecPeriod;
  pattern.uElecMul.value = M.elecSpeedMul;
  pattern.uElecFloor.value = M.elecFloor;
  pattern.uElecGain.value = M.elecGain;
  pattern.uElecRise.value = M.elecRise;
  pattern.uElecPeak.value = M.elecPeak;
  pattern.uHeatFloor.value = M.heatFloor;
  pattern.uHeatAmp.value = M.heatAmp;
  pattern.uHeatFreq.value = M.heatFreq;
  pattern.uHeatMul.value = M.heatSpeedMul;
  pattern.uHeatWarp.value = M.heatWarp;
  pattern.uRadPeriod.value = M.radPeriod;
  pattern.uRadMul.value = M.radSpeedMul;
  pattern.uRadFloor.value = M.radFloor;
  pattern.uRadGain.value = M.radGain;
  pattern.uRadDuty.value = M.radDuty;
  pattern.uTaperMin.value = S.taperMin;
  pattern.uTaperSpan.value = S.taperSpan;
  pattern.uWaver.value = S.heatWaver;
  pattern.uWaverFreq.value = S.heatWaverFreq;
  pattern.uWaverSpeed.value = S.heatWaverSpeed;
}

const VERTEX = /* glsl */ `
attribute vec3 aOff;
attribute float aU;
uniform float uRadius, uTime, uMode, uTaperMin, uTaperSpan, uWaver, uWaverFreq, uWaverSpeed;
varying float vU;
varying vec3 vN;
varying vec3 vV;
void main() {
  float taper = uTaperMin + (1.0 - uTaperMin) * smoothstep(0.0, uTaperSpan, aU) * (1.0 - smoothstep(1.0 - uTaperSpan, 1.0, aU));
  float r = uRadius * taper;
  if (uMode > 1.5 && uMode < 2.5) r *= 1.0 + uWaver * sin(uWaverFreq * aU - uWaverSpeed * uTime + 3.0 * aOff.x);
  vec4 mv = modelViewMatrix * vec4(position + aOff * r, 1.0);
  vN = normalize(normalMatrix * aOff);
  vV = normalize(-mv.xyz);
  vU = aU;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uA;
uniform vec3 uB;
uniform float uHw, uDir, uLen, uTime, uSpeed, uGlow, uMode;
uniform float uBodyBase, uBodyGain, uMechFloor, uMechAmp, uMechFreq;
uniform float uElecPeriod, uElecMul, uElecFloor, uElecGain, uElecRise, uElecPeak;
uniform float uHeatFloor, uHeatAmp, uHeatFreq, uHeatMul, uHeatWarp;
uniform float uRadPeriod, uRadMul, uRadFloor, uRadGain, uRadDuty;
varying float vU;
varying vec3 vN;
varying vec3 vV;
${HUE_GLSL}
void main() {
  float u = uDir < 0.0 ? 1.0 - vU : vU;
  vec3 c = hueBlend(uA, uB, smoothstep(0.5 - uHw, 0.5 + uHw, u));
  float body = uBodyBase + uBodyGain * abs(dot(normalize(vN), normalize(vV)));
  float s = u * uLen;
  float T = uTime;
  float S = uSpeed;
  float f;
  if (uMode < 0.5) {
    f = uMechFloor + uMechAmp * sin(uMechFreq * (s - T * S));
  } else if (uMode < 1.5) {
    float k = fract((s - uElecMul * T * S) / uElecPeriod);
    f = uElecFloor + uElecGain * smoothstep(uElecRise, uElecPeak, k) * (1.0 - smoothstep(uElecPeak, 1.0, k));
  } else if (uMode < 2.5) {
    f = uHeatFloor + uHeatAmp * sin(uHeatFreq * (s - uHeatMul * T * S) + sin(uHeatWarp * s + T));
  } else {
    float k = fract((s - uRadMul * T * S) / uRadPeriod);
    f = uRadFloor + uRadGain * step(uRadDuty, k);
  }
  gl_FragColor = vec4(c * uGlow * body * f, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface TubeUniforms {
  uA: IUniform<Color>;
  uB: IUniform<Color>;
  uHw: IUniform<number>;
  uDir: IUniform<number>;
  uLen: IUniform<number>;
  uTime: IUniform<number>;
  uSpeed: IUniform<number>;
  uGlow: IUniform<number>;
  uMode: IUniform<number>;
  uRadius: IUniform<number>;
}

export function createTubeMaterial(): ShaderMaterial & { uniforms: TubeUniforms } {
  syncStreamUniforms();
  const m = new ShaderMaterial({
    uniforms: {
      uA: { value: new Color() }, uB: { value: new Color() }, uHw: { value: 0.2 }, uDir: { value: 1 }, uLen: { value: 1 },
      uTime: { value: 0 }, uSpeed: { value: 30 }, uGlow: { value: energyConfig.glow.tube }, uMode: { value: 0 }, uRadius: { value: 0 },
      ...pattern,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    depthWrite: true,
  });
  m.name = 'energy-stream-tube';
  return m as ShaderMaterial & { uniforms: TubeUniforms };
}

// ------------------------------------------------------------------------------------------------- the component

export type ColorSource = string | Color;

export interface StreamFrame {
  live: boolean;
  still?: boolean;
  paused?: boolean;
}

export interface StreamOptions {
  id?: string;
  label?: string;
  registry?: Registry;
  palette?: Palette;
  /** Source and destination: quantity ids (live palette colours), hex strings or linear Colors. */
  from: ColorSource;
  to: ColorSource;
  /** Pathway id (palette) or one of the four modes. Default mechanical. */
  pathway?: string;
  /** Curve control points (centripetal Catmull-Rom). */
  points?: readonly Vector3[];
  /** Or an arch between two points. */
  arch?: { a: Vector3; b: Vector3; height: number; inward?: number };
  beads?: number;
  segments?: number;
  radial?: number;
  /** Power that counts as full level. */
  maxPower?: number;
  parent?: Object3D;
}

const _p = new Vector3();
const _m4 = new Matrix4();
const _col = new Color();

export class Stream {
  readonly id: string | undefined;
  readonly group = new Group();
  readonly tube: Mesh;
  readonly beads: InstancedMesh;
  readonly material: ShaderMaterial & { uniforms: TubeUniforms };
  readonly palette: Palette;
  readonly segments: number;
  readonly radial: number;
  readonly beadCount: number;
  curve: CatmullRomCurve3;
  len: number;
  from: ColorSource;
  to: ColorSource;
  pathway: Pathway;
  power = 0;
  maxPower: number;
  dir = 1;
  glow = 0;
  phase = 0;
  level = 0;
  /** Glow ramp smoothstep(0.01, 0.9, glow) this frame. */
  m = 0;
  protected live = false;
  private archSpec: { a: Vector3; b: Vector3; height: number; inward: number } | null = null;
  private readonly colA = new Color();
  private readonly colB = new Color();

  constructor(opts: StreamOptions) {
    if (opts.registry) registerEnergy(opts.registry);
    this.id = opts.id;
    this.palette = opts.palette ?? defaultPalette();
    this.from = opts.from;
    this.to = opts.to;
    this.pathway = this.palette.pathway(opts.pathway ?? 'mechanical');
    this.segments = opts.segments ?? 96;
    this.radial = opts.radial ?? 10;
    this.beadCount = opts.beads ?? 11;
    this.maxPower = opts.maxPower ?? 1;
    let pts = opts.points;
    if (opts.arch) {
      this.archSpec = { ...opts.arch, inward: opts.arch.inward ?? 2 };
      pts = archPoints(opts.arch.a, opts.arch.b, opts.arch.height, this.archSpec.inward);
    }
    if (!pts || pts.length < 2) throw new Error('inkleaf: a stream needs points or an arch');
    this.curve = new CatmullRomCurve3(pts.map((p) => p.clone()), false, 'centripetal');
    this.len = this.curve.getLength();
    this.material = createTubeMaterial();
    this.tube = new Mesh(tubeGeometry(this.curve, this.segments, this.radial), this.material);
    this.tube.frustumCulled = false;
    this.tube.name = `${opts.id ?? 'stream'}.tube`;
    this.tube.visible = false;
    this.tube.userData.glowGain = 'tube';
    this.beads = new InstancedMesh(new SphereGeometry(1, 12, 8), new MeshBasicMaterial({ color: 0xffffff }), this.beadCount);
    this.beads.frustumCulled = false;
    this.beads.name = `${opts.id ?? 'stream'}.beads`;
    this.beads.visible = false;
    this.beads.userData.glowGain = 'beads';
    for (let i = 0; i < this.beadCount; i++) {
      this.beads.setMatrixAt(i, _m4.makeScale(0, 0, 0));
      this.beads.setColorAt(i, _col.set(1, 1, 1));
    }
    this.group.name = opts.id ?? 'stream';
    this.group.add(this.tube, this.beads);
    opts.parent?.add(this.group);
    this.syncColors();
    if (opts.registry && opts.id) this.register(opts.registry, opts.id, opts.label);
  }

  get mode(): PathwayMode {
    return this.pathway.mode;
  }

  /** Resolves a colour source to a linear colour. */
  resolve(c: ColorSource, out: Color): Color {
    if (typeof c !== 'string') return out.copy(c);
    if (this.palette.has(c)) return out.copy(this.palette.color(c));
    return out.set(c);
  }

  private syncColors(): void {
    this.resolve(this.from, this.colA);
    this.resolve(this.to, this.colB);
    const u = this.material.uniforms;
    if (this.dir < 0) {
      u.uA.value.copy(this.colB);
      u.uB.value.copy(this.colA);
    } else {
      u.uA.value.copy(this.colA);
      u.uB.value.copy(this.colB);
    }
    u.uHw.value = blendHalfWidth(u.uA.value, u.uB.value);
  }

  /** Signed power: the sign picks the direction (negative flows from `to` to `from`). `max` sets the full level. */
  setPower(P: number, max = this.maxPower): void {
    if (Math.abs(P) > 1e-9) this.dir = Math.sign(P);
    this.power = Math.abs(P);
    this.maxPower = max;
  }

  setPathway(id: string): void {
    this.pathway = this.palette.pathway(id);
  }

  /** Replaces the curve (same vertex counts, rebuilt in place). */
  setPoints(points: readonly Vector3[]): void {
    this.curve = new CatmullRomCurve3(points.map((p) => p.clone()), false, 'centripetal');
    this.len = this.curve.getLength();
    tubeGeometry(this.curve, this.segments, this.radial, this.tube.geometry);
  }

  setArch(a: Vector3, b: Vector3, height: number, inward = 2): void {
    this.archSpec = { a: a.clone(), b: b.clone(), height, inward };
    this.setPoints(archPoints(a, b, height, inward));
  }

  update(dt: number, f: StreamFrame): void {
    const S = energyConfig.stream;
    const still = !!f.still;
    const dtAnim = still || f.paused ? 0 : dt;
    this.live = f.live;
    this.level = Math.min(1, this.power / Math.max(1e-9, this.maxPower));
    const target = f.live && this.power > 1e-9 ? 1 : 0;
    this.glow = glowStep(this.glow, target, dt, still);
    const vis = this.glow > S.visibleGlow;
    this.m = glowRamp(this.glow);
    const radius = streamRadius(this.level, this.m, this.mode);
    const speed = streamSpeed(this.mode, this.level);
    syncStreamUniforms();
    this.syncColors();
    const u = this.material.uniforms;
    u.uRadius.value = radius;
    u.uSpeed.value = speed;
    u.uTime.value += dtAnim;
    u.uGlow.value = energyConfig.glow.tube;
    u.uDir.value = this.dir;
    u.uLen.value = this.len;
    u.uMode.value = modeIndex(this.mode);
    this.phase = (((this.phase + (dtAnim * speed) / this.len) % 1) + 1) % 1;
    this.tube.visible = vis;
    this.beads.visible = vis;
    if (vis) this.updateBeads(dtAnim, radius);
  }

  protected updateBeads(_dtAnim: number, radius: number): void {
    const S = energyConfig.stream;
    const n = this.beadCount;
    const shown = beadsShown(n, this.mode);
    const base = (this.mode === 'electrical' ? S.beadElectrical : radius * S.beadRadius + S.beadAdd) * this.m;
    const u = this.material.uniforms;
    const hw = u.uHw.value;
    for (let i = 0; i < n; i++) {
      const b = beadAt(i, n, this.phase, this.dir, base, shown);
      this.placeBead(i, b.h, b.size, smoothstep(0.5 - hw, 0.5 + hw, b.w));
    }
    this.flushBeads();
  }

  protected placeBead(i: number, h: number, size: number, t: number): void {
    this.curve.getPointAt(Math.min(1, Math.max(0, h)), _p);
    this.beads.setMatrixAt(i, _m4.makeScale(size, size, size).setPosition(_p));
    const u = this.material.uniforms;
    hueBlend(u.uA.value, u.uB.value, t, _col).multiplyScalar(energyConfig.glow.beads);
    this.beads.setColorAt(i, _col);
  }

  protected flushBeads(): void {
    this.beads.instanceMatrix.needsUpdate = true;
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;
  }

  /** Light from the middle of the stream, in the blended middle colour. */
  lightInfo(out?: GlowSource): GlowSource {
    const o = out ?? { id: this.id ?? this.group.name, position: new Vector3(), color: new Color(), strength: 0 };
    this.group.updateWorldMatrix(true, false);
    this.curve.getPointAt(0.5, o.position);
    this.group.localToWorld(o.position);
    const u = this.material.uniforms;
    hueBlend(u.uA.value, u.uB.value, 0.5, o.color);
    o.strength = this.glow * Math.min(1, energyConfig.stream.lightFloor + this.level);
    return o;
  }

  glowObjects(): Object3D[] {
    return [this.tube, this.beads];
  }

  register(registry: Registry, id: string, label?: string): void {
    const self = this;
    const pathways = this.palette.pathways().map((p) => p.id);
    registry.add({
      id, label: label ?? 'Energy stream', kind: 'energy-stream', tags: ['object', 'energy', 'flow', 'shader'], object: this.group,
      describe: `A glowing stream from ${String(this.from)} to ${String(this.to)}: thickness from power, a travelling pattern for the pathway, beads along the tube.`,
      source: 'src/engine/energy/stream.ts',
      params: [
        { key: 'power', label: 'Power', type: 'number', min: -1e9, max: 1e9, unit: 'W', help: 'Signed power (negative flows backwards)', get: () => self.power * self.dir, set: (v) => self.setPower(Number(v)) },
        { key: 'maxPower', label: 'Full power', type: 'number', min: 1e-9, unit: 'W', help: 'Power that draws the thickest tube', get: () => self.maxPower, set: (v) => void (self.maxPower = Number(v)) },
        { key: 'pathway', label: 'Pathway', type: 'enum', options: pathways, help: 'Motion pattern and bead speed', get: () => self.pathway.id, set: (v) => self.setPathway(String(v)) },
        { key: 'from', label: 'From', type: 'string', help: 'Source quantity id or colour', get: () => (typeof self.from === 'string' ? self.from : '#' + self.from.getHexString()), set: (v) => void (self.from = String(v)) },
        { key: 'to', label: 'To', type: 'string', help: 'Destination quantity id or colour', get: () => (typeof self.to === 'string' ? self.to : '#' + self.to.getHexString()), set: (v) => void (self.to = String(v)) },
        { key: 'archHeight', label: 'Arch height', type: 'number', min: 0, max: 200, unit: 'mm', help: 'Height of the arch above its ends', get: () => self.archSpec?.height ?? 0, set: (v) => void (self.archSpec && self.setArch(self.archSpec.a, self.archSpec.b, Number(v), self.archSpec.inward)) },
      ],
    });
  }

  dispose(): void {
    this.group.removeFromParent();
    this.tube.geometry.dispose();
    this.material.dispose();
    this.beads.geometry.dispose();
    (this.beads.material as Material).dispose();
    this.beads.dispose();
  }
}
