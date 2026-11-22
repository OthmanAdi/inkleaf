/**
 * The energy ledger: every joule a simulation moves is booked from one account to another along a pathway, or
 * across the system boundary. Accounts are named `<store>:<object>` ("kinetic:ball"). Sums are compensated
 * (Neumaier), and power flows per pair and pathway are smoothed with a time constant so streams can read watts.
 */
import { energyConfig } from './config';
import { ENERGY_PATHWAYS, ENERGY_STORES } from './palette';

export class Neumaier {
  private s = 0;
  private c = 0;
  add(t: number): void {
    const e = this.s + t;
    if (Math.abs(this.s) >= Math.abs(t)) this.c += this.s - e + t;
    else this.c += t - e + this.s;
    this.s = e;
  }
  get value(): number {
    return this.s + this.c;
  }
  reset(v = 0): void {
    this.s = v;
    this.c = 0;
  }
}

/** Sums a list with compensation. */
export const neumaierSum = (xs: Iterable<number>): number => {
  const n = new Neumaier();
  for (const x of xs) n.add(x);
  return n.value;
};

interface Account {
  name: string;
  store: string;
  object: string;
  opening: number;
  in: Neumaier;
  out: Neumaier;
  injected: Neumaier;
  removed: Neumaier;
}

export interface Flow { from: string; to: string; pathway: string; watts: number; raw: number }
export interface BoundaryFlow { account: string; party: string; pathway: string; direction: 'in' | 'out'; watts: number; raw: number }
export interface Statement { account: string; opening: number; in: number; out: number; injected: number; removed: number; balance: number }
export interface LogEntry {
  index: number;
  time: number;
  dt: number;
  transfers: { from: string; to: string; pathway: string; J: number }[];
  boundary: { account: string; party: string; pathway: string; J: number }[];
  total: number;
  balances: Record<string, number>;
}

export interface LedgerJSON {
  version: 1;
  time: number;
  steps: number;
  accounts: { name: string; opening: number; in: number; out: number; injected: number; removed: number }[];
  totals: { from: string; to: string; pathway: string; J: number }[];
  boundaryTotals: { account: string; party: string; pathway: string; direction: 'in' | 'out'; J: number }[];
}

export interface LedgerOptions {
  /** Valid store ids (the part before the colon). Default: the eight energy stores. */
  stores?: readonly string[];
  pathways?: readonly string[];
  /** Per-ledger overrides of `energy.ledger` (time constant, log size, minimum watts). */
  timeConstant?: number;
  logSize?: number;
  minWatts?: number;
}

const SEP = '\u0001';

interface Smoothed { s: number; raw: number; p0: string; p1: string; p2: string }

export class Ledger {
  readonly stores: ReadonlySet<string>;
  readonly pathways: ReadonlySet<string>;
  time = 0;
  steps = 0;
  readonly log: LogEntry[] = [];
  private readonly opts: LedgerOptions;
  private readonly accounts = new Map<string, Account>();
  private readonly totalsMap = new Map<string, Neumaier>();
  private readonly boundaryTotalsMap = new Map<string, Neumaier>();
  private readonly stepTransfers = new Map<string, number>();
  private readonly stepBoundary = new Map<string, number>();
  private readonly smooth = new Map<string, Smoothed>();
  private readonly smoothBoundary = new Map<string, Smoothed>();
  private stepDt = 0;
  private inStep = false;

  constructor(opts: LedgerOptions = {}) {
    this.opts = opts;
    this.stores = new Set(opts.stores ?? ENERGY_STORES.map((s) => s.id));
    this.pathways = new Set(opts.pathways ?? ENERGY_PATHWAYS.map((p) => p.id));
  }

  get timeConstant(): number {
    return this.opts.timeConstant ?? energyConfig.ledger.timeConstant;
  }
  get logSize(): number {
    return this.opts.logSize ?? energyConfig.ledger.logSize;
  }
  get minWatts(): number {
    return this.opts.minWatts ?? energyConfig.ledger.minWatts;
  }

  reset(): void {
    this.accounts.clear();
    this.totalsMap.clear();
    this.boundaryTotalsMap.clear();
    this.stepTransfers.clear();
    this.stepBoundary.clear();
    this.smooth.clear();
    this.smoothBoundary.clear();
    this.log.length = 0;
    this.time = 0;
    this.steps = 0;
    this.inStep = false;
  }

  open(name: string, opening = 0): void {
    const i = name.indexOf(':');
    const store = i > 0 ? name.slice(0, i) : '';
    if (!this.stores.has(store)) throw new Error(`inkleaf ledger: account "${name}" must be "<store>:<object>" with a store in ${[...this.stores].join(', ')}`);
    if (!Number.isFinite(opening)) throw new Error(`inkleaf ledger: opening balance of "${name}" must be finite`);
    const n = () => new Neumaier();
    this.accounts.set(name, { name, store, object: name.slice(i + 1), opening, in: n(), out: n(), injected: n(), removed: n() });
  }

  has(name: string): boolean {
    return this.accounts.has(name);
  }

  accountNames(): string[] {
    return [...this.accounts.keys()];
  }

  private acc(name: string): Account {
    const a = this.accounts.get(name);
    if (!a) throw new Error(`inkleaf ledger: no account "${name}". Open it first (accounts: ${this.accountNames().join(', ')})`);
    return a;
  }

  private checkJ(J: number, what: string): void {
    if (!Number.isFinite(J) || J < 0) throw new Error(`inkleaf ledger: ${what} needs a finite, non-negative amount (got ${J})`);
  }

  private checkPathway(p: string): void {
    if (!this.pathways.has(p)) throw new Error(`inkleaf ledger: unknown pathway "${p}" (known: ${[...this.pathways].join(', ')})`);
  }

  transfer(from: string, to: string, J: number, pathway: string): void {
    this.checkJ(J, 'transfer');
    this.checkPathway(pathway);
    if (from === to) throw new Error(`inkleaf ledger: transfer from "${from}" to itself`);
    const a = this.acc(from);
    const b = this.acc(to);
    if (J === 0) return;
    a.out.add(J);
    b.in.add(J);
    const key = from + SEP + to + SEP + pathway;
    this.stepTransfers.set(key, (this.stepTransfers.get(key) ?? 0) + J);
    let t = this.totalsMap.get(key);
    if (!t) this.totalsMap.set(key, (t = new Neumaier()));
    t.add(J);
  }

  /** Signed transfer: J >= 0 moves from -> to, J < 0 moves to -> from. */
  move(from: string, to: string, J: number, pathway: string): void {
    if (J >= 0) this.transfer(from, to, J, pathway);
    else this.transfer(to, from, -J, pathway);
  }

  inject(account: string, J: number, pathway: string, party = 'outside'): void {
    this.checkJ(J, 'inject');
    this.checkPathway(pathway);
    const a = this.acc(account);
    if (J === 0) return;
    a.injected.add(J);
    this.bookBoundary(account, party, pathway, J);
  }

  remove(account: string, J: number, pathway: string, party = 'outside'): void {
    this.checkJ(J, 'remove');
    this.checkPathway(pathway);
    const a = this.acc(account);
    if (J === 0) return;
    a.removed.add(J);
    this.bookBoundary(account, party, pathway, -J);
  }

  /** Signed boundary exchange: J >= 0 enters the account from `party`, J < 0 leaves to it. */
  exchange(account: string, J: number, pathway: string, party = 'outside'): void {
    if (J >= 0) this.inject(account, J, pathway, party);
    else this.remove(account, -J, pathway, party);
  }

  private bookBoundary(account: string, party: string, pathway: string, signed: number): void {
    const key = account + SEP + party + SEP + pathway;
    this.stepBoundary.set(key, (this.stepBoundary.get(key) ?? 0) + signed);
    const tkey = key + SEP + (signed >= 0 ? 'in' : 'out');
    let t = this.boundaryTotalsMap.get(tkey);
    if (!t) this.boundaryTotalsMap.set(tkey, (t = new Neumaier()));
    t.add(Math.abs(signed));
  }

  beginStep(dt: number): void {
    this.stepDt = dt;
    this.stepTransfers.clear();
    this.stepBoundary.clear();
    this.inStep = true;
  }

  endStep(): void {
    const dt = this.stepDt;
    const net = new Map<string, number>();
    const transfers: LogEntry['transfers'] = [];
    for (const [key, J] of this.stepTransfers) {
      const [from = '', to = '', pathway = ''] = key.split(SEP);
      transfers.push({ from, to, pathway, J });
      const canon = from < to ? key : to + SEP + from + SEP + pathway;
      net.set(canon, (net.get(canon) ?? 0) + (from < to ? J : -J));
    }
    const boundary: LogEntry['boundary'] = [];
    for (const [key, J] of this.stepBoundary) {
      const [account = '', party = '', pathway = ''] = key.split(SEP);
      boundary.push({ account, party, pathway, J });
    }
    if (dt > 0) {
      const a = 1 - Math.exp(-dt / this.timeConstant);
      this.smoothInto(this.smooth, net, dt, a);
      this.smoothInto(this.smoothBoundary, this.stepBoundary, dt, a);
      this.time += dt;
    }
    this.steps += 1;
    const size = this.logSize;
    if (size > 0) {
      this.log.push({ index: this.steps - 1, time: this.time, dt, transfers, boundary, total: this.total(), balances: this.balances() });
      while (this.log.length > size) this.log.shift();
    } else this.log.length = 0;
    this.stepTransfers.clear();
    this.stepBoundary.clear();
    this.inStep = false;
  }

  /** True between beginStep and endStep. */
  get stepping(): boolean {
    return this.inStep;
  }

  private smoothInto(map: Map<string, Smoothed>, step: ReadonlyMap<string, number>, dt: number, a: number): void {
    const min = this.minWatts;
    for (const key of step.keys())
      if (!map.has(key)) {
        const [p0 = '', p1 = '', p2 = ''] = key.split(SEP);
        map.set(key, { s: 0, raw: 0, p0, p1, p2 });
      }
    for (const [key, e] of map) {
      const J = step.get(key);
      const raw = J === undefined ? 0 : J / dt;
      e.raw = raw;
      e.s += a * (raw - e.s);
      if (J === undefined && Math.abs(e.s) < min) map.delete(key);
    }
  }

  /** Smoothed power flows between accounts, oriented by the sign of the flow. */
  flows(): Flow[] {
    const out: Flow[] = [];
    for (const e of this.smooth.values()) {
      const { p0: a, p1: b, p2: pathway } = e;
      out.push(e.s >= 0 ? { from: a, to: b, pathway, watts: Math.abs(e.s), raw: e.raw } : { from: b, to: a, pathway, watts: Math.abs(e.s), raw: -e.raw });
    }
    return out;
  }

  /**
   * Smoothed watts flowing from accounts matching `from` to accounts matching `to` (optionally one pathway), minus the
   * reverse flow when `signed`. Matchers: an account name, a store id ("kinetic"), or a predicate. No allocation.
   */
  power(from: AccountMatch, to: AccountMatch, opts: { pathway?: string; signed?: boolean } = {}): number {
    let w = 0;
    for (const e of this.smooth.values()) {
      const a = e.p0;
      const b = e.p1;
      if (opts.pathway && e.p2 !== opts.pathway) continue;
      if (matches(from, a) && matches(to, b)) {
        if (e.s >= 0) w += e.s;
        else if (opts.signed) w += e.s;
      } else if (matches(from, b) && matches(to, a)) {
        if (e.s < 0) w -= e.s;
        else if (opts.signed) w -= e.s;
      }
    }
    return w;
  }

  boundaryFlows(): BoundaryFlow[] {
    const out: BoundaryFlow[] = [];
    for (const e of this.smoothBoundary.values()) {
      const { p0: account, p1: party, p2: pathway } = e;
      out.push({ account, party, pathway, direction: e.s >= 0 ? 'in' : 'out', watts: Math.abs(e.s), raw: e.raw });
    }
    return out;
  }

  /** Lifetime transfers per (from, to, pathway). */
  totals(): { from: string; to: string; pathway: string; J: number }[] {
    return [...this.totalsMap].map(([key, n]) => {
      const [from = '', to = '', pathway = ''] = key.split(SEP);
      return { from, to, pathway, J: n.value };
    });
  }

  /** Lifetime joules moved along each pathway (transfers only). */
  totalsByPathway(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const p of this.pathways) out[p] = 0;
    for (const t of this.totals()) out[t.pathway] = (out[t.pathway] ?? 0) + t.J;
    return out;
  }

  boundaryTotals(): { account: string; party: string; pathway: string; direction: 'in' | 'out'; J: number }[] {
    return [...this.boundaryTotalsMap].map(([key, n]) => {
      const [account = '', party = '', pathway = '', dir = 'in'] = key.split(SEP);
      return { account, party, pathway, direction: dir as 'in' | 'out', J: n.value };
    });
  }

  balance(name: string): number {
    const a = this.acc(name);
    return a.opening + a.in.value - a.out.value + a.injected.value - a.removed.value;
  }

  balances(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const name of this.accounts.keys()) out[name] = this.balance(name);
    return out;
  }

  /** Balances summed per store. */
  byStore(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const a of this.accounts.values()) out[a.store] = (out[a.store] ?? 0) + this.balance(a.name);
    return out;
  }

  total(): number {
    const n = new Neumaier();
    for (const name of this.accounts.keys()) n.add(this.balance(name));
    return n.value;
  }

  openingTotal(): number {
    return neumaierSum([...this.accounts.values()].map((a) => a.opening));
  }

  /** Joules that entered minus joules that left across the boundary. */
  boundaryNet(): number {
    const n = new Neumaier();
    for (const a of this.accounts.values()) {
      n.add(a.injected.value);
      n.add(-a.removed.value);
    }
    return n.value;
  }

  statement(name: string): Statement {
    const a = this.acc(name);
    return { account: name, opening: a.opening, in: a.in.value, out: a.out.value, injected: a.injected.value, removed: a.removed.value, balance: this.balance(name) };
  }

  toJSON(): LedgerJSON {
    return {
      version: 1,
      time: this.time,
      steps: this.steps,
      accounts: [...this.accounts.values()].map((a) => ({ name: a.name, opening: a.opening, in: a.in.value, out: a.out.value, injected: a.injected.value, removed: a.removed.value })),
      totals: this.totals(),
      boundaryTotals: this.boundaryTotals(),
    };
  }

  load(json: LedgerJSON): void {
    if (json.version !== 1) throw new Error(`inkleaf ledger: unsupported version ${String(json.version)}`);
    this.reset();
    this.time = json.time;
    this.steps = json.steps;
    for (const a of json.accounts) {
      this.open(a.name, a.opening);
      const acc = this.acc(a.name);
      acc.in.reset(a.in);
      acc.out.reset(a.out);
      acc.injected.reset(a.injected);
      acc.removed.reset(a.removed);
    }
    for (const t of json.totals) {
      const n = new Neumaier();
      n.reset(t.J);
      this.totalsMap.set(t.from + SEP + t.to + SEP + t.pathway, n);
    }
    for (const t of json.boundaryTotals) {
      const n = new Neumaier();
      n.reset(t.J);
      this.boundaryTotalsMap.set(t.account + SEP + t.party + SEP + t.pathway + SEP + t.direction, n);
    }
  }

  static fromJSON(json: LedgerJSON, opts: LedgerOptions = {}): Ledger {
    const l = new Ledger(opts);
    l.load(json);
    return l;
  }
}

export type AccountMatch = string | ((account: string) => boolean);

/** An account name matches itself, its store id ("kinetic" matches "kinetic:ball"), or a predicate. */
export function matches(m: AccountMatch, account: string): boolean {
  if (typeof m === 'function') return m(account);
  if (m === account) return true;
  return account.length > m.length && account.charCodeAt(m.length) === 58 && account.startsWith(m);
}
