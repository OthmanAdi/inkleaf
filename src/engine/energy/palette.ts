/**
 * Quantity palette. A world supplies the quantities it shows (energy stores, charge, matter, money...), each with a
 * colour and a pattern so colour-blind readers can tell them apart; the eight energy stores are the default.
 * Pathways (how a quantity moves) map onto four motion modes used by streams and ribbons.
 */
import { Color } from 'three';
import type { Registry } from '../core/registry';

export const PATTERNS = ['chevrons', 'bars', 'zigzag', 'waves', 'hex', 'arcs', 'plus', 'rings', 'none'] as const;
export type PatternKind = (typeof PATTERNS)[number];

export interface Quantity {
  id: string;
  /** Short name on cards: "Kinetic". */
  label: string;
  /** Long name in prose: "gravitational potential". */
  longName?: string;
  /** Symbol in equations: "Ek". */
  symbol?: string;
  /** sRGB hex as authored; shaders get the linear value. */
  hex: string;
  pattern?: PatternKind;
  patternNote?: string;
  unit?: string;
}

export const ENERGY_STORES: readonly Quantity[] = [
  { id: 'kinetic', label: 'Kinetic', longName: 'kinetic', symbol: 'Ek', hex: '#2f7bff', pattern: 'chevrons', patternNote: 'forward chevrons', unit: 'J' },
  { id: 'gravitational', label: 'Gravitational', longName: 'gravitational potential', symbol: 'Ep', hex: '#8a4dff', pattern: 'bars', patternNote: 'horizontal bars (stacked levels)', unit: 'J' },
  { id: 'elastic', label: 'Elastic', longName: 'elastic potential', symbol: 'Ee', hex: '#ff3fb4', pattern: 'zigzag', patternNote: 'zigzag', unit: 'J' },
  { id: 'thermal', label: 'Thermal', longName: 'thermal', symbol: 'Eth', hex: '#ff7a1c', pattern: 'waves', patternNote: 'wavy lines', unit: 'J' },
  { id: 'chemical', label: 'Chemical', longName: 'chemical', symbol: 'Ech', hex: '#26c75a', pattern: 'hex', patternNote: 'hexagon cells', unit: 'J' },
  { id: 'magnetic', label: 'Magnetic', longName: 'magnetic', symbol: 'Emag', hex: '#e8233a', pattern: 'arcs', patternNote: 'paired arcs (field lines)', unit: 'J' },
  { id: 'electrostatic', label: 'Electrostatic', longName: 'electrostatic', symbol: 'Ees', hex: '#18c4dc', pattern: 'plus', patternNote: 'plus signs', unit: 'J' },
  { id: 'nuclear', label: 'Nuclear', longName: 'nuclear', symbol: 'En', hex: '#ffcf1a', pattern: 'rings', patternNote: 'dots in rings (atom)', unit: 'J' },
];

/** The four motion modes a pathway can use; the index is the shader mode. */
export const PATHWAY_MODES = ['mechanical', 'electrical', 'heating', 'radiation'] as const;
export type PathwayMode = (typeof PATHWAY_MODES)[number];

export interface Pathway {
  id: string;
  label: string;
  mode: PathwayMode;
}

export const ENERGY_PATHWAYS: readonly Pathway[] = [
  { id: 'mechanical', label: 'Mechanically', mode: 'mechanical' },
  { id: 'electrical', label: 'Electrically', mode: 'electrical' },
  { id: 'heating', label: 'By heating', mode: 'heating' },
  { id: 'radiation', label: 'By radiation', mode: 'radiation' },
];

export const modeIndex = (mode: PathwayMode): number => PATHWAY_MODES.indexOf(mode);

export class Palette {
  private readonly items = new Map<string, Quantity>();
  private readonly colors = new Map<string, Color>();
  private readonly paths = new Map<string, Pathway>();

  constructor(quantities: readonly Quantity[] = ENERGY_STORES, pathways: readonly Pathway[] = ENERGY_PATHWAYS) {
    for (const q of quantities) this.define(q);
    for (const p of pathways) this.paths.set(p.id, { ...p });
  }

  define(q: Quantity): void {
    this.items.set(q.id, { ...q });
    const c = this.colors.get(q.id);
    if (c) c.set(q.hex);
    else this.colors.set(q.id, new Color(q.hex));
  }

  get(id: string): Quantity | undefined {
    return this.items.get(id);
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  ids(): string[] {
    return [...this.items.keys()];
  }

  list(): Quantity[] {
    return [...this.items.values()];
  }

  /** Linear working-space colour (the shared object: it changes when the hex is edited). */
  color(id: string): Color {
    const c = this.colors.get(id);
    if (!c) throw new Error(`inkleaf: unknown quantity "${id}". Known: ${this.ids().join(', ')}`);
    return c;
  }

  setHex(id: string, hex: string): void {
    const q = this.items.get(id);
    if (!q) return;
    q.hex = hex;
    this.colors.get(id)!.set(hex);
  }

  pathway(id: string): Pathway {
    const p = this.paths.get(id);
    if (p) return p;
    if ((PATHWAY_MODES as readonly string[]).includes(id)) return { id, label: id, mode: id as PathwayMode };
    throw new Error(`inkleaf: unknown pathway "${id}". Known: ${[...this.paths.keys()].join(', ')}`);
  }

  pathways(): Pathway[] {
    return [...this.paths.values()];
  }

  /**
   * Registers `energy.palette` and one `energy.palette.<id>` entry per quantity with its colour, label and
   * pattern, so `inkleaf.set('energy.palette.kinetic', 'color', '#3388ff')` recolours every jar and stream.
   */
  register(registry: Registry, prefix = 'energy.palette'): void {
    if (!registry.has(prefix)) {
      registry.add({
        id: prefix, label: 'Quantity colours and patterns', kind: 'palette', tags: ['data', 'energy', 'material'],
        describe: 'The quantities this world shows (by default the eight energy stores), each with a colour and a pattern swatch.',
        source: 'src/engine/energy/palette.ts',
      });
    }
    for (const q of this.items.values()) {
      const id = `${prefix}.${q.id}`;
      if (registry.has(id)) continue;
      registry.add({
        id, label: q.label, kind: 'quantity', tags: ['data', 'energy', 'store', 'material'], parent: prefix,
        describe: `${q.label}${q.longName && q.longName !== q.label.toLowerCase() ? ` (${q.longName})` : ''}: colour ${q.hex}, pattern ${q.pattern ?? 'none'}${q.patternNote ? ` (${q.patternNote})` : ''}.`,
        source: 'src/engine/energy/palette.ts',
        params: [
          { key: 'color', label: 'Colour', type: 'color', help: 'sRGB hex; jars, streams and lights follow live', get: () => q.hex, set: (v) => this.setHex(q.id, String(v)) },
          { key: 'label', label: 'Label', type: 'string', help: 'Name on the card', get: () => q.label, set: (v) => void (q.label = String(v)) },
          { key: 'pattern', label: 'Pattern', type: 'enum', options: PATTERNS, help: 'Swatch pattern on cards and keys', get: () => q.pattern ?? 'none', set: (v) => void (q.pattern = v as PatternKind) },
          { key: 'symbol', label: 'Symbol', type: 'string', help: 'Equation symbol', get: () => q.symbol ?? '', set: (v) => void (q.symbol = String(v)) },
        ],
      });
    }
  }
}

let shared: Palette | null = null;

/** The default palette (the eight energy stores, four pathways), created on first use. */
export function defaultPalette(): Palette {
  return (shared ??= new Palette());
}

/** Replaces the default palette, for a world that brings its own quantities. */
export function setDefaultPalette(p: Palette): void {
  shared = p;
}

/**
 * Paints a quantity's pattern swatch into a 2D canvas rectangle (stroked in `stroke`, clipped to the rect).
 * Line width max(1, w/16), round caps and joins.
 */
export function drawPattern(ctx: CanvasRenderingContext2D, pattern: PatternKind | undefined, x: number, y: number, w: number, h: number, stroke = '#1c2433'): void {
  if (!pattern || pattern === 'none') return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = Math.max(1, w / 16);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const g = w / 4;
  const line = (pts: readonly (readonly [number, number])[]) => {
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.stroke();
  };
  switch (pattern) {
    case 'chevrons':
      for (let a = -1; a <= 3; a++) line([[x + a * g, y + 0.15 * h], [x + a * g + 0.8 * g, y + h / 2], [x + a * g, y + 0.85 * h]]);
      break;
    case 'bars':
      for (let a = 0; a < 4; a++) line([[x + 0.1 * w, y + ((a + 0.5) * h) / 4], [x + 0.9 * w, y + ((a + 0.5) * h) / 4]]);
      break;
    case 'zigzag': {
      const pts: [number, number][] = [];
      for (let a = 0; a <= 8; a++) pts.push([x + (w * a) / 8, y + h * (a % 2 ? 0.25 : 0.75)]);
      line(pts);
      break;
    }
    case 'waves':
      for (let a = 0; a <= 2; a++) {
        const pts: [number, number][] = [];
        for (let o = 0; o <= 20; o++) pts.push([x + (w * o) / 20, y + h * (0.22 + 0.28 * a) + 0.08 * h * Math.sin((4 * Math.PI * o) / 20)]);
        line(pts);
      }
      break;
    case 'hex': {
      const c = w / 5;
      for (let o = 0; o < 3; o++)
        for (let l = 0; l < 3; l++) {
          const cx = x + c + 1.75 * c * l + 0.87 * c * (o % 2);
          const cy = y + 0.9 * c + 1.5 * c * o;
          const pts: [number, number][] = [];
          for (let m = 0; m <= 6; m++) {
            const t = Math.PI / 6 + (m * Math.PI) / 3;
            pts.push([cx + 0.85 * c * Math.cos(t), cy + 0.85 * c * Math.sin(t)]);
          }
          line(pts);
        }
      break;
    }
    case 'arcs':
      for (let a = 1; a <= 3; a++) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, 0.14 * a * w, 0.12 * a * h, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    case 'plus':
      for (let o = 0; o < 2; o++)
        for (let a = 0; a < 2; a++) {
          const cx = x + w * (0.28 + 0.44 * o);
          const cy = y + h * (0.28 + 0.44 * a);
          const r = 0.13 * w;
          line([[cx - r, cy], [cx + r, cy]]);
          line([[cx, cy - r], [cx, cy + r]]);
        }
      break;
    case 'rings':
      ctx.beginPath();
      ctx.arc(x + w / 2, y + h / 2, 0.1 * w, 0, Math.PI * 2);
      ctx.fill();
      for (const rot of [0, 1.05, -1.05]) {
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, 0.38 * w, 0.14 * h, rot, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
  }
  ctx.restore();
}
