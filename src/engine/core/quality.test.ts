import { describe, expect, it } from 'vitest';
import type { QualityTier } from '../contracts';
import { Registry } from './registry';
import { TIER_DEFAULTS, TrimmedMean, createQuality, tierFromSearch } from './quality';

describe('TrimmedMean', () => {
  it('drops the 5 lowest and 5 highest of 90 and averages the middle 80', () => {
    const t = new TrimmedMean(90, 5);
    for (let i = 0; i < 5; i++) t.push(1000);
    for (let i = 0; i < 5; i++) t.push(0);
    for (let i = 0; i < 80; i++) t.push(20 + (i % 2));
    expect(t.full).toBe(true);
    expect(t.mean()).toBeCloseTo(20.5, 10);
  });

  it('ignores pushes once full', () => {
    const t = new TrimmedMean(3, 0);
    [1, 2, 3, 100].forEach((v) => t.push(v));
    expect(t.mean()).toBe(2);
  });
});

describe('quality tiers', () => {
  const feed = (q: { sample(ms: number): void }, ms: number, n = 90) => {
    for (let i = 0; i < n; i++) q.sample(ms);
  };

  it('has the measured caps and per-tier switches', () => {
    expect([TIER_DEFAULTS.high.pixelRatioCap, TIER_DEFAULTS.medium.pixelRatioCap, TIER_DEFAULTS.low.pixelRatioCap]).toEqual([1.5, 1.25, 1]);
    expect([TIER_DEFAULTS.high.ao, TIER_DEFAULTS.medium.ao, TIER_DEFAULTS.low.ao]).toEqual([true, false, false]);
    expect(TIER_DEFAULTS.low.shadowMapSize).toBe(1024);
    expect(TIER_DEFAULTS.low.minWidth).toBe(0.62);
    expect(TIER_DEFAULTS.low.beadDensity).toBe(0.5);
    expect(TIER_DEFAULTS.low.hatchQ).toBe(0);
  });

  it('steps down one tier per slow window, then locks at low', () => {
    const q = createQuality(new Registry());
    const seen: QualityTier[] = [];
    q.onApply((t) => seen.push(t));
    feed(q, 30, 89);
    expect(q.tier).toBe('high');
    q.sample(30);
    expect(q.tier).toBe('medium');
    expect(q.locked).toBe(false);
    expect(q.sampleCount).toBe(0);
    feed(q, 30);
    expect(q.tier).toBe('low');
    feed(q, 30);
    expect(q.tier).toBe('low');
    expect(q.locked).toBe(true);
    expect(seen).toEqual(['high', 'medium', 'low']);
  });

  it('locks when the trimmed mean is at or under 24 ms', () => {
    const q = createQuality(null);
    feed(q, 24);
    expect(q.tier).toBe('high');
    expect(q.locked).toBe(true);
    feed(q, 100);
    expect(q.tier).toBe('high');
  });

  it('is not fooled by a few spikes', () => {
    const q = createQuality(null);
    for (let i = 0; i < 85; i++) q.sample(16);
    for (let i = 0; i < 5; i++) q.sample(50);
    expect(q.tier).toBe('high');
    expect(q.locked).toBe(true);
  });

  it('set() from code locks', () => {
    const q = createQuality(null);
    q.set('medium');
    expect(q.tier).toBe('medium');
    feed(q, 50);
    expect(q.tier).toBe('medium');
  });

  it('reads ?q= and ?tier= and a forced tier is locked', () => {
    expect(tierFromSearch('?q=low')).toBe('low');
    expect(tierFromSearch('?tier=medium')).toBe('medium');
    expect(tierFromSearch('?q=ultra')).toBe(null);
    const q = createQuality(null, { tier: 'low', locked: true });
    expect(q.locked).toBe(true);
  });

  it('registers editable tiers; setting the tier by name locks it', () => {
    const r = new Registry();
    const q = createQuality(r);
    expect(r.getParam('quality.tier', 'tier')).toBe('high');
    r.set('quality.tier', 'tier', 'low');
    expect(q.tier).toBe('low');
    expect(q.locked).toBe(true);
    r.set('quality.low', 'pixelRatioCap', 0.75);
    expect(q.settings.pixelRatioCap).toBe(0.75);
  });

  it('applies overrides queued before creation', () => {
    const r = new Registry();
    r.set('quality.tier', 'thresholdMs', 10);
    r.set('quality.high', 'shadowMapSize', 4096);
    const q = createQuality(r);
    expect(q.settings.shadowMapSize).toBe(4096);
    feed(q, 12);
    expect(q.tier).toBe('medium');
  });
});
