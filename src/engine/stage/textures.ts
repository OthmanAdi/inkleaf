/**
 * Turns generated texture buffers into three.js DataTextures and runs the generators in a worker when one is
 * available (the oak is 2.8 M texels), falling back to the main thread.
 */
import {
  DataTexture, LinearFilter, LinearMipmapLinearFilter, MirroredRepeatWrapping, RepeatWrapping, RGBAFormat, SRGBColorSpace,
  UnsignedByteType, type Wrapping,
} from 'three';
import { oakTexture, type OakOptions, type TextureBuffers } from './oak';
import { linoTexture, type LinoOptions } from './lino';

export interface MaterialTextures {
  map: DataTexture;
  roughness: DataTexture;
  normal: DataTexture;
}

function dataTexture(data: Uint8ClampedArray, w: number, h: number, wrap: Wrapping, anisotropy: number, srgb: boolean, name: string): DataTexture {
  const t = new DataTexture(data, w, h, RGBAFormat, UnsignedByteType);
  t.wrapS = t.wrapT = wrap;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  t.flipY = false;
  if (srgb) t.colorSpace = SRGBColorSpace;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

export function toTextures(b: TextureBuffers, wrap: Wrapping, anisotropy: number, name: string): MaterialTextures {
  return {
    map: dataTexture(b.map, b.width, b.height, wrap, anisotropy, true, `${name}.map`),
    roughness: dataTexture(b.roughness, b.width, b.height, wrap, anisotropy, false, `${name}.roughness`),
    normal: dataTexture(b.normal, b.width, b.height, wrap, anisotropy, false, `${name}.normal`),
  };
}

export const OAK_WRAP = MirroredRepeatWrapping;
export const LINO_WRAP = RepeatWrapping;

let worker: Worker | null | undefined;
let nextId = 1;
const pending = new Map<number, (b: TextureBuffers) => void>();

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    worker = new Worker(new URL('./textures.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<TextureBuffers & { id: number }>) => {
      const done = pending.get(e.data.id);
      pending.delete(e.data.id);
      done?.(e.data);
    };
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
    };
  } catch {
    worker = null;
  }
  return worker;
}

/** Generates a texture set in the worker (or inline when workers are unavailable). */
export function generate(kind: 'oak', opts: Partial<OakOptions>): Promise<TextureBuffers>;
export function generate(kind: 'lino', opts: Partial<LinoOptions>): Promise<TextureBuffers>;
export function generate(kind: 'oak' | 'lino', opts: Partial<OakOptions> | Partial<LinoOptions>): Promise<TextureBuffers> {
  const inline = () => (kind === 'oak' ? oakTexture(opts as Partial<OakOptions>) : linoTexture(opts as Partial<LinoOptions>));
  const w = typeof Worker !== 'undefined' ? getWorker() : null;
  if (!w) return new Promise((resolve) => setTimeout(() => resolve(inline()), 0));
  return new Promise((resolve) => {
    const id = nextId++;
    let settled = false;
    const finish = (b: TextureBuffers) => {
      if (settled) return;
      settled = true;
      resolve(b);
    };
    pending.set(id, finish);
    try {
      w.postMessage({ id, kind, opts: { ...opts } });
    } catch {
      pending.delete(id);
      finish(inline());
    }
    w.addEventListener('error', () => {
      pending.delete(id);
      finish(inline());
    }, { once: true });
  });
}
