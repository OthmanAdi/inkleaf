import { describe, expect, it } from 'vitest';
import { Registry } from '../core/registry';
import { physicsConfig, registerPhysics } from './config';
import { Bounce, BALLS, restitution } from './bounce';
import { DropSequence, Fall } from './fall';
import { EventStepper, Rk4, crosses, findEventRoot, splitFrame } from './integrator';
import { Pendulum } from './pendulum';
import { DEFAULT_TRACK, Ramp } from './ramp';
import { SpringLauncher } from './spring';
import { GL5_WEIGHTS, Track, gaussLegendre5 } from './track';

const conserves = (sim: { ledger: { total(): number; openingTotal(): number; boundaryNet(): number } }, tol = 1e-9) =>
  expect(Math.abs(sim.ledger.total() - sim.ledger.openingTotal() - sim.ledger.boundaryNet())).toBeLessThan(tol);

const ledgerMatchesState = (sim: { energies(): Record<string, number>; ledger: { balance(a: string): number } }, tol: number) => {
  for (const [acc, J] of Object.entries(sim.energies())) expect(Math.abs(sim.ledger.balance(acc) - J)).toBeLessThan(tol);
};

const run = (sim: { step(dt: number): void }, seconds: number, dt = 1 / 60) => {
  for (let t = 0; t < seconds; t += dt) sim.step(dt);
};

describe('integrator', () => {
  it('splits frames into equal sub-steps of at most 1 ms and caps frames at 0.25 s', () => {
    expect(splitFrame(1 / 60)).toMatchObject({ n: 17 });
    expect(splitFrame(0.001).n).toBe(1);
    expect(splitFrame(0.002).n).toBe(2);
    const big = splitFrame(1);
    expect(big.dt).toBe(0.25);
    expect(big.n).toBe(250);
  });

  it('counts crossings by direction', () => {
    expect(crosses(1, 0, -1)).toBe(true);
    expect(crosses(1, -1, -1)).toBe(true);
    expect(crosses(0, -1, -1)).toBe(false);
    expect(crosses(-1, 1, -1)).toBe(false);
    expect(crosses(-1, 0, 1)).toBe(true);
    expect(crosses(-1, 1, 0)).toBe(true);
  });

  it('RK4 is exact for constant acceleration', () => {
    const rk = new Rk4(2);
    const y = Float64Array.from([1.5, 0]);
    rk.step((s, o) => ((o[0] = s[1]!), (o[1] = -9.8)), y, 0.3, y);
    expect(y[0]).toBeCloseTo(1.5 - 0.5 * 9.8 * 0.09, 14);
    expect(y[1]).toBeCloseTo(-2.94, 14);
  });

  it('finds an event root to 1e-13 (Illinois)', () => {
    const root = findEventRoot((c) => Math.cos(c), 3, 1, Math.cos(3), -1);
    expect(root).toBeGreaterThanOrEqual(Math.PI / 2);
    expect(root - Math.PI / 2).toBeLessThan(1e-12);
  });

  it('stops a step exactly on the earliest event', () => {
    const st = new EventStepper(2);
    const out = new Float64Array(2);
    const f = (s: Float64Array, o: Float64Array) => ((o[0] = s[1]!), (o[1] = -9.8));
    const r = st.step(f, Float64Array.from([0.01, -1]), 0.1, [{ g: (s) => s[0]! }], out);
    expect(r.event).toBe(0);
    const tHit = (-1 + Math.sqrt(1 + 2 * 9.8 * 0.01)) / 9.8;
    expect(r.h).toBeCloseTo(tHit, 12);
    expect(out[0]).toBeLessThanOrEqual(0);
    expect(out[0]).toBeGreaterThan(-1e-12);
  });
});

describe('Fall', () => {
  it('lands exactly sqrt(2h/g) after a drop from 1.5 m', () => {
    const fall = new Fall();
    fall.drop();
    run(fall, 1);
    const s = fall.state;
    expect(s.phase).toBe('landed');
    expect(Math.abs(s.landing!.t - Math.sqrt((2 * 1.5) / 9.8))).toBeLessThan(1e-9);
    expect(s.landing!.t).toBeCloseTo(0.5533, 4);
    expect(s.landing!.Ek).toBeCloseTo(14.7, 9);
    expect(s.heat + s.sound).toBeCloseTo(14.7, 9);
    expect(s.sound).toBeCloseTo(0.147, 9);
    expect(fall.challenge().met).toBe(false);
    conserves(fall);
    ledgerMatchesState(fall, 1e-9);
  });

  it('books the fall as gravitational -> kinetic, then kinetic -> thermal by heating', () => {
    const fall = new Fall();
    fall.drop();
    run(fall, 0.3);
    expect(fall.ledger.power('gravitational', 'kinetic')).toBeGreaterThan(5);
    ledgerMatchesState(fall, 1e-9);
    run(fall, 0.5);
    const totals = fall.ledger.totals();
    expect(totals.find((t) => t.pathway === 'heating')!.J).toBeCloseTo(14.7 * 0.99, 9);
    expect(fall.ledger.power('kinetic', 'thermal')).toBeGreaterThan(0);
  });

  it('a nudge off the edge is paid for by the hand', () => {
    const fall = new Fall({ params: { u: 1 } });
    fall.drop();
    expect(fall.state.nudge).toBeCloseTo(0.5, 12);
    run(fall, 1);
    expect(fall.state.landing!.Ek).toBeCloseTo(fall.predict().Ek, 9);
    expect(fall.state.landing!.speed).toBeCloseTo(fall.predict().speed, 9);
    conserves(fall);
    expect(fall.ledger.boundaryNet()).toBeCloseTo(0.5, 12);
  });

  it('a drop sequence slides, falls in slow motion and ends', () => {
    const fall = new Fall();
    const seq = new DropSequence(fall, { rest: { x: 0, y: 42.4, z: -50 } });
    let landed = 0;
    seq.onLand = () => landed++;
    seq.start();
    const p = { x: 0, y: 0, z: 0 };
    for (let t = 0; t < 0.3; t += 1 / 60) seq.update(1 / 60);
    expect(seq.position(p).z).toBeCloseTo(-50 + 7, 0);
    for (let t = 0; t < 2.6; t += 1 / 60) seq.update(1 / 60);
    expect(fall.state.phase).toBe('landed');
    expect(landed).toBe(1);
    expect(fall.state.landing!.t * 4 + 0.6).toBeCloseTo(2.81, 1);
    expect(seq.position(p).y).toBe(0);
    for (let t = 0; t < 4; t += 1 / 60) seq.update(1 / 60);
    expect(seq.mode).toBe('after');
  });
});

describe('Bounce', () => {
  it('uses e = sqrt(rebound / drop)', () => {
    expect(restitution(BALLS[0]!)).toBeCloseTo(0.7451, 4);
    expect(restitution(BALLS[1]!)).toBeCloseTo(0.7674, 4);
    expect(restitution(BALLS[2]!)).toBeCloseTo(0.8756, 4);
  });

  it('peaks at h0 e^(2k) and keeps the books balanced', () => {
    const b = new Bounce();
    b.release();
    run(b, 4);
    const e2 = b.e ** 2;
    const peaks = b.state.peaks.slice(0, 3).map((p) => p.h);
    expect(peaks[0]).toBeCloseTo(1 * e2, 9);
    expect(peaks[1]).toBeCloseTo(1 * e2 * e2, 9);
    expect(b.predictPeaks(1, 3)[2]).toBeCloseTo(peaks[2]!, 9);
    const loss = b.state.impacts.reduce((s, i) => s + i.loss, 0);
    expect(b.state.heat + b.state.sound).toBeCloseTo(loss, 12);
    conserves(b);
    ledgerMatchesState(b, 1e-9);
  });

  it('comes to rest once a rebound would be lower than 0.5 mm', () => {
    const b = new Bounce({ params: { ball: 'basketball', h0: 0.5 } });
    b.release();
    run(b, 20);
    expect(b.state.phase).toBe('rest');
    expect(b.state.heat + b.state.sound).toBeCloseTo(0.6 * 9.8 * 0.5, 9);
    conserves(b);
  });
});

describe('SpringLauncher', () => {
  it('launches with the predicted energy and keeps the books balanced', () => {
    const s = new SpringLauncher();
    s.pull(0.06);
    expect(s.ledger.balance('elastic:spring')).toBeCloseTo(0.5 * 100 * 0.0036, 12);
    s.release();
    run(s, 3);
    expect(s.state.phase).toBe('landed');
    const p = s.predict(0.06)!;
    expect(s.state.apex!.y).toBeCloseTo(p.apex.y, 6);
    expect(s.state.apex!.x).toBeCloseTo(p.apex.x, 6);
    expect(s.state.landing!.t - s.state.tLaunch).toBeCloseTo(p.tLand, 6);
    conserves(s);
    ledgerMatchesState(s, 1e-9);
  });

  it('finds the pull for the bell and clamps to the limit', () => {
    const s = new SpringLauncher();
    const e = s.pullForApex(0.9)!;
    expect(s.predict(e)!.apex.y).toBeCloseTo(0.9, 12);
    s.pull(0.2);
    expect(s.state.p).toBeCloseTo(-0.08, 12);
    expect(s.state.overLimit).toBe(true);
  });
});

describe('Track and Ramp', () => {
  it('Gauss-Legendre weights sum to 2 and integrate degree 9 exactly', () => {
    expect(GL5_WEIGHTS.reduce((a, b) => a + b, 0)).toBeCloseTo(2, 14);
    expect(gaussLegendre5((x) => x ** 9 + 3 * x ** 8, -1, 2)).toBeCloseTo((2 ** 10 - 1) / 10 + (3 * (2 ** 9 + 1)) / 9, 9);
  });

  it('measures the arc length of a straight track exactly', () => {
    const t = new Track([0, 1, 2], [0, 0.5, 1], 16);
    expect(t.length).toBeCloseTo(2 * Math.hypot(1, 0.5), 13);
    expect(t.s(1.3)).toBeCloseTo(1.3 * Math.hypot(1, 0.5), 12);
    expect(t.x(t.s(0.777))).toBeCloseTo(0.777, 12);
  });

  it('measures the valley track to the micrometre (512 GL5 sub-intervals)', () => {
    const t = new Track(DEFAULT_TRACK.xs, DEFAULT_TRACK.ys, 512);
    let ref = 0;
    const N = 400000;
    const h = (t.xEnd - t.xStart) / N;
    for (let i = 0; i < N; i++) {
      const a = t.xStart + i * h;
      ref += (h / 6) * (t.dsdx(a) + 4 * t.dsdx(a + h / 2) + t.dsdx(a + h));
    }
    expect(Math.abs(t.length - ref)).toBeLessThan(1e-9);
    for (const x of [0.11, 0.6, 0.93, 1.71]) expect(t.x(t.s(x))).toBeCloseTo(x, 12);
    expect(t.y(0.9)).toBeCloseTo(0.05, 12);
    expect(t.d2y(0)).toBeCloseTo(0, 12);
    expect(t.d2y(1.75)).toBeCloseTo(0, 12);
  });

  it('without friction the ball rises back to its start height', () => {
    const r = new Ramp();
    expect(r.track.y(r.startX)).toBeCloseTo(1, 9);
    r.release();
    run(r, 3);
    const right = r.state.turns.find((q) => q.side === 'right')!;
    expect(right.h).toBeCloseTo(1, 6);
    expect(r.valleyX).toBeGreaterThan(0.6);
    expect(r.valleyX).toBeLessThan(1.2);
    conserves(r);
    ledgerMatchesState(r, 1e-8);
  });

  it('with friction the turns get lower and the track warms', () => {
    const r = new Ramp({ params: { friction: true } });
    r.release();
    run(r, 3);
    const right = r.state.turns.find((q) => q.side === 'right')!;
    expect(right.h).toBeLessThan(0.97);
    expect(r.state.heat).toBeGreaterThan(0);
    conserves(r);
    ledgerMatchesState(r, 1e-8);
  });
});

describe('Pendulum', () => {
  it('turns every half period (exact large-amplitude period)', () => {
    const p = new Pendulum({ params: { drag: 0, theta0: 1 } });
    p.release();
    run(p, 5);
    const [a, b, c] = p.state.turns;
    expect(b!.t - a!.t).toBeCloseTo(p.period(1) / 2, 7);
    expect(c!.t - b!.t).toBeCloseTo(p.period(1) / 2, 7);
    expect(Math.abs(c!.theta)).toBeCloseTo(1, 7);
    conserves(p);
    ledgerMatchesState(p, 1e-9);
  });

  it('drag moves energy to the thermal store', () => {
    const p = new Pendulum({ params: { drag: 0.05 } });
    p.release();
    run(p, 10);
    expect(p.state.heat).toBeGreaterThan(0.01);
    const lastTurn = p.state.turns[p.state.turns.length - 1]!;
    expect(Math.abs(lastTurn.theta)).toBeLessThan(0.5);
    conserves(p);
    ledgerMatchesState(p, 1e-9);
  });
});

describe('registry', () => {
  it('registers physics constants and instance parameters by name', () => {
    const reg = new Registry();
    registerPhysics(reg);
    expect(reg.getParam('physics.integrator', 'maxSubstep')).toBe(0.001);
    expect(reg.getParam('physics.constants', 'g')).toBe(9.8);
    reg.set('physics.constants', 'g', 9.81);
    expect(physicsConfig.constants.g).toBe(9.81);
    reg.set('physics.constants', 'g', 9.8);
    const r = new Ramp();
    r.register(reg, 'lesson-2.ramp-sim', 'Ramp model');
    reg.set('lesson-2.ramp-sim', 'friction', true);
    expect(r.params.friction).toBe(true);
  });
});
