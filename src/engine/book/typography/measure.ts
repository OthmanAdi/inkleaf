/**
 * Text measurement in page millimetres. The canvas measurer measures at 100 px and scales, so tiny sizes are not
 * rounded; a cheap approximate measurer lets layout tests run without a canvas.
 */
import type { FontSpec } from './types';

export interface FontFamilies { serif: string; hand: string }

export const DEFAULT_FAMILIES: FontFamilies = {
  serif: '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif',
  hand: '"Caveat Variable", "Caveat", cursive',
};

/** Small caps tracking as a fraction of the font size. */
export const CAPS_TRACKING = 0.06;

export function fontCss(f: FontSpec, fam: FontFamilies, size = f.size): string {
  return `${f.italic ? 'italic ' : ''}${f.weight ?? 400} ${size}px ${f.family === 'hand' ? fam.hand : fam.serif}`;
}

export interface Measurer {
  width(text: string, f: FontSpec): number;
  /** Changes when font metrics change (late font swap), so cached layouts recompute. */
  readonly key: string;
}

export class CanvasMeasurer implements Measurer {
  private g: CanvasRenderingContext2D;
  private cache = new Map<string, number>();
  private fp = '';
  constructor(public families: FontFamilies = DEFAULT_FAMILIES) {
    const c = document.createElement('canvas');
    c.width = c.height = 4;
    const g = c.getContext('2d');
    if (!g) throw new Error('inkleaf: 2D canvas is not available');
    this.g = g;
    this.refresh();
  }

  get key(): string {
    return this.fp;
  }

  /** Re-measures the fingerprint; clears the cache when metrics changed. Returns true if they changed. */
  refresh(): boolean {
    this.cache.clear();
    const probe = 'Hamburgefonstiv 0123';
    const fp = [
      this.width(probe, { size: 10 }),
      this.width(probe, { size: 10, italic: true }),
      this.width(probe, { size: 10, weight: 600 }),
      this.width(probe, { size: 10, family: 'hand', weight: 560 }),
    ].map((w) => w.toFixed(3)).join('|');
    const changed = fp !== this.fp;
    this.fp = fp;
    this.cache.clear();
    return changed;
  }

  width(text: string, f: FontSpec): number {
    const css = fontCss(f, this.families, 100);
    const k = `${css}|${f.caps ? 1 : 0}|${text}`;
    const hit = this.cache.get(k);
    if (hit !== undefined) return (hit * f.size) / 100;
    if (this.cache.size > 20000) this.cache.clear();
    const g = this.g;
    g.font = css;
    g.fontKerning = 'normal';
    g.fontVariantCaps = f.caps ? 'all-small-caps' : 'normal';
    g.letterSpacing = f.caps ? `${CAPS_TRACKING * 100}px` : '0px';
    const w = g.measureText(text).width;
    this.cache.set(k, w);
    return (w * f.size) / 100;
  }
}

/** Width estimate for tests and headless use: half an em per character, wider for bold, tracked for caps. */
export class ApproxMeasurer implements Measurer {
  readonly key = 'approx';
  width(text: string, f: FontSpec): number {
    const n = [...text].length;
    const em = f.family === 'hand' ? 0.4 : 0.5;
    const bold = 1 + Math.max(0, (f.weight ?? 400) - 400) / 1000;
    return n * f.size * (f.caps ? 0.42 + CAPS_TRACKING : em * bold);
  }
}
