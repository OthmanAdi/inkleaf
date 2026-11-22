/**
 * Paper cards and hanging tags with canvas text: a white paper face (no hatching) carrying a canvas texture, with
 * pen borders drawn stroke by stroke. Text is redrawn when it changes, at most every 70 ms.
 */
import { CanvasTexture, Mesh, PlaneGeometry, Shape, ShapeGeometry, SRGBColorSpace, Vector3, type BufferGeometry } from 'three';
import { pts, v3, type InkSpec, type Part, type PartOptions, type Scope, type StrokeStyle, type Vec3 } from './kit-core';

export const SERIF = '"Source Serif 4 Variable", "Source Serif 4", Georgia, "Times New Roman", serif';
export const HAND = '"Caveat Variable", Caveat, "Segoe Print", "Comic Sans MS", cursive';

/** Shrinks a font size by `step` until `text` fits `maxWidth` px or the size reaches `minSize`. Returns the size. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, font: (px: number) => string, size: number, maxWidth: number, step = 0.94, minSize = 6): number {
  let s = size;
  ctx.font = font(s);
  while (s > minSize && ctx.measureText(text).width > maxWidth) {
    s = Math.max(minSize, s * step);
    ctx.font = font(s);
  }
  return s;
}

function makeCanvas(wpx: number, hpx: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; texture: CanvasTexture } {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(2, Math.round(wpx));
  canvas.height = Math.max(2, Math.round(hpx));
  const ctx = canvas.getContext('2d')!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  return { canvas, ctx, texture };
}

function onFonts(fn: () => void): void {
  const fonts = (globalThis.document as Document | undefined)?.fonts;
  if (!fonts) return;
  void fonts.ready.then(fn);
  fonts.addEventListener?.('loadingdone', fn);
}

function rectPts(w: number, h: number, inset: number, z: number): Vector3[] {
  const x = w / 2 - inset, y = h / 2 - inset;
  return [new Vector3(-x, y, z), new Vector3(x, y, z), new Vector3(x, -y, z), new Vector3(-x, -y, z)];
}

export interface CardText {
  /** Small serif heading at the top left. */
  title?: string;
  /** Large handwritten value. */
  value?: string;
  /** Italic secondary line. */
  sub?: string;
}

export interface CardOptions extends PartOptions, CardText {
  /** Card width and height in mm (default 26 x 15). */
  w?: number;
  h?: number;
  /** Custom face drawing; background (#fbf6ea) and ink colour are already set. Overrides title/value/sub. */
  draw?: (ctx: CanvasRenderingContext2D, wpx: number, hpx: number) => void;
  /** Canvas pixels per mm (default 14). */
  px?: number;
  /** Pen borders (default true). */
  lines?: boolean;
  /** Inner border inset (mm, default 1). */
  inset?: number;
  ink?: InkSpec;
  style?: StrokeStyle;
}

export interface CardPart extends Part {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  /** Redraws the face now. */
  redraw(): void;
  /** Changes the text; redrawn on the next frame (throttled). */
  setText(t: CardText): void;
}

function drawCardText(ctx: CanvasRenderingContext2D, wpx: number, hpx: number, t: CardText, secondary: string, shrink: number): void {
  const k = hpx / 240;
  ctx.textBaseline = 'top';
  if (t.title) {
    ctx.font = `600 ${34 * k}px ${SERIF}`;
    fitText(ctx, t.title, (s) => `600 ${s}px ${SERIF}`, 34 * k, wpx - 48 * k, shrink);
    ctx.fillText(t.title, 24 * k, 18 * k);
  }
  if (t.sub) {
    ctx.save();
    ctx.fillStyle = secondary;
    fitText(ctx, t.sub, (s) => `italic 400 ${s}px ${SERIF}`, 25 * k, wpx - 48 * k, shrink);
    ctx.fillText(t.sub, 24 * k, hpx - 42 * k);
    ctx.restore();
  }
  if (t.value) {
    const big = t.value.length > 9 ? 58 : 80;
    fitText(ctx, t.value, (s) => `600 ${s}px ${HAND}`, big * k, wpx - 48 * k, shrink);
    ctx.fillText(t.value, 24 * k, (t.value.length > 9 ? 102 : 90) * k - (big * k) / 2);
  }
}

/** A paper card with canvas text and a double pen border, in the part's XY plane (facing +Z). */
export function card(s: Scope, o: CardOptions): CardPart {
  const part = s.part('card', o);
  const env = s.pop.env.card;
  const w = o.w ?? 26, h = o.h ?? 15;
  const px = o.px ?? env.pxPerMm;
  const { canvas, ctx, texture } = makeCanvas(w * px, h * px);
  const text: CardText = { title: o.title, value: o.value, sub: o.sub };
  const redraw = () => {
    ctx.fillStyle = env.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = env.text;
    ctx.strokeStyle = env.text;
    if (o.draw) o.draw(ctx, canvas.width, canvas.height);
    else drawCardText(ctx, canvas.width, canvas.height, text, env.secondary, env.fitShrink);
    texture.needsUpdate = true;
  };
  redraw();
  onFonts(redraw);
  const paper = s.root.paper({ color: '#ffffff', hatch: 0, shade: 0.05, doubleSided: true, map: texture }, s.scale);
  if (paper) s.surface(part, new Mesh(new PlaneGeometry(w, h), paper), part.group, false);
  if (o.lines !== false) {
    const set = s.staticSet(s.root.ink(o.ink, { widthPx: env.borderPx }), part.group);
    part.sets.push(set);
    const outer = rectPts(w, h, 0, env.lift), inner = rectPts(w, h, o.inset ?? env.inset, env.lift);
    set.add(outer, s.lineOpts(outer, { ...o.style, width: env.outerWidth }, { closed: true, ...s.schedule(w + h, o.style?.time) }));
    set.add(inner, s.lineOpts(inner, { ...o.style, width: env.innerWidth }, { closed: true, ...s.schedule(0.8 * (w + h), o.style?.time) }));
  }
  let dirty = false, last = 0;
  s.every(() => {
    if (!dirty) return;
    const now = performance.now();
    if (now - last < env.redrawMs) return;
    last = now;
    dirty = false;
    redraw();
  });
  s.register(part, 'card', o, `A ${w} x ${h} mm paper card with canvas text.`, [
    { key: 'title', label: 'Title', type: 'string', get: () => text.title ?? '', set: (v) => { text.title = String(v); dirty = true; } },
    { key: 'value', label: 'Value', type: 'string', get: () => text.value ?? '', set: (v) => { text.value = String(v); dirty = true; } },
    { key: 'sub', label: 'Sub line', type: 'string', get: () => text.sub ?? '', set: (v) => { text.sub = String(v); dirty = true; } },
  ]);
  return Object.assign(part, {
    canvas, texture, redraw,
    setText(t: CardText) {
      Object.assign(text, t);
      dirty = true;
    },
  });
}

export interface TagOptions extends PartOptions {
  /** Main handwritten text. */
  text: string;
  /** Small italic line under it. */
  sub?: string;
  /** Tag size in mm (default 20 x 12). */
  w?: number;
  h?: number;
  /** Hang the tag on a string from this point (part space). */
  hangFrom?: Vec3;
  ink?: InkSpec;
  style?: StrokeStyle;
}

export interface TagPart extends Part {
  canvas: HTMLCanvasElement;
  texture: CanvasTexture;
  redraw(): void;
  setText(text: string, sub?: string): void;
}

function tagOutline(w: number, h: number, cut: number): [number, number][] {
  return [[-w / 2 + cut, h / 2], [w / 2, h / 2], [w / 2, -h / 2], [-w / 2 + cut, -h / 2], [-w / 2, -h / 2 + cut], [-w / 2, h / 2 - cut]];
}

function shapeGeometry(poly: readonly [number, number][], w: number, h: number): BufferGeometry {
  const shape = new Shape();
  poly.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  shape.closePath();
  const g = new ShapeGeometry(shape);
  const uv = g.getAttribute('uv');
  const pos = g.getAttribute('position');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  uv.needsUpdate = true;
  return g;
}

/** A hanging luggage tag: chamfered outline, a hole, handwritten text and an optional string. */
export function tag(s: Scope, o: TagOptions): TagPart {
  const part = s.part('tag', o);
  const env = s.pop.env.card;
  const w = o.w ?? 20, h = o.h ?? 12;
  const px = env.tagPxPerMm;
  const { canvas, ctx, texture } = makeCanvas(w * px, h * px);
  const t = { text: o.text, sub: o.sub };
  const redraw = () => {
    const W = canvas.width, H = canvas.height;
    ctx.fillStyle = env.background;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#273463';
    ctx.textBaseline = 'alphabetic';
    const main = t.sub ? H * 0.56 : H * 0.7;
    fitText(ctx, t.text, (sz) => `600 ${sz}px ${HAND}`, main, 0.76 * W, 0.92);
    ctx.fillText(t.text, 0.2 * W, t.sub ? 0.56 * H : 0.7 * H);
    if (t.sub) {
      ctx.fillStyle = env.secondary;
      ctx.font = `italic 400 ${0.2 * H}px ${SERIF}`;
      ctx.fillText(t.sub, 0.2 * W, 0.86 * H);
    }
    texture.needsUpdate = true;
  };
  redraw();
  onFonts(redraw);
  const cut = Math.min(env.tagCut, 0.28 * h);
  const poly = tagOutline(w, h, cut);
  const paper = s.root.paper({ color: '#ffffff', hatch: 0, shade: 0.05, doubleSided: true, map: texture }, s.scale);
  if (paper) s.surface(part, new Mesh(shapeGeometry(poly, w, h), paper), part.group, false);
  const set = s.staticSet(s.root.ink(o.ink, { widthPx: env.borderPx }), part.group);
  part.sets.push(set);
  const hole = new Vector3(-w / 2 + 2.6, 0, env.lift);
  if (o.hangFrom) {
    const a = v3(o.hangFrom).sub(part.group.position);
    const mid = a.clone().add(hole).multiplyScalar(0.5);
    mid.y -= 3;
    const str = pts([a, mid, hole]);
    set.add(str, s.lineOpts(str, { ...o.style, width: 0.6 }));
  }
  const outline = poly.map(([x, y]) => new Vector3(x, y, env.lift));
  set.add(outline, s.lineOpts(outline, { ...o.style, width: 0.9 }, { closed: true, ...s.schedule(2 * (w + h), o.style?.time) }));
  const holePts = Array.from({ length: 16 }, (_, k) => hole.clone().add(new Vector3(0.9 * Math.cos((k / 16) * 2 * Math.PI), 0.9 * Math.sin((k / 16) * 2 * Math.PI), 0)));
  set.add(holePts, s.lineOpts(holePts, { ...o.style, width: 0.55 }, { closed: true, ...s.schedule(6, o.style?.time) }));
  let dirty = false, last = 0;
  s.every(() => {
    if (!dirty || performance.now() - last < env.redrawMs) return;
    last = performance.now();
    dirty = false;
    redraw();
  });
  s.register(part, 'tag', o, `A ${w} x ${h} mm hanging tag reading "${o.text}".`, [
    { key: 'text', label: 'Text', type: 'string', get: () => t.text, set: (v) => { t.text = String(v); dirty = true; } },
    { key: 'sub', label: 'Sub line', type: 'string', get: () => t.sub ?? '', set: (v) => { t.sub = String(v) || undefined; dirty = true; } },
  ]);
  return Object.assign(part, {
    canvas, texture, redraw,
    setText(text: string, sub?: string) {
      t.text = text;
      if (sub !== undefined) t.sub = sub;
      dirty = true;
    },
  });
}
