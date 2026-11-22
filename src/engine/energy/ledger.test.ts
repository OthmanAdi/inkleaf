import { describe, expect, it } from 'vitest';
import { Ledger, Neumaier, matches } from './ledger';

const make = () => {
  const l = new Ledger();
  l.open('gravitational:book', 14.7);
  l.open('kinetic:book', 0);
  l.open('thermal:book and floor', 0);
  return l;
};

describe('Neumaier sum', () => {
  it('keeps small terms that plain addition loses', () => {
    const n = new Neumaier();
    n.add(1);
    n.add(1e100);
    n.add(1);
    n.add(-1e100);
    expect(n.value).toBe(2);
  });
});

describe('Ledger', () => {
  it('rejects bad accounts, amounts and pathways', () => {
    const l = make();
    expect(() => l.open('heat:pan')).toThrow();
    expect(() => l.transfer('kinetic:book', 'kinetic:book', 1, 'mechanical')).toThrow();
    expect(() => l.transfer('kinetic:book', 'thermal:book and floor', -1, 'mechanical')).toThrow();
    expect(() => l.transfer('kinetic:book', 'thermal:book and floor', 1, 'magic')).toThrow();
    expect(() => l.transfer('kinetic:nobody', 'thermal:book and floor', 1, 'heating')).toThrow();
  });

  it('conserves: balances sum to opening plus boundary net', () => {
    const l = make();
    l.beginStep(0.01);
    l.move('gravitational:book', 'kinetic:book', 5, 'mechanical');
    l.move('kinetic:book', 'gravitational:book', -1, 'mechanical');
    l.transfer('kinetic:book', 'thermal:book and floor', 2.5, 'heating');
    l.inject('kinetic:book', 0.3, 'mechanical', 'hand');
    l.remove('thermal:book and floor', 0.1, 'heating');
    l.endStep();
    expect(l.balance('gravitational:book')).toBeCloseTo(8.7, 12);
    expect(l.balance('kinetic:book')).toBeCloseTo(3.8, 12);
    expect(l.balance('thermal:book and floor')).toBeCloseTo(2.4, 12);
    expect(l.total()).toBeCloseTo(l.openingTotal() + l.boundaryNet(), 12);
    expect(l.boundaryNet()).toBeCloseTo(0.2, 12);
    expect(l.byStore()).toEqual({ gravitational: expect.closeTo(8.7, 12), kinetic: expect.closeTo(3.8, 12), thermal: expect.closeTo(2.4, 12) });
    expect(l.totalsByPathway().mechanical).toBeCloseTo(6, 12);
    expect(l.totalsByPathway().heating).toBeCloseTo(2.5, 12);
    expect(l.statement('kinetic:book')).toMatchObject({ opening: 0, in: 6, out: 2.5, injected: 0.3, removed: 0 });
  });

  it('smooths power with a 0.2 s time constant (63 % after 0.2 s)', () => {
    const l = make();
    const dt = 0.001;
    for (let i = 0; i < 200; i++) {
      l.beginStep(dt);
      l.transfer('gravitational:book', 'kinetic:book', 10 * dt, 'mechanical');
      l.endStep();
    }
    const f = l.flows();
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ from: 'gravitational:book', to: 'kinetic:book', pathway: 'mechanical' });
    expect(f[0]!.watts / 10).toBeCloseTo(1 - Math.exp(-1), 9);
    expect(f[0]!.raw).toBeCloseTo(10, 9);
    expect(l.power('gravitational', 'kinetic')).toBeCloseTo(f[0]!.watts, 12);
    expect(l.power('kinetic', 'gravitational')).toBe(0);
    expect(l.power('kinetic', 'gravitational', { signed: true })).toBeCloseTo(-f[0]!.watts, 12);
  });

  it('orients flows by the net direction and drops dead flows below minWatts', () => {
    const l = new Ledger({ minWatts: 1e-3 });
    l.open('kinetic:ball');
    l.open('gravitational:ball', 1);
    l.beginStep(0.1);
    l.transfer('kinetic:ball', 'gravitational:ball', 0.1, 'mechanical');
    l.transfer('gravitational:ball', 'kinetic:ball', 0.3, 'mechanical');
    l.endStep();
    const f = l.flows();
    expect(f).toHaveLength(1);
    expect(f[0]!.from).toBe('gravitational:ball');
    expect(f[0]!.raw).toBeCloseTo(2, 12);
    for (let i = 0; i < 200 && l.flows().length; i++) {
      l.beginStep(0.1);
      l.endStep();
    }
    expect(l.flows()).toHaveLength(0);
  });

  it('keeps the last 240 log entries', () => {
    const l = make();
    for (let i = 0; i < 300; i++) {
      l.beginStep(0.01);
      l.endStep();
    }
    expect(l.log).toHaveLength(240);
    expect(l.log[0]!.index).toBe(60);
    expect(l.steps).toBe(300);
    expect(l.time).toBeCloseTo(3, 9);
  });

  it('round-trips through JSON', () => {
    const l = make();
    l.beginStep(0.05);
    l.transfer('gravitational:book', 'kinetic:book', 4, 'mechanical');
    l.exchange('kinetic:book', -1, 'mechanical', 'hand');
    l.endStep();
    const copy = Ledger.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(copy.balances()).toEqual(l.balances());
    expect(copy.totals()).toEqual(l.totals());
    expect(copy.boundaryTotals()).toEqual(l.boundaryTotals());
  });

  it('matches accounts by name, store or predicate', () => {
    expect(matches('kinetic', 'kinetic:ball')).toBe(true);
    expect(matches('kinetic:ball', 'kinetic:ball')).toBe(true);
    expect(matches('kin', 'kinetic:ball')).toBe(false);
    expect(matches((a) => a.endsWith('ball'), 'kinetic:ball')).toBe(true);
  });
});
