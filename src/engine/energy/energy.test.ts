import { Color, Group, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, PerspectiveCamera, PointLight, Texture, Vector3, type Material, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { LAYERS, type GlowSource, type LineOptions, type LineSet, type Pop } from '../contracts';
import { Registry } from '../core/registry';
import { energyConfig, registerEnergy } from './config';
import { packetOffsets } from './flow';
import { GlowRouter, SpillSlots } from './glow';
import { handText, handTextWidth, inkArrow } from './handwriting';
import { bubbleConstants, bubbleEnvelope, easeLit, Jar, jarLevel, jarSchedule, jarStrength, liquidAlpha } from './jar';
import { Ledger } from './ledger';
import { ribbonWidth } from './ribbon';
import { archPoints, beadAt, beadsShown, glowStep, Stream, streamRadius, streamSpeed } from './stream';
import { stackBar } from './total-bar';
import { driveStream } from './flow';
import { CatmullRomCurve3 } from 'three';

// A minimal stand-in for the ink package's Pop: records strokes, adds meshes to their parents.
class RecSet implements LineSet {
  mesh = new Mesh();
  strokes: { points: readonly Vector3[]; opts: LineOptions }[] = [];
  dyn: { lines: readonly (readonly Vector3[])[]; opts?: readonly LineOptions[] } | null = null;
  constructor(readonly capacity = 0) {}
  add(points: readonly Vector3[], opts: LineOptions = {}): void {
    this.strokes.push({ points, opts });
  }
  build(): void {}
  setLines(lines: readonly (readonly Vector3[])[], _flat?: readonly (readonly Vector3[])[], opts?: readonly LineOptions[]): void {
    this.dyn = { lines: lines.map((l) => l.map((p) => p.clone())), opts };
  }
  reschedule(): void {}
  get end(): number {
    return Math.max(0, ...this.strokes.map((s) => (s.opts.sched ? s.opts.sched.t0 + s.opts.sched.dur : (s.opts.t0 ?? 0) + (s.opts.dur ?? 0))));
  }
}

function mockPop(): Pop & { sets: RecSet[] } {
  const group = new Group();
  const sets: RecSet[] = [];
  return {
    sets, group, state: 'live', t: 0, printAlpha: 0, drawEnd: 0, frame: new Matrix4(),
    ink: () => new MeshBasicMaterial(),
    paper: () => new MeshLambertMaterial(),
    lines: (_m: Material, o?: { capacity?: number }) => {
      const s = new RecSet(o?.capacity);
      sets.push(s);
      return s;
    },
    addLines: (s: LineSet, parent?: Object3D) => void (parent ?? group).add(s.mesh),
    addSurface: (m: Mesh, parent?: Object3D) => void (parent ?? group).add(m),
    pen: () => ({ next: () => ({ t0: 0, dur: 0.1 }), pause: () => {}, end: 0, fit: () => {} }),
    set: () => {}, draw: () => {}, undraw: async () => {}, update: () => {}, renderPrint: () => new Texture(), setResolution: () => {}, dispose: () => {},
  };
}

const camera = () => {
  const c = new PerspectiveCamera(30, 16 / 9, 1, 5000);
  c.position.set(80, 300, 250);
  c.lookAt(80, 40, -100);
  c.updateMatrixWorld();
  return c;
};

describe('jar math', () => {
  it('level = max(0.05, fill x 25.6) for a lesson-1 jar', () => {
    const hl = 31 - 3.2;
    expect(jarLevel(14.7 / 20, hl)).toBeCloseTo(18.816, 9);
    expect(jarLevel(1, hl)).toBeCloseTo(25.6, 9);
    expect(jarLevel(0, hl)).toBe(0.05);
    expect(jarLevel(1, 36 - 3.2)).toBeCloseTo(30.6, 9);
  });

  it('lit eases at 5/s, frame-rate dependent: lit += (t - lit) min(1, 5 dt)', () => {
    expect(easeLit(0, 1, 1 / 60)).toBeCloseTo(1 / 12, 12);
    expect(easeLit(0, 1, 0.3)).toBe(1);
    expect(easeLit(0.5, 0, 0.1, 6)).toBeCloseTo(0.2, 12);
    expect(liquidAlpha(0.5)).toBe(0.5);
    expect(liquidAlpha(0.25)).toBeCloseTo(0.15625, 12);
  });

  it('light strength = lit x min(1, 0.25 + fill), measured values', () => {
    expect(jarStrength(1, 0.32 / 0.5) * 2600).toBeCloseTo(2314, 0);
    expect(jarStrength(1, 0.735) * 2600).toBeCloseTo(2561, 0);
    expect(jarStrength(1, 1)).toBe(1);
    expect(jarStrength(1, 0, true) * 2600).toBeCloseTo(1430, 9);
    expect(jarStrength(1, 0.004)).toBe(0);
    expect(jarStrength(0.5, 0.9)).toBeCloseTo(0.5, 12);
  });

  it('bubble constants and envelope', () => {
    const b1 = bubbleConstants(1);
    expect(b1.angle / Math.PI).toBeCloseTo(0.5755, 3);
    expect(b1.speed).toBeCloseTo(0.157, 3);
    expect(b1.size).toBeCloseTo(0.5355, 3);
    expect(bubbleConstants(6).y0).toBeCloseTo(0.8571, 4);
    for (let i = 0; i < 7; i++) {
      const a = bubbleConstants(i).angle;
      expect(a).toBeGreaterThanOrEqual(0.18 * Math.PI - 1e-12);
      expect(a).toBeLessThanOrEqual(0.82 * Math.PI + 1e-12);
    }
    expect(bubbleEnvelope(0.5)).toBe(1);
    expect(bubbleEnvelope(1 / 12)).toBeCloseTo(0.5, 12);
    expect(bubbleEnvelope(1 - 1 / 16)).toBeCloseTo(0.5, 12);
  });

  it('staggered outline timings: t0 = 0.62 + 0.045 i, silhouettes at +0.056, dur 0.21', () => {
    for (let i = 0; i < 8; i++) {
      const t0 = 0.62 + 0.045 * i;
      expect(t0 + energyConfig.jar.silDelay * 0.7).toBeCloseTo([0.676, 0.721, 0.766, 0.811, 0.856, 0.901, 0.946, 0.991][i]!, 9);
    }
    const last = jarSchedule(0.62 + 0.045 * 7, 0.7, 8.2);
    expect(last.t0 + last.dur).toBeCloseTo(1.446, 9);
    expect(jarSchedule(0, 0.7, 4 + 0.4).t0).toBeCloseTo(0.154, 9);
    expect(energyConfig.jar.silDur * 0.7).toBeCloseTo(0.21, 12);
  });
});

describe('stream math', () => {
  it('radius = (0.4 + 1.35 sqrt(level)) x glow ramp, electrical capped at 0.9', () => {
    expect(streamRadius(1, 1)).toBeCloseTo(1.75, 12);
    expect(streamRadius(0.25, 1)).toBeCloseTo(1.075, 12);
    expect(streamRadius(0, 1)).toBeCloseTo(0.4, 12);
    expect(streamRadius(1, 0.5)).toBeCloseTo(0.875, 12);
    expect(streamRadius(1, 1, 'electrical')).toBeCloseTo(0.9, 12);
    expect(streamRadius(0, 0.5, 'electrical')).toBeCloseTo(0.2, 12);
  });

  it('bead speeds per pathway (mm/s)', () => {
    expect(streamSpeed('mechanical', 0)).toBe(30);
    expect(streamSpeed('mechanical', 1)).toBe(80);
    expect(streamSpeed('mechanical', 0.5)).toBe(55);
    expect(streamSpeed('electrical', 0.3)).toBe(140);
    expect(streamSpeed('heating', 1)).toBe(18);
    expect(streamSpeed('radiation', 0)).toBe(160);
  });

  it('glow eases at 8/s and snaps when still', () => {
    expect(glowStep(0, 1, 1 / 60)).toBeCloseTo(1 - Math.exp(-8 / 60), 12);
    expect(glowStep(0.3, 0, 0.1, true)).toBe(0);
  });

  it('11 beads, 5 on heating, 6 on the low tier', () => {
    expect(beadsShown(11, 'mechanical')).toBe(11);
    expect(beadsShown(11, 'heating')).toBe(5);
    expect(beadsShown(11, 'heating', 0.5)).toBe(3);
    expect(beadsShown(11, 'mechanical', 0.5)).toBe(6);
    const mid = beadAt(5, 11, 0.04545454, 1, 1, 11);
    expect(mid.w).toBeCloseTo(0.5, 6);
    expect(beadAt(5, 11, 0.04545454, -1, 1, 11).h).toBeCloseTo(0.5, 6);
    expect(beadAt(0, 11, 0.02, 1, 1, 11).size).toBe(0);
    expect(beadAt(0, 11, 0.06, 1, 1, 11).size).toBeCloseTo(0.5 * 0.75, 9);
  });

  it('arch streams have the measured lengths', () => {
    const len = (a: [number, number, number], b: [number, number, number], H: number) =>
      new CatmullRomCurve3(archPoints(new Vector3(...a), new Vector3(...b), H), false, 'centripetal').getLength();
    expect(len([35, 76, -116], [69, 76, -116], 18)).toBeCloseTo(56.4, 1);
    expect(len([69, 76, -116], [103, 76, -116], 15)).toBeCloseTo(51.75, 1);
    expect(len([52, 64.2, -98], [86, 64.2, -98], 20)).toBeCloseTo(59.57, 1);
  });

  it('packets sit on the electrical pulse peaks every 18 mm', () => {
    const { o, count } = packetOffsets(0, 60);
    expect(o).toBeCloseTo(0.97 * 18, 9);
    expect(count).toBe(3);
    expect(packetOffsets(2, 60).o).toBeCloseTo((6 + 17.46) % 18, 9);
  });

  it('ribbon width = power x 0.2 mm/W', () => {
    expect(ribbonWidth(30)).toBeCloseTo(6, 12);
    expect(ribbonWidth(0)).toBe(0);
    expect(ribbonWidth(1, 0.2, 2.5)).toBe(2.5);
  });

  it('total bar stacks segments from 0.3 mm', () => {
    const s = stackBar([3, 2, 1], 6, 40);
    expect(s[0]).toEqual({ y: 0.3, scale: 20, visible: true });
    expect(s[1]!.y).toBeCloseTo(20.3, 12);
    expect(s[2]!.scale).toBeCloseTo(40 - 0.3 - (0.3 + 20 + 40 / 3), 9);
    expect(stackBar([0, 0.001], 6, 40)[1]!.visible).toBe(false);
  });
});

describe('Jar component', () => {
  it('draws the lesson-1 jar with the spec schedule and lights the page', () => {
    const pop = mockPop();
    const reg = new Registry();
    const jar = new Jar(pop, {
      id: 'lesson-1.jar.nuclear', registry: reg, store: 'nuclear', r: 9.4, h: 31, capacity: 20, labelStyle: 'card',
      card: { y: 2.2, z: 13, tilt: 0.95, w: 22, h: 12.5 }, t0: 0.62 + 0.045 * 7, pace: 0.7, position: [137, 3, -116],
    });
    const lines = pop.sets[0]!;
    expect(lines.strokes).toHaveLength(10);
    expect(lines.strokes[0]!.points).toHaveLength(80);
    expect(lines.strokes[0]!.opts.closed).toBe(true);
    expect(lines.strokes[4]!.opts.sched!.dur).toBe(0.12);
    expect(jar.drawEnd).toBeCloseTo(1.446, 9);
    jar.setValue(14.7);
    jar.litTarget = 1;
    for (let i = 0; i < 120; i++) jar.update(1 / 60, { camera: camera(), live: true });
    expect(jar.lit).toBeGreaterThan(0.999);
    expect(jar.liquid.visible).toBe(true);
    expect(jar.liquid.scale.y).toBeCloseTo(18.816, 9);
    expect(jar.bubbles.visible).toBe(true);
    const sil = pop.sets.find((s) => s.capacity === 64)!;
    expect(sil.dyn!.lines).toHaveLength(2);
    expect(sil.dyn!.opts![0]!.t0).toBeCloseTo(0.991, 9);
    expect(sil.dyn!.opts![1]!.t0).toBeCloseTo(1.031, 9);
    expect(sil.dyn!.opts![0]!.dur).toBeCloseTo(0.21, 12);
    const top = sil.dyn!.lines[0]![1]!;
    expect(top.y).toBeCloseTo(27.8, 9);
    expect(Math.hypot(top.x, top.z)).toBeCloseTo(9.4, 9);
    const info = jar.lightInfo();
    expect(info.strength).toBeCloseTo(0.985, 3);
    expect(info.position.y).toBeCloseTo(3 + 0.9 + 0.5 * 18.816, 6);
    expect(info.color.equals(new Color('#ffcf1a'))).toBe(true);
    expect(reg.getParam('lesson-1.jar.nuclear', 'value')).toBe(14.7);
    reg.set('lesson-1.jar.nuclear', 'value', 20);
    expect(jar.fill).toBe(1);
    jar.update(1 / 60, { camera: camera(), live: false });
    expect(jar.liquid.visible).toBe(false);
    expect(jar.cardText()).toEqual({ name: 'Nuclear', value: '20 J', scale: 'jar holds 20 J', sub: null });
  });

  it('a qualitative jar has no liquid and a dim light', () => {
    const jar = new Jar(mockPop(), { store: 'magnetic', r: 9.4, h: 31, value: 1, capacity: 1, qualitative: true });
    jar.lit = 1;
    jar.update(0.016, { camera: camera(), live: true });
    expect(jar.liquid.visible).toBe(false);
    expect(jar.lightInfo().strength).toBeCloseTo(0.55, 12);
  });
});

describe('Stream component', () => {
  it('glows with power, reverses colours with the flow and lights at its middle', () => {
    const reg = new Registry();
    const s = new Stream({ id: 'lesson-1.stream.fall', registry: reg, from: 'gravitational', to: 'kinetic', arch: { a: new Vector3(35, 76, -116), b: new Vector3(69, 76, -116), height: 18 } });
    s.setPower(14, 14);
    for (let i = 0; i < 60; i++) s.update(1 / 60, { live: true });
    expect(s.glow).toBeGreaterThan(0.99);
    expect(s.material.uniforms.uRadius.value).toBeCloseTo(1.75, 3);
    expect(s.tube.visible).toBe(true);
    const info = s.lightInfo();
    expect(info.color.getHexString()).toBe('4640ff');
    expect(info.strength).toBeCloseTo(s.glow, 9);
    s.setPower(-7, 14);
    s.update(1 / 60, { live: true });
    expect(s.material.uniforms.uDir.value).toBe(-1);
    expect(s.material.uniforms.uA.value.equals(new Color('#2f7bff'))).toBe(true);
    reg.set('lesson-1.stream.fall', 'pathway', 'heating');
    expect(s.mode).toBe('heating');
  });

  it('is driven by ledger flows', () => {
    const l = new Ledger();
    l.open('gravitational:book', 10);
    l.open('kinetic:book', 0);
    for (let i = 0; i < 100; i++) {
      l.beginStep(0.01);
      l.transfer('gravitational:book', 'kinetic:book', 0.1, 'mechanical');
      l.endStep();
    }
    const s = new Stream({ from: 'gravitational', to: 'kinetic', points: [new Vector3(), new Vector3(10, 5, 0), new Vector3(20, 0, 0)] });
    const w = driveStream(s, l, 'gravitational', 'kinetic', { scale: 0.25, max: 14 });
    expect(w).toBeCloseTo(10 * (1 - Math.exp(-5)) * 0.25, 9);
    expect(s.power).toBeCloseTo(w, 12);
    expect(s.dir).toBe(1);
  });
});

describe('glow routing and spill slots', () => {
  it('routes glow objects onto the glow layer and into the bloom selection', () => {
    const picked: Object3D[] = [];
    const r = new GlowRouter({ bloomSelect: (o, on) => (on ? picked.push(o) : picked.splice(picked.indexOf(o), 1)) });
    const m = new Mesh();
    r.add([m]);
    expect(m.layers.isEnabled(LAYERS.glow)).toBe(true);
    expect(m.layers.isEnabled(LAYERS.pop)).toBe(false);
    expect(picked).toEqual([m]);
    r.clear();
    expect(m.layers.isEnabled(LAYERS.glow)).toBe(false);
    expect(picked).toEqual([]);
  });

  const src = (id: string, strength: number): GlowSource => ({ id, position: new Vector3(), color: new Color(1, 0, 0), strength });

  it('gives the three strongest sources a slot and fades them in at 12/s', () => {
    const lights = [new PointLight(), new PointLight(), new PointLight()];
    const slots = new SpillSlots(lights);
    const list = [src('a', 0.2), src('b', 0.9), src('c', 0.5), src('d', 0.7)];
    slots.update(list, 1 / 60);
    expect(slots.slots.map((s) => s.id)).toEqual(['b', 'd', 'c']);
    const h = 1 - Math.exp(-12 / 60);
    expect(slots.slots[0]!.k).toBeCloseTo(h, 12);
    expect(lights[0]!.intensity).toBeCloseTo(2600 * 0.9 * h, 9);
    for (let i = 0; i < 120; i++) slots.update(list, 1 / 60);
    expect(lights[0]!.intensity).toBeCloseTo(2600 * 0.9, 6);
  });

  it('keeps incumbents (+0.2 bonus) and drops vanished sources at once', () => {
    const slots = new SpillSlots(1);
    slots.update([src('old', 0.5)], 1 / 60);
    slots.update([src('old', 0.5), src('new', 0.65)], 1 / 60);
    expect(slots.slots[0]!.id).toBe('old');
    slots.update([src('old', 0.005), src('new', 0.65)], 1 / 60);
    expect(slots.slots[0]!.id).toBe('new');
    expect(slots.slots[0]!.k).toBeCloseTo(1 - Math.exp(-12 / 60), 12);
  });

  it('fades out a slot that lost and frees it below 0.02', () => {
    const slots = new SpillSlots(1);
    for (let i = 0; i < 60; i++) slots.update([src('a', 0.3)], 1 / 60);
    const k0 = slots.slots[0]!.k;
    let expected = 0;
    while (k0 * Math.exp(-0.2 * expected) >= 0.02) expected++;
    let frames = 0;
    while (slots.slots[0]!.id === 'a' && frames < 200) {
      slots.update([src('a', 0.3), src('b', 0.9)], 1 / 60);
      frames++;
    }
    expect(frames).toBe(expected);
    expect(slots.slots[0]!.id).toBe('b');
  });

  it('reproduces the measured Sun ramp: about 2588 one second after the tap', () => {
    const pop = mockPop();
    const sun = new Jar(pop, { id: 'sun', store: 'nuclear', r: 9.4, h: 31, capacity: 1, value: 1 });
    const slots = new SpillSlots(3);
    sun.litTarget = 1;
    const cam = camera();
    for (let i = 0; i < 60; i++) {
      sun.update(1 / 60, { camera: cam, live: true });
      slots.update([sun.lightInfo()], 1 / 60);
    }
    expect(slots.slots[0]!.intensity).toBeGreaterThan(2575);
    expect(slots.slots[0]!.intensity).toBeLessThan(2600);
  });
});

describe('handwriting', () => {
  it('lays out glyphs with spacing 0.13 em and slant', () => {
    expect(handTextWidth('0.24', 4)).toBeCloseTo((0.5 + 0.16 + 0.52 + 0.54 + 3 * 0.13) * 4, 12);
    const strokes = handText('1', { size: 10 });
    expect(strokes).toHaveLength(1);
    expect(strokes[0]![1]!.x).toBeCloseTo((0.24 + 0.16) * 10, 12);
    expect(strokes[0]![1]!.y).toBeCloseTo(10, 12);
  });

  it('draws an arrow head with half-width 0.55 head', () => {
    const [shaft, head] = inkArrow(new Vector3(0, 0, 0), new Vector3(10, 0, 0), 2);
    expect(shaft).toHaveLength(2);
    expect(head![0]!.distanceTo(new Vector3(8, 1.1, 0))).toBeLessThan(1e-12);
  });
});

describe('registry', () => {
  it('registers the shared energy groups by name', () => {
    const reg = new Registry();
    registerEnergy(reg);
    for (const id of ['energy.jar', 'energy.jar-liquid', 'energy.jar-bubbles', 'energy.jar-card', 'energy.stream', 'energy.bead-speeds', 'energy.stream-modes', 'energy.glow', 'energy.spill-lights', 'energy.ledger', 'energy.hue-blend', 'energy.flow', 'energy.ribbon', 'energy.total-bar', 'energy.jar-scale'])
      expect(reg.has(id)).toBe(true);
    expect(reg.getParam('energy.glow', 'beads')).toBe(1.9);
    reg.set('energy.bead-speeds', 'heating', 25);
    expect(streamSpeed('heating', 0)).toBe(25);
    reg.set('energy.bead-speeds', 'heating', 18);
    expect(reg.getParam('energy.spill-lights', 'gain')).toBe(2600);
  });
});
