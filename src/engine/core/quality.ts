/**
 * Quality tiers (high, medium, low) and the automatic step-down: while a lesson figure is live and nothing else is
 * moving, frame times are sampled; after 90 samples the trimmed mean (drop the 5 fastest and 5 slowest) decides.
 * Above 24 ms the tier steps down one level and sampling restarts; otherwise the tier locks for the session.
 * A tier forced by `?q=` / `?tier=` or set from code is locked from the start.
 */
import type { Quality, QualityTier, Unsubscribe } from '../contracts';
import type { Registry } from './registry';
import { tunable } from './tune';

export const TIER_NAMES: readonly QualityTier[] = ['high', 'medium', 'low'];

export interface TierSettings {
  /** Device-pixel-ratio cap (min with window.devicePixelRatio). */
  pixelRatioCap: number;
  /** Ambient occlusion pass on. */
  ao: boolean;
  /** Bloom resolution scale (no visible effect with the mipmap blur; kept for parity). */
  bloomScale: number;
  /** Key light shadow map size. */
  shadowMapSize: number;
  /** Hatch line breaks in ink paper (1 on, 0 off). */
  hatchQ: number;
  /** Ink lines thinner than this base width are hidden. */
  minWidth: number;
  /** Multiplier on energy stream bead counts. */
  beadDensity: number;
}

export const TIER_DEFAULTS: Readonly<Record<QualityTier, Readonly<TierSettings>>> = {
  high: { pixelRatioCap: 1.5, ao: true, bloomScale: 0.5, shadowMapSize: 2048, hatchQ: 1, minWidth: 0, beadDensity: 1 },
  medium: { pixelRatioCap: 1.25, ao: false, bloomScale: 0.35, shadowMapSize: 2048, hatchQ: 1, minWidth: 0, beadDensity: 1 },
  low: { pixelRatioCap: 1, ao: false, bloomScale: 0.25, shadowMapSize: 1024, hatchQ: 0, minWidth: 0.62, beadDensity: 0.5 },
};

export const isTier = (v: unknown): v is QualityTier => v === 'high' || v === 'medium' || v === 'low';

/** Reads a forced tier from a query string: `?q=low` or `?tier=low`. */
export function tierFromSearch(search: string): QualityTier | null {
  const p = new URLSearchParams(search);
  const v = p.get('q') ?? p.get('tier');
  return isTier(v) ? v : null;
}

/** Fixed-size sample window whose mean ignores the `trim` lowest and `trim` highest values. */
export class TrimmedMean {
  private readonly buf: number[] = [];
  private readonly sorted: number[] = [];

  constructor(public size = 90, public trim = 5) {}

  get length(): number {
    return this.buf.length;
  }

  get full(): boolean {
    return this.buf.length >= this.size;
  }

  push(v: number): void {
    if (this.buf.length < this.size) this.buf.push(v);
  }

  mean(): number {
    const s = this.sorted;
    s.length = 0;
    for (const v of this.buf) s.push(v);
    s.sort((a, b) => a - b);
    const lo = Math.min(this.trim, Math.floor(s.length / 2));
    const hi = s.length - lo;
    let sum = 0;
    for (let i = lo; i < hi; i++) sum += s[i]!;
    return hi > lo ? sum / (hi - lo) : 0;
  }

  clear(): void {
    this.buf.length = 0;
  }
}

export interface QualityController extends Quality {
  readonly locked: boolean;
  readonly settings: Readonly<TierSettings>;
  settingsFor(tier: QualityTier): Readonly<TierSettings>;
  /** Runs now and on every tier change (and when the current tier's settings are edited). */
  onApply(fn: (tier: QualityTier, settings: Readonly<TierSettings>) => void): Unsubscribe;
  /** Samples collected in the current window. */
  readonly sampleCount: number;
  /** Stops sampling without changing the tier. */
  lock(): void;
}

export interface QualityOptions {
  tier?: QualityTier;
  /** A forced tier is locked: no automatic step-down. */
  locked?: boolean;
}

export function createQuality(registry: Registry | null, opts: QualityOptions = {}): QualityController {
  const tiers: Record<QualityTier, TierSettings> = {
    high: { ...TIER_DEFAULTS.high }, medium: { ...TIER_DEFAULTS.medium }, low: { ...TIER_DEFAULTS.low },
  };
  const auto = { thresholdMs: 24, samples: 90, trim: 5 };
  let tier: QualityTier = opts.tier ?? 'high';
  let locked = opts.locked ?? false;
  const sampler = new TrimmedMean(auto.samples, auto.trim);
  const listeners = new Set<(t: QualityTier, s: Readonly<TierSettings>) => void>();
  const apply = () => {
    if (cfg) cfg.tier = tier;
    for (const fn of listeners) fn(tier, tiers[tier]);
  };

  let cfg: { tier: string; thresholdMs: number; samples: number; trim: number } | null = null;
  if (registry) {
    cfg = tunable(registry, {
      id: 'quality.tier', label: 'Quality tiers', kind: 'quality', tags: ['quality', 'data', 'effect'],
      describe: 'Current tier and the automatic step-down: 90 live frame times, trimmed mean; above the threshold the tier drops one level, otherwise it locks.',
      source: 'src/engine/core/quality.ts',
      params: {
        tier: { value: tier, options: TIER_NAMES, help: 'Current tier; setting it locks the tier' },
        thresholdMs: { value: 24, min: 4, max: 100, step: 0.5, unit: 'ms', help: 'Trimmed-mean frame time that triggers a step down' },
        samples: { value: 90, min: 10, max: 600, step: 1, unit: 'frames', help: 'Frame times per decision window' },
        trim: { value: 5, min: 0, max: 100, step: 1, unit: 'frames', help: 'Fastest and slowest samples dropped from each end' },
      },
      onChange: (k) => {
        if (k === 'tier' && cfg && isTier(cfg.tier) && cfg.tier !== tier) ctrl.set(cfg.tier);
        if (cfg) {
          auto.thresholdMs = cfg.thresholdMs;
          sampler.size = auto.samples = cfg.samples;
          sampler.trim = auto.trim = cfg.trim;
        }
      },
    });
    for (const t of TIER_NAMES) {
      const s = tiers[t];
      tunable(registry, {
        id: `quality.${t}`, label: `Quality tier: ${t}`, kind: 'quality-tier', tags: ['quality', 'data'], parent: 'quality.tier',
        describe: `Settings applied when the ${t} tier is active.`,
        source: 'src/engine/core/quality.ts',
        params: {
          pixelRatioCap: { value: s.pixelRatioCap, min: 0.5, max: 3, step: 0.05, help: 'Device pixel ratio cap' },
          ao: { value: s.ao, help: 'Ambient occlusion pass' },
          bloomScale: { value: s.bloomScale, min: 0.1, max: 1, step: 0.05, help: 'Bloom resolution scale (no visible effect with the mipmap blur)' },
          shadowMapSize: { value: s.shadowMapSize, min: 256, max: 4096, step: 256, unit: 'px', help: 'Key light shadow map size' },
          hatchQ: { value: s.hatchQ, min: 0, max: 1, step: 1, help: 'Hatch line breaks (1 on, 0 off)' },
          minWidth: { value: s.minWidth, min: 0, max: 3, step: 0.01, help: 'Thin ink lines below this base width are hidden' },
          beadDensity: { value: s.beadDensity, min: 0, max: 1, step: 0.05, help: 'Energy stream bead count multiplier' },
        },
        onChange: (k) => {
          const v = registry.getParam(`quality.${t}`, k);
          (s as unknown as Record<string, unknown>)[k] = v;
          if (t === tier) apply();
        },
      });
    }
  }

  const ctrl: QualityController = {
    get tier() {
      return tier;
    },
    get locked() {
      return locked;
    },
    get settings() {
      return tiers[tier];
    },
    get sampleCount() {
      return sampler.length;
    },
    settingsFor: (t) => tiers[t],
    set(t: QualityTier) {
      locked = true;
      sampler.clear();
      if (t === tier) {
        if (cfg) cfg.tier = tier;
        return;
      }
      tier = t;
      apply();
    },
    sample(ms: number) {
      if (locked) return;
      sampler.push(ms);
      if (!sampler.full) return;
      const mean = sampler.mean();
      sampler.clear();
      if (mean > auto.thresholdMs && tier !== 'low') {
        tier = TIER_NAMES[TIER_NAMES.indexOf(tier) + 1]!;
        apply();
      } else {
        locked = true;
      }
    },
    onApply(fn) {
      listeners.add(fn);
      fn(tier, tiers[tier]);
      return () => {
        listeners.delete(fn);
      };
    },
    lock() {
      locked = true;
    },
  };
  if (cfg) {
    auto.thresholdMs = cfg.thresholdMs;
    sampler.size = auto.samples = cfg.samples;
    sampler.trim = auto.trim = cfg.trim;
    if (isTier(cfg.tier) && cfg.tier !== tier) ctrl.set(cfg.tier);
  }
  return ctrl;
}
