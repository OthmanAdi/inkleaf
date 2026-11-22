# Procedural textures: canvas pages, wood, linoleum, paper fibre, normal and roughness maps

No image files are needed for the inkleaf look. Everything here is generated at start, cached, and
uploaded before the first frame. Verified against three r187.

## 1. Rules that prevent most texture bugs

| Map | `colorSpace` | Channel three reads | Filters |
|---|---|---|---|
| `map`, `emissiveMap`, page canvas, cookie art | `SRGBColorSpace` | rgb (a for alpha) | mipmaps on |
| `normalMap` | `NoColorSpace` | xyz | mipmaps on |
| `bumpMap` (height) | `NoColorSpace` | x | mipmaps on |
| `roughnessMap` | `NoColorSpace` | **g** | mipmaps on |
| `metalnessMap` | `NoColorSpace` | **b** | mipmaps on |
| `aoMap` | `NoColorSpace` | **r** (affects indirect light only) | mipmaps on |
| data for shaders (flow, masks, ids) | `NoColorSpace` | your choice | often `NearestFilter` |

Channel facts come from `roughnessmap_fragment` (`.g`), `metalnessmap_fragment` (`.b`),
`aomap_fragment` (`.r`), `bumpmap_pars_fragment` (`.x`). Pack them as one ORM texture
(R = AO, G = roughness, B = metalness) and pass the same texture to all three slots. A single
channel `RedFormat` texture used as a roughness map reads 0 from `.g`: wrong.

Defaults differ by class:
- `Texture`/`CanvasTexture`: `LinearMipmapLinearFilter`, `generateMipmaps = true`, `flipY = true`,
  `colorSpace = NoColorSpace`, `anisotropy = 1`.
- `DataTexture`: `NearestFilter` for both filters, `generateMipmaps = false`, `flipY = false`,
  `unpackAlignment = 1`. Change all of these for surface maps.

WebGL2 handles non-power-of-two sizes with mipmaps and repeat wrapping, so pick sizes by detail
need. Memory per RGBA8 texture with mipmaps: `w * h * 4 * 1.33` bytes (2048 square: about 22 MB).

Anisotropy: pages are seen at grazing angles; set
`tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy())` on page and desk maps.

## 2. Deterministic noise toolkit (no dependencies)

```ts
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Periodic value noise: tiles seamlessly with period `p` (integer lattice cells). */
export function makeValueNoise(seed: number, p: number) {
  const rnd = mulberry32(seed), lat = new Float32Array(p * p);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (x: number, y: number) => lat[((y % p + p) % p) * p + ((x % p + p) % p)]!;
  const fade = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number): number => {
    const xi = Math.floor(x), yi = Math.floor(y), fx = fade(x - xi), fy = fade(y - yi);
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;   // 0..1
  };
}

export function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 5): number {
  let s = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < oct; o++) { s += amp * n(x * f, y * f); norm += amp; amp *= 0.5; f *= 2; }
  return s / norm;                                                         // 0..1
}
```

Periodic noise is what makes desk wood and linoleum tile without seams: sample at
`x = u * p` for `u` in `[0, 1)` and every octave stays periodic because frequencies double on an
integer lattice. three also ships `ImprovedNoise` (`noise(x, y, z)`) and `SimplexNoise`
(`noise`, `noise3d`, `noise4d`; constructor takes an object with `random()` for seeding) under
`three/addons/math/`; neither is periodic.

## 3. Building a DataTexture correctly

```ts
import {
  DataTexture, RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter,
  SRGBColorSpace, NoColorSpace, type ColorSpace, type WebGLRenderer,
} from 'three';

export function surfaceTexture(data: Uint8Array, w: number, h: number, colorSpace: ColorSpace,
  renderer: WebGLRenderer): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = colorSpace;               // SRGBColorSpace for colour, NoColorSpace for data
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  renderer.initTexture(t);                 // upload now, not on the first visible frame
  return t;
}
```

Write colour data in sRGB bytes (what a designer would pick) and tag `SRGBColorSpace`; three
decodes to linear on sampling. Write data maps as plain linear bytes.

## 4. Wood grain for the desk (colour, roughness, height)

Rings are distance to a log axis, warped by noise; pores are fine stretched noise.

```ts
export function woodMaps(w = 1024, h = 1024, seed = 7) {
  const n = makeValueNoise(seed, 64), pores = makeValueNoise(seed + 1, 256);
  const color = new Uint8Array(w * h * 4), orm = new Uint8Array(w * h * 4), height = new Float32Array(w * h);
  const light = [196, 146, 98], dark = [122, 78, 46];          // sRGB bytes
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x / w, v = y / h;
    const warp = fbm(n, u * 4, v * 16, 4) * 1.6;              // grain runs along v
    const r = (u * 12 + warp) % 1;                             // ring phase 0..1, periodic in u
    const ring = Math.pow(Math.abs(Math.sin(r * Math.PI)), 6); // thin dark late-wood bands
    const pore = Math.pow(pores(u * 256, v * 24), 3);           // stretched along the grain
    const k = Math.min(1, ring * 0.75 + pore * 0.35);
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) color[i + c] = Math.round(light[c]! + (dark[c]! - light[c]!) * k);
    color[i + 3] = 255;
    orm[i] = 255;                                              // AO: none baked
    orm[i + 1] = Math.round(255 * (0.45 + 0.35 * k));          // pores and late wood are rougher
    orm[i + 2] = 0;                                            // dielectric
    orm[i + 3] = 255;
    height[y * w + x] = 1 - (ring * 0.4 + pore * 0.6);         // pores sit lower
  }
  return { color, orm, height, w, h };
}
```

Use: `map` (sRGB), `roughnessMap` = ORM (no colour space), `normalMap` from `height` (section 7),
`roughness: 1, metalness: 0`, then `clearcoat: 0.3` on `MeshPhysicalMaterial` for varnish.
`u * 12` and the periodic noise keep the texture seamless when `repeat` is above 1.

## 5. Linoleum desk mat (mottled, matte, speckled)

```ts
export function linoleum(w = 512, h = 512, seed = 3, base: [number, number, number] = [78, 96, 84]) {
  const n = makeValueNoise(seed, 32), rnd = mulberry32(seed + 9);
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const m = fbm(n, (x / w) * 6, (y / h) * 6, 5) - 0.5;      // soft marbling
    const speck = rnd() > 0.996 ? (rnd() - 0.5) * 90 : 0;    // sparse light and dark chips
    const i = (y * w + x) * 4;
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, base[c]! * (1 + m * 0.35) + speck));
    out[i + 3] = 255;
  }
  return out;
}
```

Roughness for linoleum is near constant (0.7 to 0.85); skip a roughness map and set the scalar.

## 6. Paper fibre (height for `bumpMap`, slight albedo variation)

Paper needs three scales: cloudy formation (centimetres), fibres (millimetres), tooth (pixels).

```ts
export function paperFibre(size = 1024, seed = 11): Float32Array {
  const h = new Float32Array(size * size);
  const cloud = makeValueNoise(seed, 16), tooth = makeValueNoise(seed + 2, 512), rnd = mulberry32(seed + 5);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size, v = y / size;
    h[y * size + x] = 0.55 * fbm(cloud, u * 16, v * 16, 4) + 0.25 * tooth(u * 512, v * 512);
  }
  for (let f = 0; f < size * 6; f++) {                      // short curved fibres, wrapped at edges
    let px = rnd() * size, py = rnd() * size, ang = rnd() * Math.PI * 2;
    const len = 6 + rnd() * 24, lift = 0.08 + rnd() * 0.12;
    for (let s = 0; s < len; s++) {
      ang += (rnd() - 0.5) * 0.3; px += Math.cos(ang); py += Math.sin(ang);
      const ix = ((Math.round(px) % size) + size) % size, iy = ((Math.round(py) % size) + size) % size;
      h[iy * size + ix] = Math.min(1, h[iy * size + ix]! + lift);
    }
  }
  return h;
}
```

Use it as `bumpMap` (pack the float into RGBA bytes, `NoColorSpace`) with `bumpScale` 0.3 to 1.0,
and multiply 3 to 5 percent of it into the page colour for formation shading. Keep the fibre texture
separate from the text canvas so text can update without regenerating fibres; use `repeat` to tile
fibres at about 2 tiles per page.

## 7. Normal map from height (Sobel, wraps for tiling)

```ts
export function heightToNormal(hgt: Float32Array, w: number, h: number, strength = 2.0): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  const at = (x: number, y: number) => hgt[((y + h) % h) * w + ((x + w) % w)]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
    const dy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
    let nx = -dx * strength, ny = dy * strength, nz = 1;      // +Y up in texture space (OpenGL style)
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    const i = (y * w + x) * 4;
    out[i] = Math.round((nx * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((ny * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round((nz * 0.5 + 0.5) * 255);
    out[i + 3] = 255;
  }
  return out;
}
```

Image rows run top to bottom while `DataTexture.flipY` is false, so row 0 sits at `v = 0`
(bottom). The `dy` sign above assumes that layout; if bumps look inverted under a raking light, flip
`ny` or use `material.normalScale.set(1, -1)`. Tag `NoColorSpace`. Normal maps need UVs and use
generated tangents per fragment when no `tangent` attribute exists.

## 8. Canvas textures with fonts (page art, labels, terms)

```ts
import { CanvasTexture, SRGBColorSpace, type WebGLRenderer } from 'three';

export async function makePageCanvas(renderer: WebGLRenderer, wPx = 2048, hPx = 2730) {
  await Promise.all([
    document.fonts.load('400 48px "Source Serif 4 Variable"'),
    document.fonts.load('600 64px "Caveat Variable"'),
  ]);
  await document.fonts.ready;                       // drawing before this falls back silently
  const canvas = document.createElement('canvas');
  canvas.width = wPx; canvas.height = hPx;          // texels, not CSS pixels: DPR does not apply
  const g = canvas.getContext('2d');
  if (!g) throw new Error('2d context unavailable');
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return { canvas, g, tex, redraw: () => { tex.needsUpdate = true; } };
}

export function drawHeading(g: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number) {
  g.fillStyle = '#1d1b22';
  g.font = '600 96px "Caveat Variable"';
  g.textBaseline = 'alphabetic';
  const words = text.split(' ');
  let line = '', yy = y;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (g.measureText(test).width > maxW && line) { g.fillText(line, x, yy); line = w; yy += 104; }
    else line = test;
  }
  if (line) g.fillText(line, x, yy);
}
```

Sizing: a page that covers about 900 CSS px on a 2x screen shows about 1800 device pixels across,
so 2048 texels wide is right for normal viewing. The magnifier at 2.5x needs 4500 texels for the
same sharpness: instead of a huge page texture, render the zoomed region of the page canvas into a
small separate canvas texture for the lens, or accept softness inside the lens.

Keep the family names exactly as the font CSS declares them (`"Caveat Variable"`,
`"Source Serif 4 Variable"` for the fontsource variable packages). Re-upload after every redraw
with `needsUpdate = true`; each upload regenerates mipmaps for the full canvas, so batch drawing
into one redraw per frame. For partial updates of large data textures, `texture.addUpdateRange(start,
count)` works for `DataTexture` (the WebGL path reads `image.data`), not for canvas sources.

Canvas UV mapping with the default `flipY = true`: canvas pixel `(u * W, (1 - v) * H)` matches
texture coordinate `(u, v)`. Hit-testing on the canvas uses the same formula (see
`interaction-picking.md`).

## 9. Generating without jank

Generation loops above take 50 to 300 ms on a phone. Options:
- Run them in a `Worker`, return `ArrayBuffer`s as transferables, build the `DataTexture` on the
  main thread.
- Use `OffscreenCanvas` in the worker for canvas-based art; transfer an `ImageBitmap` and make a
  `CanvasTexture`-like texture from it (`new Texture(bitmap)` with `flipY` handled: image bitmaps
  ignore `UNPACK_FLIP_Y`, so create them with `imageOrientation: 'flipY'` or set `flipY = false` and
  flip your UVs).
- Cache results in `IndexedDB` keyed by seed and size for repeat visits.

## Do

- Tag every texture's colour space on creation.
- Pack ORM; use periodic noise for anything that tiles.
- Wait for fonts before drawing text into canvases.
- `renderer.initTexture` during loading.

## Don't

- Don't rely on `DataTexture` defaults for surfaces (nearest filtering, no mipmaps).
- Don't scale canvas size by `devicePixelRatio`; size by expected screen coverage.
- Don't regenerate textures on resize.

## Pitfalls

- Text renders in a fallback font only on first load: drawn before `document.fonts.load` resolved.
- Desk looks plastic: roughness written to the red channel.
- Visible seams on tiled wood: non-periodic noise or a ring frequency that is not an integer.
- Paper looks too clean under bloom-free light: bump scale too low or fibre texture tiled too large.

## Self-check (APIs used, verified in three r187 source)

- `DataTexture(data, width, height, format, type, ...)` defaults (`NearestFilter`, `generateMipmaps = false`, `flipY = false`, `unpackAlignment = 1`): `src/textures/DataTexture.js`
- `Texture` defaults (`LinearMipmapLinearFilter`, `generateMipmaps`, `flipY`, `colorSpace`, `anisotropy`, `wrapS/T`, `repeat`), `addUpdateRange`: `src/textures/Texture.js`
- `CanvasTexture(canvas, ...)` sets `needsUpdate`: `src/textures/CanvasTexture.js`
- channel use: `src/renderers/shaders/ShaderChunk/roughnessmap_fragment.glsl.js`, `metalnessmap_fragment.glsl.js`, `aomap_fragment.glsl.js`, `bumpmap_pars_fragment.glsl.js`, `normal_fragment_maps.glsl.js`
- partial updates via `updateRanges` for data textures: `src/renderers/webgl/WebGLTextures.js` (`updateTexture`)
- `renderer.capabilities.getMaxAnisotropy`, `renderer.initTexture`: `src/renderers/webgl/WebGLCapabilities.js`, `src/renderers/WebGLRenderer.js`
- constants `RGBAFormat, UnsignedByteType, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter, NearestFilter, RedFormat, SRGBColorSpace, NoColorSpace`: `src/constants.js`
- `ImprovedNoise.noise`, `SimplexNoise(r)` with `noise`, `noise3d`, `noise4d`: `examples/jsm/math/ImprovedNoise.js`, `SimplexNoise.js`
- font family names: `@fontsource-variable/caveat/index.css`, `@fontsource-variable/source-serif-4/index.css` in the product's dependencies
