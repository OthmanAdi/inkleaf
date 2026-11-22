/**
 * The ink part of a glass store jar: rings, graduation ticks, glass highlights, two live side outlines and a
 * label (a tilted card or a hanging tag with canvas text). The energy package adds the glowing liquid, bubbles and
 * light on top: it receives the jar's group, radius, height and label redraw hook from here.
 */
import { CanvasTexture, Group, Mesh, Shape, ShapeGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { PenSchedule } from '../contracts';
import { HAND, SERIF, fitText } from './cards';
import type { InkSpec, Part, PartOptions, Scope } from './kit-core';
import type { InkLineSet } from './line-set';
import { LiveOutline } from './shapes';
import { cylinderSilhouette } from './silhouette';

export interface JarOptions extends PartOptions {
  /** Glass radius (default 13) and height (default 46). */
  r?: number;
  h?: number;
  /** First stroke time in seconds from the peel start (jars are timed explicitly, after the pen body). */
  t0?: number;
  /** Time scale of the jar's strokes (0.7 = 30 % quicker). */
  pace?: number;
  /** 'tag' (hanging luggage tag, default) or 'card' (tilted card in front). */
  label?: 'tag' | 'card';
  /** Tag side: +1 right, -1 left. */
  tagSide?: 1 | -1;
  /** Card placement: size, height, distance in front, tilt (rad). */
  card?: { w?: number; h?: number; y?: number; z?: number; tilt?: number };
  /** Label text: the store name, a value and a scale line. */
  name?: string;
  value?: string;
  scale?: string;
  /** Custom label face; background is set. */
  drawLabel?: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  ink?: InkSpec;
}

export interface JarPart extends Part {
  r: number;
  h: number;
  /** Shoulder height (h - 3.2): top of the liquid space. */
  hl: number;
  lines: InkLineSet;
  sil: InkLineSet;
  /** Card pivot (card style) or null. */
  cardPivot: Group | null;
  labelMesh: Mesh;
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  /** Redraws the label now (text from `setLabel`). */
  redraw(): void;
  setLabel(t: { name?: string; value?: string; scale?: string }): void;
}

function ringPts(r: number, y: number, n: number): Vector3[] {
  return Array.from({ length: n }, (_, k) => new Vector3(r * Math.cos((2 * Math.PI * k) / n), y, r * Math.sin((2 * Math.PI * k) / n)));
}

/** Draws a jar in ink. See `JarOptions`. */
export function jarOutline(s: Scope, o: JarOptions): JarPart {
  const part = s.part('jar', o);
  part.group.userData.isJar = true;
  const pop = s.pop;
  const r = o.r ?? 13, h = o.h ?? 46, pace = o.pace ?? 1, t0 = o.t0 ?? 0.6;
  const rr = r + 0.9, hl = h - 3.2;
  const g = (p: number): PenSchedule => ({ t0: t0 + 0.05 * pace * p, dur: 0.32 * pace });
  const ink = s.root.ink(o.ink, { widthPx: 1.45 });
  const lines = s.staticSet(ink, part.group);
  part.sets.push(lines);
  const add = (p: Vector3[], width: number, sched: PenSchedule, closed = false, taper?: boolean) =>
    lines.add(p, s.lineOpts(p, { width, taper }, { closed, sched }));
  add(ringPts(r, 0, 80), 1.05, g(0), true);
  add(ringPts(rr, hl, 80), 0.95, g(1), true);
  add(ringPts(rr, h, 80), 1.1, g(2), true);
  add(ringPts(r - 1.2, h, 80), 0.6, g(3), true);
  for (let i = 1; i <= 4; i++) {
    const y = 1 + ((hl - 2) * i) / 4;
    const span = i === 4 ? 0.34 : 0.2;
    const a0 = 0.62 * Math.PI;
    const arc = Array.from({ length: 9 }, (_, k) => {
      const a = a0 + (span * k) / 8;
      return new Vector3((r + 0.05) * Math.cos(a), y, (r + 0.05) * Math.sin(a));
    });
    add(arc, 0.75, { t0: g(4 + 0.4 * i).t0, dur: 0.12 }, false, true);
  }
  add([new Vector3(-0.7 * r, 0.18 * h, 0.72 * r), new Vector3(-0.7 * r, 0.52 * h, 0.72 * r)], 0.55, g(6));
  add([new Vector3(-0.55 * r, 0.58 * h, 0.84 * r), new Vector3(-0.55 * r, 0.66 * h, 0.84 * r)], 0.5, g(6.5));

  const style = o.label ?? 'tag';
  const side = o.tagSide ?? 1;
  const cw = style === 'card' ? (o.card?.w ?? 26) : 24, ch = style === 'card' ? (o.card?.h ?? 15) : 15;
  const canvas = document.createElement('canvas');
  canvas.width = 384;
  canvas.height = 240;
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  const text = { name: o.name ?? '', value: o.value ?? '', scale: o.scale ?? '' };
  const redraw = () => {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = pop.env.card.background;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = pop.env.card.text;
    ctx.strokeStyle = pop.env.card.text;
    ctx.textBaseline = 'top';
    if (o.drawLabel) o.drawLabel(ctx, W, H);
    else if (style === 'card') {
      fitText(ctx, text.name, (px) => `600 ${px}px ${SERIF}`, 34, W - 48);
      ctx.fillText(text.name, 24, 18);
      const big = text.value.length > 9 ? 58 : 80;
      fitText(ctx, text.value, (px) => `600 ${px}px ${HAND}`, big, W - 48);
      ctx.fillText(text.value, 24, text.value.length > 9 ? 102 : 90);
      if (text.scale) {
        ctx.fillStyle = pop.env.card.secondary;
        ctx.font = `italic 400 25px ${SERIF}`;
        ctx.fillText(text.scale, 24, H - 42);
      }
    } else {
      const x = side > 0 ? 52 : 26;
      fitText(ctx, text.name, (px) => `600 ${px}px ${SERIF}`, 36, W - x - 100);
      ctx.fillText(text.name, x, 26);
      const big = text.value.length > 9 ? 64 : 88;
      fitText(ctx, text.value, (px) => `600 ${px}px ${HAND}`, big, W - x - 20);
      ctx.fillText(text.value, x, text.value.length > 9 ? 84 : 70);
      if (text.scale) {
        ctx.fillStyle = pop.env.card.secondary;
        ctx.font = `italic 400 26px ${SERIF}`;
        ctx.fillText(text.scale, x, 186);
      }
    }
    texture.needsUpdate = true;
  };
  redraw();
  void (globalThis.document as Document | undefined)?.fonts?.ready.then(redraw);

  const labelPaper = s.root.paper({ color: '#ffffff', hatch: 0, shade: 0.05, doubleSided: true, map: texture }, s.scale)!;
  let cardPivot: Group | null = null;
  let labelMesh: Mesh;
  if (style === 'card') {
    cardPivot = new Group();
    cardPivot.position.set(0, o.card?.y ?? -h / 2 - 1.5, o.card?.z ?? r + 3.5);
    cardPivot.rotation.x = -(o.card?.tilt ?? 0.32);
    part.group.add(cardPivot);
    const shape = new Shape();
    shape.moveTo(-cw / 2, -ch / 2);
    shape.lineTo(cw / 2, -ch / 2);
    shape.lineTo(cw / 2, ch / 2);
    shape.lineTo(-cw / 2, ch / 2);
    shape.closePath();
    const geo = new ShapeGeometry(shape);
    const uv = geo.getAttribute('uv'), pos = geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + cw / 2) / cw, (pos.getY(i) + ch / 2) / ch);
    labelMesh = s.surface(part, new Mesh(geo, labelPaper), cardPivot, false);
    const cardSet = s.staticSet(s.root.ink(o.ink, { widthPx: 1.3 }), cardPivot);
    part.sets.push(cardSet);
    const rect = (inset: number) => [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => new Vector3(a! * (cw / 2 - inset), b! * (ch / 2 - inset), 0.15));
    const outer = rect(0), inner = rect(1.1);
    cardSet.add(outer, s.lineOpts(outer, { width: 0.95 }, { closed: true, sched: g(7.6) }));
    cardSet.add(inner, s.lineOpts(inner, { width: 0.45 }, { closed: true, sched: g(8.2) }));
  } else {
    const centre = new Vector3(side * (r + 15), 0.42 * h, 0.55 * r);
    const poly: [number, number][] = [[-8, 7.5], [12, 7.5], [12, -7.5], [-8, -7.5], [-12, -3.5], [-12, 3.5]];
    const shape = new Shape();
    poly.forEach(([x, y], i) => (i ? shape.lineTo(side * x, y) : shape.moveTo(side * x, y)));
    shape.closePath();
    const geo = new ShapeGeometry(shape);
    const uv = geo.getAttribute('uv'), pos = geo.getAttribute('position');
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + 12) / 24, (pos.getY(i) + 7.5) / 15);
    const m = new Mesh(geo, labelPaper);
    m.position.copy(centre);
    labelMesh = s.surface(part, m, part.group, false);
    const outline = poly.map(([x, y]) => new Vector3(centre.x + side * x, centre.y + y, centre.z + 0.15));
    add(outline, 0.9, g(7.6), true);
    const hole = centre.clone().add(new Vector3(-side * 8.8, 4.3, 0.2));
    const holePts = Array.from({ length: 16 }, (_, k) => hole.clone().add(new Vector3(1.1 * Math.cos((k / 16) * 2 * Math.PI), 1.1 * Math.sin((k / 16) * 2 * Math.PI), 0)));
    add(holePts, 0.6, { t0: g(8.2).t0, dur: 0.1 }, true);
    const a = Math.PI / 2 - side * 0.55;
    const start = new Vector3(rr * Math.cos(a), hl + 0.6, rr * Math.sin(a));
    const mid = start.clone().add(hole).multiplyScalar(0.5).add(new Vector3(0, -4, 1));
    add([start, mid, hole], 0.6, g(7), false, true);
  }

  const silInk = s.root.ink(o.ink, { widthPx: 1.6 });
  const sil = s.dynamicSet(silInk, part.group, 64);
  part.sets.push(sil);
  const silT0 = t0 + 0.08 * pace, silDur = 0.3 * pace;
  const scheds: PenSchedule[] = [0, 1].map((v) => ({ t0: silT0 + 0.04 * v, dur: silDur }));
  const live = new LiveOutline(sil, part.group, s, (i) => ({ width: 1.05, seed: 300 + i, sched: scheds[i % 2] }));
  s.every((f) => live.update(f, (viewer, out) => cylinderSilhouette(r, 0, hl, viewer, out)));

  s.register(part, 'jar', { ...o, tags: [...(o.tags ?? []), 'energy', 'store'] }, `A glass store jar r ${r} mm, ${h} mm tall, drawn in ink with a ${style} label.`, [
    { key: 'name', label: 'Name', type: 'string', get: () => text.name, set: (v) => { text.name = String(v); redraw(); } },
    { key: 'value', label: 'Value', type: 'string', get: () => text.value, set: (v) => { text.value = String(v); redraw(); } },
  ]);
  return Object.assign(part, {
    r, h, hl, lines, sil, cardPivot, labelMesh: labelMesh!, canvas, texture, redraw,
    setLabel(t: { name?: string; value?: string; scale?: string }) {
      Object.assign(text, t);
      redraw();
    },
  });
}
