import { describe, expect, it } from 'vitest';
import { formatJoules, jarScale, joules, minSigFigs, numberWord, percent, printNumber, roundSig, sigDecimals, sigFigs, workedExample } from './format';

describe('significant figures', () => {
  it('rounds to the shortest string', () => {
    expect(roundSig(14.7)).toBe('15');
    expect(roundSig(0.32)).toBe('0.32');
    expect(roundSig(1.2186)).toBe('1.2');
    expect(roundSig(1218.6)).toBe('1200');
    expect(roundSig(1.0, 3)).toBe('1');
    expect(roundSig(0)).toBe('0');
    expect(roundSig(NaN)).toBe('NaN');
  });

  it('keeps the carry visible', () => {
    expect(sigFigs(9.96, 2)).toBe('10');
    expect(sigFigs(0.5, 2)).toBe('0.50');
    expect(sigFigs(14.7, 2)).toBe('15');
    expect(minSigFigs(9.8)).toBe(2);
    expect(minSigFigs(1.5)).toBe(2);
    expect(minSigFigs(4200)).toBe(2);
  });

  it('prints fixed decimals for readouts', () => {
    expect(sigDecimals(0.004)).toBe('0');
    expect(sigDecimals(0.24)).toBe('0.24');
    expect(sigDecimals(14.7)).toBe('15');
    expect(sigDecimals(Infinity)).toBe('\u2013');
    expect(joules(61152)).toBe('61 kJ');
  });
});

describe('formatJoules', () => {
  it('uses J, kJ, MJ and powers of ten', () => {
    expect(formatJoules(14.7)).toBe('15 J');
    expect(formatJoules(0.32)).toBe('0.32 J');
    expect(formatJoules(1218.6)).toBe('1.2 kJ');
    expect(formatJoules(61152)).toBe('61 kJ');
    expect(formatJoules(14000)).toBe('14 kJ');
    expect(formatJoules(2.5e6)).toBe('2.5 MJ');
    expect(formatJoules(3.828e26)).toBe('3.8 × 10²⁶ J');
    expect(formatJoules(0)).toBe('0 J');
    expect(formatJoules(20, 1)).toBe('20 J');
  });
});

describe('jarScale', () => {
  it.each([
    [14.7, 20, 0.735, 'full jar = 20 J'],
    [1218.6, 2000, 0.6093, 'full jar = 2 kJ'],
    [0.32, 0.5, 0.64, 'full jar = 0.5 J'],
    [61152, 100000, 0.6115, 'full jar = 100 kJ'],
    [14000, 20000, 0.7, 'full jar = 20 kJ'],
  ])('%f J -> capacity %f', (J, cap, fill, text) => {
    const s = jarScale(J);
    expect(s.capacity).toBe(cap);
    expect(s.fill).toBeCloseTo(fill, 3);
    expect(s.text).toBe(text);
  });

  it('keeps every scaled jar between 36 % and 90 % full', () => {
    for (let J = 0.013; J < 1e7; J *= 1.37) {
      const { fill } = jarScale(J);
      expect(fill).toBeGreaterThan(0.36 - 1e-9);
      expect(fill).toBeLessThanOrEqual(0.9 + 1e-9);
    }
  });
});

describe('printNumber and percent', () => {
  it('groups thousands from five digits and uses a true minus', () => {
    expect(printNumber(1234)).toBe('1234');
    expect(printNumber(61152)).toBe('61,152');
    expect(printNumber(-2.5)).toBe('\u22122.5');
    expect(printNumber(3.828e26)).toBe('3.8 × 10²⁶');
    expect(printNumber(0.00005)).toBe('5 × 10⁻⁵');
    expect(printNumber(1.23456, 2)).toBe('1.23');
  });

  it('prints percentages', () => {
    expect(percent(0.735)).toBe('74');
    expect(percent(0.0612)).toBe('6.1');
    expect(percent(0.5, 1)).toBe('50.0');
  });

  it('names small numbers', () => {
    expect(numberWord(8)).toBe('eight');
    expect(numberWord(11)).toBe('11');
  });
});

describe('workedExample', () => {
  it('shows inputs that reproduce the shown answer', () => {
    const w = workedExample([1, 9.8, 1.5], (m, g, h) => m! * g! * h!);
    expect(w.result).toBe('15');
    expect(w.inputs).toEqual(['1.0', '9.8', '1.5']);
    expect(w.adjusted).toBe(false);
  });

  it('keeps exact inputs as written', () => {
    const w = workedExample([0.26, 4200, 56.4], (m, c, d) => m! * c! * d!);
    expect(w.inputs).toEqual(['0.26', '4200', '56.4']);
    expect(w.result).toBe('62000');
  });

  it('adds figures when rounded inputs would give a different answer', () => {
    const w = workedExample([1 / 3, 3], (a, b) => a! * b!);
    expect(w.result).toBe('1.0');
    expect(w.inputs).toEqual(['0.333', '3.0']);
    expect(w.adjusted).toBe(true);
  });
});
