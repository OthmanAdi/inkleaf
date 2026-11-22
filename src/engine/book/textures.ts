/**
 * Procedural textures of the book: paper normal and background, cloth weave, foil and blind-stamp layouts, ribbon
 * ribs, head-band beads and the cover plate. Everything is generated on the CPU once (layouts again when their text
 * changes) and uploaded as mipmapped textures.
 */
import {
  CanvasTexture, DataTexture, LinearFilter, LinearMipmapLinearFilter, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  UnsignedByteType, type Texture,
} from 'three';
import { fbm, gradientNoise, heightToNormal, rng } from './noise';

export type Ctx2D = CanvasRenderingContext2D;

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): Ctx2D {
  const g = c.getContext('2d');
  if (!g) throw new Error('inkleaf: 2D canvas is not available');
  return g;
}

export function dataTexture(data: Uint8Array, w: number, h: number, opts: { srgb?: boolean; repeat?: boolean } = {}): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  if (opts.srgb) t.colorSpace = SRGBColorSpace;
  if (opts.repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

export function canvasTexture(c: HTMLCanvasElement, opts: { flipY?: boolean; srgb?: boolean } = {}): CanvasTexture {
  const t = new CanvasTexture(c);
  t.flipY = opts.flipY ?? false;
  if (opts.srgb !== false) t.colorSpace = SRGBColorSpace;
  t.generateMipmaps = true;
  t.minFilter = LinearMipmapLinearFilter;
  t.magFilter = LinearFilter;
  t.anisotropy = 8;
  return t;
}

/** Clone of a repeating texture with its own repeat (one tile per `tileMm` on a w x h mm surface with 0..1 UVs). */
export function tiledClone(tex: Texture, wMm: number, hMm: number, tileMm: number): Texture {
  const t = tex.clone();
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(wMm / tileMm, hMm / tileMm);
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------------------------------------ paper normal

export function paperNormalTexture(size = 512): DataTexture {
  const h = new Float32Array(size * size);
  const n8 = gradientNoise(11, 8), n32 = gradientNoise(16, 32);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      h[y * size + x] = 0.5 * fbm(n8, 8 * u, 8 * v, 3) + 0.25 * n32(32 * u, 32 * v);
    }
  }
  const r = rng(24);
  for (let i = 0; i < 3072; i++) {
    let x = r() * size, y = r() * size;
    const a = Math.PI * r();
    const steps = 4 + Math.floor(r() * 15);
    const add = 0.25 + 0.35 * r();
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let s = 0; s < steps; s++) {
      const ix = ((Math.floor(x) % size) + size) % size, iy = ((Math.floor(y) % size) + size) % size;
      h[iy * size + ix]! += add;
      x += dx;
      y += dy;
    }
  }
  return dataTexture(heightToNormal(h, size, size, 2.2, true), size, size, { repeat: true });
}

// ------------------------------------------------------------------------------------------------ paper background

export interface PaperLook {
  color: string;
  /** Alpha gain of the brown mottling and of the light patches (per unit noise, out of 255). */
  mottleDark: number;
  mottleLight: number;
  cellMm: number;
  frequency: number;
  /** Fibre strokes per square millimetre. */
  fibres: number;
  fibreAlpha: number;
  fibreDarkAlpha: number;
  fibreDarkShare: number;
  fibreMin: number;
  fibreRange: number;
  fibreWidth: number;
}

const paperCache = new Map<string, HTMLCanvasElement>();

export function clearPaperCache(): void {
  paperCache.clear();
}

/** Paper background (cached per size and seed): cream fill, soft blotches about 20 mm across, short fibres. */
export function paperBackground(wMm: number, dMm: number, px: number, seed: number, look: PaperLook): HTMLCanvasElement {
  const W = Math.round(wMm * px), H = Math.round(dMm * px);
  const key = `${W}x${H}:${seed}`;
  const hit = paperCache.get(key);
  if (hit) return hit;
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  g.fillStyle = look.color;
  g.fillRect(0, 0, W, H);
  const nx = Math.max(8, Math.round(wMm / look.cellMm)), ny = Math.max(8, Math.round(dMm / look.cellMm));
  const small = makeCanvas(nx, ny);
  const sg = ctx2d(small);
  const img = sg.createImageData(nx, ny);
  const n = gradientNoise(seed + 40);
  for (let q = 0; q < ny; q++) {
    for (let p = 0; p < nx; p++) {
      const b = fbm(n, look.frequency * p, look.frequency * q, 4);
      const o = (q * nx + p) * 4;
      if (b > 0) {
        img.data[o] = 150; img.data[o + 1] = 122; img.data[o + 2] = 84;
        img.data[o + 3] = Math.min(255, look.mottleDark * b);
      } else {
        img.data[o] = 255; img.data[o + 1] = 253; img.data[o + 2] = 246;
        img.data[o + 3] = Math.min(255, -look.mottleLight * b);
      }
    }
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, W, H);
  const r = rng(seed + 7);
  const count = Math.round(wMm * dMm * look.fibres);
  g.lineCap = 'round';
  g.lineWidth = Math.max(0.6, look.fibreWidth * px);
  const light = `rgba(160,135,100,${look.fibreAlpha})`, dark = `rgba(110,95,80,${look.fibreDarkAlpha})`;
  for (let i = 0; i < count; i++) {
    const x = r() * W, y = r() * H, a = Math.PI * r(), len = (look.fibreMin + look.fibreRange * r()) * px;
    g.strokeStyle = r() < look.fibreDarkShare ? dark : light;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  paperCache.set(key, c);
  return c;
}

// ------------------------------------------------------------------------------------------------ cloth weave

/** Plain-weave cloth: RGBA texture with albedo in R and roughness in G, plus a normal map. */
export function weaveTextures(size = 768, threads = 72, seed = 9): { ar: DataTexture; normal: DataTexture } {
  const r = rng(seed);
  const mk = () => {
    const w = new Float64Array(threads), col = new Float64Array(threads), off = new Float64Array(threads), ns = new Float64Array(threads);
    for (let i = 0; i < threads; i++) {
      w[i] = 0.86 + 0.22 * r();
      col[i] = (r() - 0.5) * 0.1;
      off[i] = (r() - 0.5) * 0.18;
      ns[i] = 50 * r();
    }
    return { w, col, off, ns };
  };
  const warp = mk(), weft = mk();
  const n1 = gradientNoise(seed + 1, 8), n2 = gradientNoise(seed + 2, 8), n3 = gradientNoise(seed + 3, 8);
  const thick = (t: { w: Float64Array; ns: Float64Array }, i: number, pos: number) =>
    t.w[i]! * (1 + 0.1 * n1(t.ns[i]!, 8 * pos) + 0.35 * Math.max(0, n2(t.ns[i]!, 8 * pos) - 0.35) * 1.6);
  const warpT = new Float32Array(threads * size), weftT = new Float32Array(threads * size);
  for (let i = 0; i < threads; i++) {
    for (let p = 0; p < size; p++) {
      warpT[i * size + p] = thick(warp, i, p / size);
      weftT[i * size + p] = thick(weft, i, p / size);
    }
  }
  const h = new Float32Array(size * size);
  const ar = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const cy = (py / size) * threads, iy = Math.floor(cy), fy = cy - iy;
    for (let px = 0; px < size; px++) {
      const cx = (px / size) * threads, ix = Math.floor(cx), fx = cx - ix;
      const Iw = (fx - 0.5 - warp.off[ix]!) / (warpT[ix * size + py]! / 2);
      const Iy = (fy - 0.5 - weft.off[iy]!) / (weftT[iy * size + px]! / 2);
      const even = ((ix + iy) & 1) === 0;
      const a = Math.sqrt(Math.max(0, 1 - Iw * Iw)) * (even ? 0.55 + 0.45 * Math.sin(Math.PI * fy) : 0.35 - 0.2 * Math.sin(Math.PI * fy));
      const b = Math.sqrt(Math.max(0, 1 - Iy * Iy)) * (even ? 0.35 - 0.2 * Math.sin(Math.PI * fx) : 0.55 + 0.45 * Math.sin(Math.PI * fx));
      const hh = Math.max(a, b, 0.22);
      const tc = a >= b ? warp.col[ix]! : weft.col[iy]!;
      const alb = 0.5 + 0.11 * (hh - 0.55) + 0.5 * tc + 0.03 * n3((8 * px) / size, (8 * py) / size);
      const rough = 0.8 - 0.1 * (hh - 0.5);
      const o = (py * size + px) * 4;
      h[py * size + px] = hh;
      ar[o] = Math.round(Math.min(1, Math.max(0, alb)) * 255);
      ar[o + 1] = Math.round(Math.min(1, Math.max(0, rough)) * 255);
      ar[o + 2] = 0;
      ar[o + 3] = 255;
    }
  }
  return { ar: dataTexture(ar, size, size, { repeat: true }), normal: dataTexture(heightToNormal(h, size, size, 2.6, true), size, size, { repeat: true }) };
}

// ------------------------------------------------------------------------------------------------ ribbon ribs

export function ribTextures(size = 256, ribs = 20, seed = 4): { albedo: DataTexture; normal: DataTexture } {
  const r = rng(seed);
  const k = new Float64Array(ribs + 1);
  for (let i = 0; i <= ribs; i++) k[i] = 0.85 + 0.2 * r();
  const n16 = gradientNoise(seed + 1, 16);
  const h = new Float32Array(size * size);
  const alb = new Uint8Array(size * size * 4);
  for (let py = 0; py < size; py++) {
    const y = py / size, rf = y * ribs, i = Math.floor(rf), frac = rf - i;
    for (let px = 0; px < size; px++) {
      const x = px / size;
      const u = Math.pow(Math.sin(Math.PI * frac), 0.7) * k[i]!;
      const v = 0.12 * Math.sin(2 * Math.PI * 48 * x + 1.7 * i);
      h[py * size + px] = u + v * u + 0.04 * n16(16 * x, 16 * y);
      const a = Math.round(Math.min(1, Math.max(0, 0.5 + 0.18 * (u - 0.6) + 0.04 * v)) * 255);
      const o = (py * size + px) * 4;
      alb[o] = alb[o + 1] = alb[o + 2] = a;
      alb[o + 3] = 255;
    }
  }
  return { albedo: dataTexture(alb, size, size, { repeat: true }), normal: dataTexture(heightToNormal(h, size, size, 3, true), size, size, { repeat: true }) };
}

// ------------------------------------------------------------------------------------------------ head-band beads

export function beadTextures(navy: readonly number[] = [32, 45, 82], cream: readonly number[] = [238, 228, 204]): { map: DataTexture; normal: DataTexture } {
  const W = 512, H = 64, beads = 16;
  const h = new Float32Array(W * H);
  const map = new Uint8Array(W * H * 4);
  for (let row = 0; row < H; row++) {
    for (let px = 0; px < W; px++) {
      const bx = (px / W) * beads, bi = Math.floor(bx), g = bx - bi;
      const y = (6 * g + (2.5 * row) / H) % 1;
      const bright = 0.82 + 0.18 * Math.sin(Math.PI * g) - 0.1 * Math.abs(y - 0.5);
      const col = bi % 2 === 0 ? navy : cream;
      const o = (row * W + px) * 4;
      map[o] = Math.min(255, col[0]! * bright);
      map[o + 1] = Math.min(255, col[1]! * bright);
      map[o + 2] = Math.min(255, col[2]! * bright);
      map[o + 3] = 255;
      h[row * W + px] = 0.8 * Math.sin(Math.PI * g) + 0.2 * Math.sin(Math.PI * y);
    }
  }
  return { map: dataTexture(map, W, H, { srgb: true, repeat: true }), normal: dataTexture(heightToNormal(h, W, H, 2, true), W, H, { repeat: true }) };
}

// ------------------------------------------------------------------------------------------------ foil and deboss layouts

export interface LayoutLook {
  foilBlur: number;
  debossBlur: number;
  foilHeight: number;
  debossHeight: number;
  normalStrength: number;
}

/**
 * Foil / deboss layout: R = sharp foil mask, G = blurred deboss mask, B = cloth tone, plus a normal map of the
 * stamped relief. `draw` paints white shapes in millimetres on the two black masks.
 */
export function layoutTextures(
  wMm: number, hMm: number, px: number, seed: number, look: LayoutLook,
  draw?: (foil: Ctx2D, deboss: Ctx2D) => void,
): { layout: DataTexture; normal: DataTexture } {
  const W = Math.round(wMm * px), H = Math.round(hMm * px);
  const mask = () => {
    const c = makeCanvas(W, H);
    const g = ctx2d(c);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.setTransform(px, 0, 0, px, 0, 0);
    g.fillStyle = g.strokeStyle = '#fff';
    return { c, g };
  };
  const foil = mask(), deb = mask();
  draw?.(foil.g, deb.g);
  const blurred = (src: HTMLCanvasElement, radius: number) => {
    const c = makeCanvas(W, H);
    const g = ctx2d(c);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    g.filter = `blur(${Math.max(0, radius)}px)`;
    g.drawImage(src, 0, 0);
    return g.getImageData(0, 0, W, H).data;
  };
  const sharpF = foil.g.getImageData(0, 0, W, H).data;
  const blurF = blurred(foil.c, look.foilBlur * px);
  const blurD = blurred(deb.c, look.debossBlur * px);
  // Tone on a 1 mm grid, bilinear up to the texture.
  const n = gradientNoise(seed);
  const gw = Math.ceil(wMm) + 2, gh = Math.ceil(hMm) + 2;
  const tone = new Float32Array(gw * gh);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) tone[y * gw + x] = 0.5 + 0.05 * fbm(n, x / 60, y / 60, 3) + 0.02 * n(x / 9, y / 9);
  const out = new Uint8Array(W * H * 4);
  const height = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const ym = y / px, y0 = Math.floor(ym), fy = ym - y0;
    for (let x = 0; x < W; x++) {
      const xm = x / px, x0 = Math.floor(xm), fx = xm - x0;
      const t00 = tone[y0 * gw + x0]!, t10 = tone[y0 * gw + x0 + 1]!, t01 = tone[(y0 + 1) * gw + x0]!, t11 = tone[(y0 + 1) * gw + x0 + 1]!;
      const t = (t00 + (t10 - t00) * fx) * (1 - fy) + (t01 + (t11 - t01) * fx) * fy;
      const i = y * W + x, o = i * 4;
      out[o] = sharpF[o]!;
      out[o + 1] = blurD[o]!;
      out[o + 2] = Math.round(Math.min(1, Math.max(0, t)) * 255);
      out[o + 3] = 255;
      height[i] = -look.foilHeight * (blurF[o]! / 255) - look.debossHeight * (blurD[o]! / 255);
    }
  }
  const layout = dataTexture(out, W, H);
  const normal = dataTexture(heightToNormal(height, W, H, look.normalStrength * px, false), W, H);
  return { layout, normal };
}

/** Rounded rectangle path in the current transform. */
export function roundRect(g: Ctx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}

// ------------------------------------------------------------------------------------------------ cover plate

export type PlateArt = CanvasImageSource | ((g: Ctx2D, wMm: number, hMm: number) => void);

/** Cover plate paper: mottled cream, specks, a double ink frame, then the art inside the frame. */
export function plateCanvas(wMm: number, hMm: number, px: number, art: PlateArt | null | undefined, ink = '#15161a'): HTMLCanvasElement {
  const W = Math.round(wMm * px), H = Math.round(hMm * px);
  const c = makeCanvas(W, H);
  const g = ctx2d(c);
  g.fillStyle = '#f2e8d2';
  g.fillRect(0, 0, W, H);
  const nx = 64, ny = 72;
  const small = makeCanvas(nx, ny);
  const sg = ctx2d(small);
  const img = sg.createImageData(nx, ny);
  const n = gradientNoise(31);
  for (let q = 0; q < ny; q++) {
    for (let p = 0; p < nx; p++) {
      const v = fbm(n, p * 0.12, q * 0.12, 3);
      const o = (q * nx + p) * 4;
      const pos = v > 0;
      img.data[o] = pos ? 160 : 255; img.data[o + 1] = pos ? 130 : 252; img.data[o + 2] = pos ? 90 : 240;
      img.data[o + 3] = Math.min(255, Math.abs(v) * 40);
    }
  }
  sg.putImageData(img, 0, 0);
  g.imageSmoothingQuality = 'high';
  g.drawImage(small, 0, 0, W, H);
  g.setTransform(px, 0, 0, px, 0, 0);
  const r = rng(77);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(110,90,70,${0.06 + 0.1 * r()})`;
    g.beginPath();
    g.ellipse(r() * wMm, r() * hMm, 0.08 + 0.25 * r(), 0.05 + 0.08 * r(), Math.PI * r(), 0, Math.PI * 2);
    g.fill();
  }
  g.strokeStyle = ink;
  g.lineWidth = 0.32;
  g.strokeRect(4.2, 4.2, wMm - 8.4, hMm - 8.4);
  g.lineWidth = 0.12;
  g.strokeRect(5.2, 5.2, wMm - 10.4, hMm - 10.4);
  const ax = 7, ay = 7, aw = wMm - 14, ah = hMm - 14;
  g.save();
  g.beginPath();
  g.rect(ax, ay, aw, ah);
  g.clip();
  g.translate(ax, ay);
  if (typeof art === 'function') art(g, aw, ah);
  else if (art) g.drawImage(art, 0, 0, aw, ah);
  else defaultPlateArt(g, aw, ah, ink);
  g.restore();
  return c;
}

const lerpHex = (a: number, b: number, t: number) => {
  const ch = (s: number) => Math.round(((a >> s) & 255) + (((b >> s) & 255) - ((a >> s) & 255)) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
};

/** A neutral stand-in drawing (a pendulum swinging over a wash) used when the world supplies no plate art. */
function defaultPlateArt(g: Ctx2D, w: number, h: number, ink: string): void {
  const grad = g.createLinearGradient(0, 0, w, 0);
  for (let i = 0; i <= 8; i++) {
    const x = i / 8;
    const t = Math.min(1, Math.max(0, (x - 0.24) / 0.5));
    grad.addColorStop(x, lerpHex(0x2f7bff, 0xff7a1c, t * t * (3 - 2 * t)));
  }
  g.globalAlpha = 0.35;
  g.fillStyle = grad;
  g.beginPath();
  g.ellipse(w / 2, h * 0.74, w * 0.36, h * 0.08, 0, 0, Math.PI * 2);
  g.fill();
  g.globalAlpha = 1;
  g.strokeStyle = ink;
  g.lineCap = 'round';
  g.lineWidth = 0.35;
  const px = w / 2, py = h * 0.12;
  g.beginPath();
  g.moveTo(w * 0.25, py);
  g.lineTo(w * 0.75, py);
  g.stroke();
  for (const [a, alpha] of [[-0.55, 0.25], [-0.25, 0.45], [0.3, 1]] as const) {
    const L = h * 0.52;
    const bx = px + Math.sin(a) * L, by = py + Math.cos(a) * L;
    g.globalAlpha = alpha;
    g.lineWidth = 0.25;
    g.beginPath();
    g.moveTo(px, py);
    g.lineTo(bx, by);
    g.stroke();
    g.fillStyle = alpha === 1 ? '#f0f0f0' : 'rgba(0,0,0,0)';
    g.lineWidth = 0.35;
    g.beginPath();
    g.arc(bx, by, w * 0.07, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
  g.globalAlpha = 1;
  g.lineWidth = 0.2;
  g.setLineDash([0.8, 0.8]);
  g.beginPath();
  g.arc(px, py, h * 0.52, Math.PI / 2 - 0.65, Math.PI / 2 + 0.65);
  g.stroke();
  g.setLineDash([]);
}
