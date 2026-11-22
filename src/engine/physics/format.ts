/**
 * Number formatting for readers: significant figures, joules with kJ/MJ and powers of ten, plain numbers with
 * thousands separators and a true minus sign, percentages, and worked examples whose rounded inputs reproduce the
 * rounded answer.
 */

const SUP: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
export const superscript = (n: number | string): string => String(n).replace(/[0-9-]/g, (c) => SUP[c] ?? c);

export const MINUS = '\u2212';
export const TIMES = '\u00d7';

/**
 * Rounds to `sf` significant figures and returns the shortest string: `e = sf - 1 - floor(log10|x|)`; e <= 0 rounds
 * to a multiple of 10^-e, otherwise to e decimals with trailing zeros stripped. Zero or non-finite: String(x).
 */
export function roundSig(x: number, sf = 2): string {
  if (x === 0 || !Number.isFinite(x)) return String(x);
  const e = sf - 1 - Math.floor(Math.log10(Math.abs(x)));
  if (e <= 0) {
    const m = Math.pow(10, -e);
    return String(Math.round(x / m) * m);
  }
  const s = x.toFixed(e);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Mantissa (sf s.f.) and exponent such that x = m x 10^n with 1 <= |m| < 10 after rounding. */
export function sciParts(x: number, sf = 2): { mantissa: string; exponent: number } {
  let n = Math.floor(Math.log10(Math.abs(x)));
  let m = x / Math.pow(10, n);
  const p = Math.pow(10, sf - 1);
  m = Math.round(m * p) / p;
  if (Math.abs(m) >= 10) {
    m /= 10;
    n += 1;
  }
  return { mantissa: roundSig(m, sf), exponent: n };
}

/** J, kJ, MJ, or `m x 10^n J` from a billion joules up. */
export function formatJoules(J: number, sf = 2): string {
  const a = Math.abs(J);
  if (!Number.isFinite(J)) return String(J);
  if (a >= 1e9) {
    const { mantissa, exponent } = sciParts(J, sf);
    return `${mantissa} ${TIMES} 10${superscript(exponent)} J`;
  }
  if (a >= 1e6) return `${roundSig(J / 1e6, sf)} MJ`;
  if (a >= 1e3) return `${roundSig(J / 1e3, sf)} kJ`;
  return `${roundSig(J, sf)} J`;
}

/**
 * A round jar capacity for a value: the first of 1, 2, 5 times 10^i (i from floor(log10(J / target)) up) that holds
 * J at a fill of at most `target`. So a scaled jar is between 36 % and 90 % full.
 */
export function jarScale(J: number, target = 0.9): { capacity: number; fill: number; text: string } {
  if (!(J > 0)) throw new Error('inkleaf: jarScale needs a positive value');
  const e = J / target;
  const i = Math.floor(Math.log10(e));
  for (let d = i; d <= i + 2; d++)
    for (const m of [1, 2, 5]) {
      const cap = m * Math.pow(10, d);
      if (cap >= e * (1 - 1e-12)) return { capacity: cap, fill: J / cap, text: `full jar = ${formatJoules(cap, 1)}` };
    }
  const cap = Math.pow(10, i + 3);
  return { capacity: cap, fill: J / cap, text: `full jar = ${formatJoules(cap, 1)}` };
}

/** Fixed decimals for `sf` significant figures (at most 4 decimals); tiny values print "0", non-finite "–". */
export function sigDecimals(x: number, sf = 2): string {
  if (!Number.isFinite(x)) return '\u2013';
  if (Math.abs(x) < 0.005) return '0';
  const d = Math.min(4, Math.max(0, sf - 1 - Math.floor(Math.log10(Math.abs(x)))));
  return x.toFixed(d);
}

/** Joules for running readouts (margins, meters): fixed decimals, MJ / kJ / J. */
export function joules(x: number, sf = 2): string {
  const a = Math.abs(x);
  if (a >= 1e6) return `${sigDecimals(x / 1e6, sf)} MJ`;
  if (a >= 1e3) return `${sigDecimals(x / 1e3, sf)} kJ`;
  return `${sigDecimals(x, sf)} J`;
}

const groupThousands = (s: string): string => {
  const [int = '', frac] = s.split('.');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.length >= 5 ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits;
  return (neg ? '-' : '') + grouped + (frac !== undefined ? '.' + frac : '');
};

/**
 * A number for prose: powers of ten for very large or very small values (unless dp is given), otherwise up to 12
 * significant digits or `dp` decimals; thousands commas from five integer digits; U+2212 minus.
 */
export function printNumber(x: number, dp?: number): string {
  if (!Number.isFinite(x)) return '\u2013';
  const a = Math.abs(x);
  let s: string;
  if (dp === undefined && (a >= 1e7 || (a > 0 && a < 1e-4))) {
    const { mantissa, exponent } = sciParts(x, 2);
    s = `${mantissa} ${TIMES} 10${superscript(exponent)}`;
    return s.replace(/^-/, MINUS);
  }
  s = dp === undefined ? String(Number(x.toPrecision(12))) : x.toFixed(dp);
  return groupThousands(s).replace(/^-/, MINUS);
}

/** A fraction as a percentage string (no % sign): dp decimals, else whole numbers from 10, else 2 s.f. */
export function percent(f: number, dp?: number): string {
  const p = f * 100;
  if (dp !== undefined) return p.toFixed(dp);
  if (Math.abs(p) >= 10) return String(Math.round(p));
  return roundSig(p, 2);
}

/** Significant figures with carry kept visible: sigFigs(9.96, 2) = "10", sigFigs(0.5, 2) = "0.50". */
export function sigFigs(x: number, n = 2): string {
  if (x === 0) return n > 1 ? (0).toFixed(n - 1) : '0';
  if (!Number.isFinite(x)) return String(x);
  let e = Math.floor(Math.log10(Math.abs(x)));
  const k = n - 1 - e;
  const r = k >= 0 ? Math.round(x * Math.pow(10, k)) / Math.pow(10, k) : Math.round(x / Math.pow(10, -k)) * Math.pow(10, -k);
  if (Math.abs(r) >= Math.pow(10, e + 1)) e += 1;
  const dec = Math.max(0, n - 1 - e);
  return r.toFixed(dec);
}

/** Fewest significant figures (1..max) that represent x exactly, or `max` if none does. */
export function minSigFigs(x: number, max = 6): number {
  for (let n = 1; n <= max; n++) if (Math.abs(Number(sigFigs(x, n)) - x) <= Math.abs(x) * 1e-12) return n;
  return max;
}

export interface WorkedExample {
  inputs: string[];
  result: string;
  value: number;
  /** True when inputs had to be shown with extra figures for the rounded answer to follow from them. */
  adjusted: boolean;
}

/**
 * Rounds the inputs of a worked example so that the shown inputs reproduce the shown answer: inputs keep the fewest
 * figures that represent them exactly (at least inputSf); if fn(rounded inputs) rounds differently from the true
 * result, every inexact input gains one figure (up to maxSf) and we retry.
 */
export function workedExample(inputs: readonly number[], fn: (...v: number[]) => number, opts: { sf?: number; inputSf?: number; maxSf?: number } = {}): WorkedExample {
  const sf = opts.sf ?? 2;
  const inputSf = opts.inputSf ?? 2;
  const maxSf = opts.maxSf ?? Math.max(4, sf + 1);
  const value = fn(...inputs);
  const want = sigFigs(value, sf);
  const figs = inputs.map((x) => {
    const m = minSigFigs(x, maxSf);
    return m <= maxSf && Math.abs(Number(sigFigs(x, m)) - x) <= Math.abs(x) * 1e-12 ? Math.max(inputSf, m) : inputSf;
  });
  const exact = inputs.map((x, i) => Math.abs(Number(sigFigs(x, figs[i]!)) - x) <= Math.abs(x) * 1e-12);
  let adjusted = false;
  for (;;) {
    const shown = inputs.map((x, i) => sigFigs(x, figs[i]!));
    const got = sigFigs(fn(...shown.map(Number)), sf);
    if (got === want) return { inputs: shown, result: want, value, adjusted };
    let grew = false;
    for (let i = 0; i < inputs.length; i++)
      if (!exact[i] && figs[i]! < maxSf) {
        figs[i] = figs[i]! + 1;
        grew = true;
      }
    if (!grew) return { inputs: shown, result: want, value, adjusted };
    adjusted = true;
  }
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "zero" to "ten" for whole numbers in range, digits otherwise. */
export const numberWord = (n: number): string => (Number.isInteger(n) && n >= 0 && n <= 10 ? WORDS[n]! : String(n));
