/**
 * An energy store jar. There is no glass surface: the jar is hand-inked rings, graduation ticks, two highlight
 * strokes and two camera-true silhouette lines. Inside sits a glowing liquid whose height is the stored amount over
 * the jar's capacity, with bubbles rising up the front, and a paper card (or a luggage tag) names the store and
 * shows the amount in handwriting. Lighting a jar fades its liquid in and makes it a light source for the page.
 */
import {
  CanvasTexture, Color, CylinderGeometry, DoubleSide, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial,
  PerspectiveCamera, PlaneGeometry, SRGBColorSpace, Shape, ShapeGeometry, SphereGeometry, Vector2, Vector3, type Camera,
  type Material, type Object3D, type Texture,
} from 'three';
import type { GlowSource, LineOptions, LineSet, PenSchedule, Pop } from '../contracts';
import type { Registry } from '../core/registry';
import { blendLines, cylinderSilhouette, eyeInLocal, printDirInLocal, type Lines } from '../ink/silhouette';
import { formatJoules } from '../physics/format';
import { CARD_H, CARD_W, cardFontsReady, drawCard } from './card';
import { energyConfig, registerEnergy } from './config';
import { createLiquidMaterial, syncLiquidUniforms, type LiquidMaterial } from './liquid';
import { defaultPalette, type Palette, type PatternKind } from './palette';

// ------------------------------------------------------------------------------------------------- pure jar math

/** Fraction of capacity, clamped to [0, 1]. */
export const jarFill = (value: number, capacity: number): number => (capacity > 0 ? Math.min(1, Math.max(0, value / capacity)) : 0);

/** Liquid height in mm: max(minLevel, fill * (hl - margin)), hl = shoulder height. */
export const jarLevel = (fill: number, hl: number, margin = energyConfig.jar.levelMargin, minLevel = energyConfig.jar.minLevel): number => Math.max(minLevel, fill * (hl - margin));

/** One frame of the light-up easing: lit += (target - lit) * min(1, rate * dt). */
export const easeLit = (lit: number, target: number, dt: number, rate = energyConfig.jar.litRate): number => lit + (target - lit) * Math.min(1, rate * dt);

/** Liquid opacity: smoothstep of lit. */
export const liquidAlpha = (lit: number): number => {
  const x = Math.min(1, Math.max(0, lit));
  return x * x * (3 - 2 * x);
};

/** Light strength of a jar: lit * min(1, floor + fill), qualitative jars 0.55 * lit, nothing below the fill floor. */
export function jarStrength(lit: number, fill: number, qualitative = false): number {
  const j = energyConfig.jar;
  if (qualitative) return j.qualitativeStrength * lit;
  return fill > j.minFill ? lit * Math.min(1, j.strengthFloor + fill) : 0;
}

const fract = (x: number) => x - Math.floor(x);

/** Bubble i: angle around the jar (front half), start height, rise speed, size. */
export function bubbleConstants(i: number): { angle: number; y0: number; speed: number; size: number } {
  return {
    angle: Math.PI * (0.18 + 0.64 * fract(0.618 * i)),
    y0: i / 7,
    speed: 0.12 + 0.1 * fract(0.37 * i),
    size: 0.35 + 0.35 * fract(0.53 * i),
  };
}

/** Bubble size envelope over one rise: min(1, grow y, shrink (1 - y)). */
export const bubbleEnvelope = (y: number): number => Math.max(0, Math.min(1, energyConfig.bubbles.grow * y, energyConfig.bubbles.shrink * (1 - y)));

/** The pen schedule of a jar stroke at `step` (in units of 0.05 s, times pace). */
export function jarSchedule(t0: number, pace: number, step: number, dur = energyConfig.jar.dur * pace): PenSchedule {
  return { t0: t0 + step * energyConfig.jar.step * pace, dur };
}

// ------------------------------------------------------------------------------------------------- the component

export interface CardPlacement { w?: number; h?: number; y?: number; z?: number; tilt?: number }

export interface JarOptions {
  /** Registry id, e.g. `lesson-1.jar.kinetic`. Registered when `registry` is given. */
  id?: string;
  label?: string;
  registry?: Registry;
  /** Quantity id in the palette: gives the colour, name and pattern. */
  store?: string;
  palette?: Palette;
  /** Overrides of the quantity's name, colour (sRGB hex) and pattern. */
  name?: string;
  color?: string;
  pattern?: PatternKind;
  r?: number;
  h?: number;
  capacity?: number;
  /** Scale line on the card; null for the default "jar holds <capacity>". */
  scaleText?: string | null;
  position?: Vector3 | readonly [number, number, number];
  /** Start of this jar's strokes on the pop's pen clock. */
  t0?: number;
  /** Stretches the stroke schedule (lesson 1 uses 0.7). */
  pace?: number;
  /** Label style: a card leaning in front, a luggage tag on a string, or none. */
  labelStyle?: 'card' | 'tag' | 'none';
  tagSide?: 1 | -1;
  card?: CardPlacement;
  /** Label-jar layout: an extra italic line under the name. */
  sub?: string | null;
  value?: number;
  /** Light-up rate (default `energy.jar.litRate`, 5/s). */
  litRate?: number;
  qualitative?: boolean;
  overflow?: boolean;
  /** Parent object (default the pop group). */
  parent?: Object3D;
  /**
   * An ink outline drawn elsewhere (the authoring kit's jar part). The jar then adds only the liquid, bubbles, light
   * and card text: it uses the outline's group, radius and height, and draws into its label canvas if one is given.
   */
  outline?: JarOutlineLike;
}

export interface JarOutlineLike {
  group: Group;
  r: number;
  h: number;
  canvas?: HTMLCanvasElement;
  texture?: Texture;
}

export interface JarFrame {
  camera: Camera;
  live: boolean;
  still?: boolean;
  paused?: boolean;
  /** Standing lift of the pop (1 standing, falls to 0 during the undraw). Read from the pop when omitted. */
  lift?: number;
}

interface LineSched { sched: PenSchedule; step: number; dur: 'line' | 'tick' | 'hole' }

const _eye = new Vector3();
const _dir = new Vector3();
const _inv = new Matrix4();
const _m = new Matrix4();
const _v = new Vector3();
const _c = new Color();
const WHITE = new Color(1, 1, 1);

/** Reads the pop's standing lift if it exposes its uniforms. */
function popLift(pop: Pop): number {
  const p = pop as unknown as { uniforms?: { uLiftAll?: { value: number } }; u?: { uLiftAll?: { value: number } } };
  return p.uniforms?.uLiftAll?.value ?? p.u?.uLiftAll?.value ?? 1;
}

function popCab(pop: Pop): [number, number] {
  const p = pop as unknown as { uniforms?: { uCab?: { value: { x: number; y: number } } }; u?: { uCab?: { value: { x: number; y: number } } } };
  const c = p.uniforms?.uCab?.value ?? p.u?.uCab?.value;
  return c ? [c.x, c.y] : [0.12, 0.32];
}

/** Points of a circle (or arc) of radius r at height y in the XZ plane. */
export function ringPoints(r: number, y: number, segments = 72, a0 = 0, a1 = Math.PI * 2, closed = true): Vector3[] {
  const n = closed ? segments : segments + 1;
  const out: Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + ((a1 - a0) * i) / segments;
    out.push(new Vector3(r * Math.cos(a), y, r * Math.sin(a)));
  }
  return out;
}

const rect = (w: number, h: number, z: number): Vector3[] => [
  new Vector3(-w / 2, -h / 2, z), new Vector3(w / 2, -h / 2, z), new Vector3(w / 2, h / 2, z), new Vector3(-w / 2, h / 2, z),
];

export class Jar {
  readonly id: string | undefined;
  readonly pop: Pop;
  readonly palette: Palette;
  readonly store: string | undefined;
  readonly group: Group;
  readonly r: number;
  readonly h: number;
  /** Shoulder height: h - 3.2. */
  readonly hl: number;
  /** The jar's own ink (null when it adopted an outline). */
  readonly lines: LineSet | null = null;
  readonly sil: LineSet | null = null;
  readonly liquid: Mesh;
  readonly bubbles: InstancedMesh;
  readonly cardPivot: Group | null = null;
  readonly cardMesh: Mesh | null = null;
  readonly cardLines: LineSet | null = null;
  readonly canvas: HTMLCanvasElement | null = null;
  readonly texture: Texture | null = null;
  readonly labelStyle: 'card' | 'tag' | 'none';
  readonly tagSide: 1 | -1;

  value = 0;
  capacity: number;
  lit = 0;
  /** Light-up target; null leaves `lit` to the caller. Forced to 0 while not live. */
  litTarget: number | null = null;
  litRate: number | null;
  qualitative: boolean;
  overflow: boolean;
  labelText: string | null = null;
  scaleText: string | null;
  sub: string | null;
  name: string;
  pattern: PatternKind | undefined;
  t0: number;
  pace: number;

  private readonly hexOverride: Color | null;
  private readonly nameOverride: string | null;
  private readonly material: LiquidMaterial;
  private readonly bubbleY = new Float64Array(7);
  private readonly scheds: LineSched[] = [];
  private readonly silOpts: LineOptions[] = [];
  private readonly silPrint: Lines = [];
  private readonly silCam: Lines = [];
  private readonly silStand: Lines = [];
  private cardDirty = true;
  private lastDraw = -Infinity;
  private live = false;
  private disposed = false;

  constructor(pop: Pop, opts: JarOptions = {}) {
    if (opts.registry) registerEnergy(opts.registry);
    const J = energyConfig.jar;
    this.id = opts.id;
    this.pop = pop;
    this.palette = opts.palette ?? defaultPalette();
    this.store = opts.store;
    const q = opts.store ? this.palette.get(opts.store) : undefined;
    if (opts.store && !q) throw new Error(`inkleaf: jar store "${opts.store}" is not in the palette (${this.palette.ids().join(', ')})`);
    this.name = opts.name ?? q?.label ?? 'Store';
    this.nameOverride = opts.name ?? null;
    this.pattern = opts.pattern ?? q?.pattern;
    this.hexOverride = opts.color ? new Color(opts.color) : null;
    const outline = opts.outline;
    this.group = outline?.group ?? new Group();
    this.r = outline?.r ?? opts.r ?? 13;
    this.h = outline?.h ?? opts.h ?? 46;
    this.hl = this.h - J.shoulderDrop;
    this.capacity = opts.capacity ?? 10;
    this.scaleText = opts.scaleText === undefined ? null : opts.scaleText;
    this.t0 = opts.t0 ?? 0;
    this.pace = opts.pace ?? 1;
    this.labelStyle = opts.labelStyle ?? 'tag';
    this.tagSide = opts.tagSide ?? 1;
    this.sub = opts.sub ?? null;
    this.value = opts.value ?? 0;
    this.litRate = opts.litRate ?? null;
    this.qualitative = opts.qualitative ?? false;
    this.overflow = opts.overflow ?? false;
    this.group.userData.isJar = true;
    if (!outline) {
      this.group.name = opts.id ?? `jar-${this.name.toLowerCase()}`;
      const p = opts.position;
      if (p) Array.isArray(p) ? this.group.position.set(p[0]!, p[1]!, p[2]!) : this.group.position.copy(p as Vector3);
      (opts.parent ?? pop.group).add(this.group);
    }

    const { r, h, hl } = this;
    const s = (step: number, dur: LineSched['dur'] = 'line'): PenSchedule => {
      const sched = jarSchedule(this.t0, this.pace, step);
      this.scheds.push({ sched, step, dur });
      if (dur === 'tick') sched.dur = J.tickDur;
      if (dur === 'hole') sched.dur = J.holeDur;
      return sched;
    };

    // Ink: rings, ticks, highlights (+ tag string, outline and hole in tag mode).
    const lines = outline ? null : pop.lines(pop.ink({ widthPx: J.lineWidthPx }));
    this.lines = lines;
    const rr = r + J.rimOut;
    lines?.add(ringPoints(r, 0, 80), { closed: true, width: J.baseWidth, sched: s(0) });
    lines?.add(ringPoints(rr, hl), { closed: true, width: J.shoulderWidth, sched: s(1) });
    lines?.add(ringPoints(rr, h), { closed: true, width: J.rimWidth, sched: s(2) });
    lines?.add(ringPoints(r - J.innerRimIn, h), { closed: true, width: J.innerRimWidth, sched: s(3) });
    for (let i = 1; i <= 4; i++) {
      const y = 1 + ((hl - 2) * i) / 4;
      const a0 = J.tickAngle * Math.PI;
      const span = i === 4 ? J.tickSpanTop : J.tickSpan;
      lines?.add(ringPoints(r + J.tickOut, y, 8, a0, a0 + span, false), { width: J.tickWidth, taper: true, sched: s(4 + 0.4 * i, 'tick') });
    }
    lines?.add([new Vector3(-0.7 * r, 0.18 * h, 0.72 * r), new Vector3(-0.7 * r, 0.52 * h, 0.72 * r)], { width: J.highlight1Width, sched: s(6) });
    lines?.add([new Vector3(-0.55 * r, 0.58 * h, 0.84 * r), new Vector3(-0.55 * r, 0.66 * h, 0.84 * r)], { width: J.highlight2Width, sched: s(6.5) });

    // Liquid and bubbles.
    const base = this.hexOverride ?? (this.store ? this.palette.color(this.store) : WHITE);
    this.material = createLiquidMaterial(base);
    const geo = new CylinderGeometry(r - J.liquidInset, r - J.liquidInset, 1, 48, 1);
    geo.translate(0, 0.5, 0);
    this.liquid = new Mesh(geo, this.material);
    this.liquid.name = `${this.group.name}.liquid`;
    this.liquid.position.y = J.liquidBase;
    this.liquid.scale.y = J.minLevel;
    this.liquid.visible = false;
    this.liquid.renderOrder = 3;
    this.liquid.userData.glowGain = 'liquid';
    this.group.add(this.liquid);
    this.bubbles = new InstancedMesh(new SphereGeometry(1, 10, 8), new MeshBasicMaterial({ color: 0xffffff }), 7);
    this.bubbles.name = `${this.group.name}.bubbles`;
    this.bubbles.frustumCulled = false;
    this.bubbles.visible = false;
    this.bubbles.renderOrder = 4;
    this.bubbles.userData.glowGain = 'bubbles';
    for (let i = 0; i < 7; i++) {
      this.bubbleY[i] = bubbleConstants(i).y0;
      this.bubbles.setColorAt(i, WHITE);
    }
    this.group.add(this.bubbles);

    // Label.
    if (outline) {
      this.canvas = outline.canvas ?? null;
      this.texture = outline.texture ?? null;
    } else if (this.labelStyle !== 'none' && typeof document !== 'undefined') {
      const canvas = document.createElement('canvas');
      canvas.width = CARD_W;
      canvas.height = CARD_H;
      const tex = new CanvasTexture(canvas);
      tex.colorSpace = SRGBColorSpace;
      tex.anisotropy = 8;
      this.canvas = canvas;
      this.texture = tex;
    }
    const C = energyConfig.card;
    const paperOpts = { color: '#ffffff', hatch: 0, shade: C.shade, map: this.texture ?? undefined, doubleSided: true };
    if (outline) {
      // The outline owns the label surface and border; the jar only writes its text.
    } else if (this.labelStyle === 'card') {
      const c = opts.card ?? {};
      const w = c.w ?? C.w;
      const ch = c.h ?? C.h;
      const pivot = new Group();
      pivot.name = `${this.group.name}.card`;
      pivot.position.set(0, c.y ?? -ch / 2 - C.below, c.z ?? r + C.front);
      pivot.rotation.x = -(c.tilt ?? C.tilt);
      this.group.add(pivot);
      const mat = this.labelMaterial(pop.paper(paperOpts as Parameters<Pop['paper']>[0]));
      const mesh = new Mesh(new PlaneGeometry(w, ch), mat);
      mesh.name = `${this.group.name}.card-paper`;
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      pop.addSurface(mesh, pivot);
      const cl = pop.lines(pop.ink({ widthPx: J.cardWidthPx }));
      cl.add(rect(w, ch, 0.15), { closed: true, width: J.cardOuterWidth, sched: s(7.6) });
      cl.add(rect(w - 2.2, ch - 2.2, 0.15), { closed: true, width: J.cardInnerWidth, sched: s(8.2) });
      cl.build();
      pop.addLines(cl, pivot);
      this.cardPivot = pivot;
      this.cardMesh = mesh;
      this.cardLines = cl;
    } else if (this.labelStyle === 'tag') {
      const side = this.tagSide;
      const cx = side * (r + 15);
      const cy = 0.42 * h;
      const cz = 0.55 * r;
      const hex: [number, number][] = [[-8, 7.5], [12, 7.5], [12, -7.5], [-8, -7.5], [-12, -3.5], [-12, 3.5]];
      const pts = hex.map(([x, y]) => new Vector3(cx + side * x, cy + y, cz));
      const shape = new Shape(hex.map(([x, y]) => new Vector2(side * x, y)));
      const g = new ShapeGeometry(shape);
      const uv = g.getAttribute('uv');
      const pos = g.getAttribute('position');
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + 12) / 24, (pos.getY(i) + 7.5) / 15);
      uv.needsUpdate = true;
      const mat = this.labelMaterial(pop.paper(paperOpts as Parameters<Pop['paper']>[0]));
      const mesh = new Mesh(g, mat);
      mesh.name = `${this.group.name}.tag-paper`;
      mesh.position.set(cx, cy, cz);
      mesh.castShadow = false;
      mesh.receiveShadow = true;
      pop.addSurface(mesh, this.group);
      this.cardMesh = mesh;
      const hole = new Vector3(cx - side * 8.8, cy + 4.3, cz + 0.2);
      const a = Math.PI / 2 - side * 0.55;
      const start = new Vector3(rr * Math.cos(a), hl + 0.6, rr * Math.sin(a));
      const mid = start.clone().add(hole).multiplyScalar(0.5).add(new Vector3(0, -4, 1));
      lines?.add([start, mid, hole], { width: J.tagThinWidth, taper: true, sched: s(7) });
      lines?.add(pts, { closed: true, width: J.tagOutlineWidth, sched: s(7.6) });
      lines?.add(ringPoints(1.1, 0, 16).map((v) => new Vector3(hole.x + v.x, hole.y + v.z, hole.z)), { closed: true, width: J.tagThinWidth, sched: s(8.2, 'hole') });
    }
    if (lines) {
      lines.build();
      pop.addLines(lines, this.group);
      // Silhouettes: two camera-true tangent lines, rebuilt every frame.
      this.sil = pop.lines(pop.ink({ widthPx: J.silWidthPx }), { capacity: 64 });
      for (let v = 0; v < 2; v++) this.silOpts.push({ width: J.silWidth, seed: 300 + v, t0: 0, dur: 0 });
      this.scheduleSilhouettes();
      pop.addLines(this.sil, this.group);
    }

    if (this.canvas) void cardFontsReady().then(() => (this.cardDirty = true));
    if (opts.registry && opts.id) this.register(opts.registry, opts.id, opts.label);
  }

  /** Paper material for the card or tag (sets the canvas map and two-sided rendering if the factory did not). */
  private labelMaterial(m: Material): Material {
    const mm = m as Material & { map?: Texture | null };
    if (this.texture && 'map' in mm && mm.map !== this.texture) {
      mm.map = this.texture;
      mm.needsUpdate = true;
    }
    mm.side = DoubleSide;
    return mm;
  }

  private scheduleSilhouettes(): void {
    const J = energyConfig.jar;
    const silT0 = this.t0 + J.silDelay * this.pace;
    for (let v = 0; v < 2; v++) {
      const o = this.silOpts[v]!;
      o.t0 = silT0 + J.silStagger * v;
      o.dur = J.silDur * this.pace;
    }
  }

  /** Re-times every stroke after `t0` or `pace` changed. */
  reschedule(): void {
    const J = energyConfig.jar;
    for (const l of this.scheds) {
      const s = jarSchedule(this.t0, this.pace, l.step);
      l.sched.t0 = s.t0;
      l.sched.dur = l.dur === 'tick' ? J.tickDur : l.dur === 'hole' ? J.holeDur : s.dur;
    }
    this.lines?.reschedule();
    this.cardLines?.reschedule();
    this.scheduleSilhouettes();
  }

  /** Latest stroke end of the jar (the silhouettes included). */
  get drawEnd(): number {
    return Math.max(this.lines?.end ?? 0, this.cardLines?.end ?? 0, ...this.silOpts.map((o) => (o.t0 ?? 0) + (o.dur ?? 0)));
  }

  /** Linear colour of the liquid (palette colour, live). */
  get color(): Color {
    return this.hexOverride ?? (this.store ? this.palette.color(this.store) : WHITE);
  }

  get fill(): number {
    return jarFill(this.value, this.capacity);
  }

  get level(): number {
    return jarLevel(this.fill, this.hl);
  }

  /** Sets the stored amount immediately (the level does not ease) and marks the card for a redraw. */
  setValue(v: number): void {
    if (Math.abs(v - this.value) > 1e-9) this.cardDirty = true;
    this.value = v;
  }

  /** Marks the card for a redraw (after changing labelText, scaleText, capacity or sub). */
  invalidate(): void {
    this.cardDirty = true;
  }

  /** The text the card shows now. */
  cardText(): { name: string; value: string; scale: string; sub: string | null } {
    return {
      name: this.nameOverride ?? this.palette.get(this.store ?? '')?.label ?? this.name,
      value: this.labelText ?? formatJoules(this.value),
      scale: this.scaleText ?? `jar holds ${formatJoules(this.capacity)}`,
      sub: this.sub,
    };
  }

  update(dt: number, f: JarFrame): void {
    if (this.disposed) return;
    const J = energyConfig.jar;
    const frozen = !!(f.still || f.paused);
    this.live = f.live;
    if (this.litTarget !== null) this.lit = easeLit(this.lit, f.live ? this.litTarget : 0, dt, this.litRate ?? J.litRate);
    const fill = this.fill;
    const level = this.level;
    const lit = this.lit;
    this.liquid.visible = f.live && lit > J.minLit && fill > J.minFill && !this.qualitative;
    this.liquid.scale.y = level;
    const m = this.material;
    m.uniforms.uColor.value.copy(this.color);
    m.uniforms.uGlow.value = energyConfig.glow.liquid;
    m.uniforms.uAlpha.value = liquidAlpha(lit);
    m.transparent = lit < 0.995;
    if (!frozen) m.uniforms.uTime.value += dt;
    syncLiquidUniforms();
    this.updateBubbles(frozen ? 0 : dt, level, lit);
    if (this.cardDirty && this.canvas && this.texture) {
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (now - this.lastDraw > J.cardThrottle) this.drawCard(now);
    }
    this.group.updateWorldMatrix(true, false);
    if (this.sil) this.updateSilhouettes(this.sil, f.camera, f.lift ?? popLift(this.pop));
  }

  private updateBubbles(dt: number, level: number, lit: number): void {
    const B = energyConfig.bubbles;
    const J = energyConfig.jar;
    const show = this.liquid.visible && level > B.minLevel;
    this.bubbles.visible = show;
    if (!show) return;
    const top = J.liquidBase + level - B.topGap;
    const orbit = this.r - J.liquidInset + B.orbitOut;
    _c.copy(this.color).lerp(WHITE, B.whiten).multiplyScalar(energyConfig.glow.bubbles);
    const count = Math.min(7, Math.max(0, Math.round(B.count)));
    for (let i = 0; i < 7; i++) {
      const k = bubbleConstants(i);
      const y = (this.bubbleY[i] = fract(this.bubbleY[i]! + dt * k.speed * (B.riseBase + lit)));
      const Y = B.bottom + y * (top - B.bottom);
      const w = B.wobble * Math.sin(B.wobbleFreq * y + i);
      const sc = i < count ? k.size * bubbleEnvelope(y) * lit : 0;
      _m.makeScale(sc, sc, sc).setPosition(orbit * Math.cos(k.angle + w), Y, orbit * Math.sin(k.angle + w));
      this.bubbles.setMatrixAt(i, _m);
      this.bubbles.setColorAt(i, _c);
    }
    this.bubbles.instanceMatrix.needsUpdate = true;
    if (this.bubbles.instanceColor) this.bubbles.instanceColor.needsUpdate = true;
  }

  private drawCard(now: number): void {
    const ctx = this.canvas!.getContext('2d');
    this.cardDirty = false;
    this.lastDraw = now;
    if (!ctx) return;
    const t = this.cardText();
    drawCard(ctx, { name: t.name, pattern: this.palette.get(this.store ?? '')?.pattern ?? this.pattern, value: t.value, scale: t.scale, sub: t.sub }, { kind: this.sub !== null ? 'label' : 'jar', style: this.labelStyle === 'tag' ? 'tag' : 'card', tagSide: this.tagSide });
    this.texture!.needsUpdate = true;
  }

  private updateSilhouettes(sil: LineSet, camera: Camera, lift: number): void {
    const [cx, cy] = popCab(this.pop);
    camera.updateMatrixWorld();
    _v.setFromMatrixPosition(camera.matrixWorld);
    eyeInLocal(this.group, _v, _eye);
    printDirInLocal(this.group, this.pop.frame, cx, cy, _dir, _inv);
    cylinderSilhouette(this.r, 0, this.hl, { dir: _dir }, this.silPrint);
    if (camera instanceof PerspectiveCamera || (camera as PerspectiveCamera).isPerspectiveCamera) cylinderSilhouette(this.r, 0, this.hl, { eye: _eye }, this.silCam);
    else {
      _v.set(0, 0, -1).transformDirection(camera.matrixWorld).transformDirection(_inv);
      cylinderSilhouette(this.r, 0, this.hl, { dir: _v }, this.silCam);
    }
    blendLines(this.silPrint, this.silCam, lift, this.silStand);
    (sil as LineSet & { setLines(l: Lines, f?: Lines, o?: readonly LineOptions[]): void }).setLines(this.silStand, this.silPrint, this.silOpts);
  }

  /** Where the jar lights the page from, its colour and how strongly (feed to `SpillSlots`). */
  lightInfo(out?: GlowSource): GlowSource {
    const o = out ?? { id: this.id ?? this.group.name, position: new Vector3(), color: new Color(), strength: 0 };
    this.liquid.updateWorldMatrix(true, false);
    o.position.setFromMatrixPosition(this.liquid.matrixWorld);
    o.position.y += 0.5 * this.level;
    o.color.copy(this.color);
    o.strength = this.live ? jarStrength(this.lit, this.fill, this.qualitative) : 0;
    return o;
  }

  glowObjects(): Object3D[] {
    return [this.liquid, this.bubbles];
  }

  /** Registers this jar's live parameters under `id`. */
  register(registry: Registry, id: string, label?: string): void {
    const self = this;
    registry.add({
      id, label: label ?? `${this.name} jar`, kind: 'energy-jar', tags: ['object', 'energy', 'store', 'ink'], object: this.group,
      describe: `An energy store jar (r ${this.r} mm, h ${this.h} mm) drawn in ink with glowing liquid. Value over capacity sets the level; lit fades the liquid and its light in.`,
      source: 'src/engine/energy/jar.ts',
      params: [
        { key: 'value', label: 'Value', type: 'number', min: 0, unit: 'J', help: 'Stored amount (level = value / capacity)', get: () => self.value, set: (v) => self.setValue(Number(v)) },
        { key: 'capacity', label: 'Capacity', type: 'number', min: 1e-12, unit: 'J', help: 'Amount of a full jar', get: () => self.capacity, set: (v) => ((self.capacity = Number(v)), self.invalidate()) },
        { key: 'lit', label: 'Lit', type: 'number', min: 0, max: 1, help: 'Light-up state (eases toward litTarget when set)', get: () => self.lit, set: (v) => void (self.lit = Number(v)) },
        { key: 'litTarget', label: 'Lit target', type: 'number', min: -1, max: 1, help: 'Target the light eases to (-1 = caller drives lit)', get: () => self.litTarget ?? -1, set: (v) => void (self.litTarget = Number(v) < 0 ? null : Number(v)) },
        { key: 'litRate', label: 'Lit rate', type: 'number', min: 0, max: 60, unit: '1/s', help: 'Light-up rate for this jar', get: () => self.litRate ?? energyConfig.jar.litRate, set: (v) => void (self.litRate = Number(v)) },
        { key: 'qualitative', label: 'No number', type: 'boolean', help: 'A store we cannot put a number on: no liquid, a dim light', get: () => self.qualitative, set: (v) => void (self.qualitative = Boolean(v)) },
        { key: 'labelText', label: 'Value text', type: 'string', help: 'Replaces the joules on the card (empty = joules)', get: () => self.labelText ?? '', set: (v) => ((self.labelText = String(v) || null), self.invalidate()) },
        { key: 'scaleText', label: 'Scale line', type: 'string', help: 'Line at the bottom of the card', get: () => self.cardText().scale, set: (v) => ((self.scaleText = String(v)), self.invalidate()) },
        { key: 'position', label: 'Position', type: 'vector3', unit: 'mm', help: 'Jar base centre in the figure', get: () => self.group.position.toArray(), set: (v) => void self.group.position.fromArray(v as number[]) },
        { key: 't0', label: 'Draw start', type: 'number', min: 0, max: 10, unit: 's', help: 'Start of the jar strokes on the pen clock', get: () => self.t0, set: (v) => ((self.t0 = Number(v)), self.reschedule()) },
        { key: 'pace', label: 'Draw pace', type: 'number', min: 0.05, max: 5, help: 'Stretches the stroke schedule', get: () => self.pace, set: (v) => ((self.pace = Number(v)), self.reschedule()) },
      ],
    });
  }

  dispose(): void {
    this.disposed = true;
    this.group.removeFromParent();
    this.liquid.geometry.dispose();
    this.material.dispose();
    this.bubbles.geometry.dispose();
    (this.bubbles.material as Material).dispose();
    this.bubbles.dispose();
    this.texture?.dispose();
    this.cardMesh?.geometry.dispose();
  }
}
