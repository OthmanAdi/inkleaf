import { describe, expect, it } from 'vitest';
import { defaults } from './params';
import { BOOT_TABLE, RIFFLE_TABLE, TURN_TABLE, TurnClock, planTurns, type TurnParams } from './scheduler';

const P: TurnParams = { turn: defaults(TURN_TABLE), riffle: defaults(RIFFLE_TABLE), boot: defaults(BOOT_TABLE), singleEase: 'inOutCubic', riffleEase: 'inOutQuad' };

const state = (pos: number, n = 14) => {
  const c = new Float64Array(n);
  for (let i = 0; i < n; i++) c[i] = Math.min(1, Math.max(0, pos - i));
  return c;
};
const sum = (c: Float64Array) => c.reduce((a, b) => a + b, 0);

/** Runs a plan from position `from` to `to`, sampling the position at each time in `times` (seconds). */
function run(from: number, to: number, dur: number, times: number[]) {
  const c = state(from);
  const plan = planTurns(c, to, dur, P);
  const clock = new TurnClock();
  const out: number[] = [];
  let t = 0;
  let i = 0;
  const anims = [...plan];
  let current = anims.shift();
  if (current) void clock.start(current, c);
  for (const target of times) {
    while (t < target - 1e-9) {
      const step = Math.min(0.001, target - t);
      clock.update(step, c);
      t += step;
      if (!clock.active && anims.length) void clock.start((current = anims.shift())!, c);
    }
    out.push(sum(c));
    i++;
  }
  return { out, plan };
}

describe('turn plan', () => {
  it('single turn: one leaf, 1.15 s, cubic', () => {
    const plan = planTurns(state(2), 3, 1.15, P);
    expect(plan).toEqual([[{ leaf: 2, to: 1, dur: 1.15, delay: 0, ease: 'inOutCubic' }]]);
    expect(planTurns(state(5), 4, 1.15, P)).toEqual([[{ leaf: 4, to: 0, dur: 1.15, delay: 0, ease: 'inOutCubic' }]]);
  });
  it('cover alone takes 1.25 x duration', () => {
    const plan = planTurns(state(0), 1, 1.15, P);
    expect(plan[0]![0]!.dur).toBeCloseTo(1.4375, 10);
    const back = planTurns(state(3), 0, 1.15, P);
    expect(back.length).toBe(2);
    expect(back[1]).toEqual([{ leaf: 0, to: 0, dur: 1.4375, delay: 0, ease: 'inOutCubic' }]);
  });
  it('boot 0 -> 2: cover 1.1 cubic, leaf 1 0.946 quad after 0.2', () => {
    const [anim] = planTurns(state(0), 2, 1.1, P);
    expect(anim).toEqual([
      { leaf: 0, to: 1, dur: 1.1, delay: 0, ease: 'inOutCubic' },
      { leaf: 1, to: 1, dur: expect.closeTo(0.946, 10), delay: 0.2, ease: 'inOutQuad' },
    ]);
    expect(TurnClock.length(anim!)).toBeCloseTo(1.146, 10);
  });
  it.each([
    [1, 11, 10, 1.315],
    [1, 7, 6, 0.975],
    [1, 14, 13, 1.57],
  ])('jump %d -> %d: %d leaves, 0.55 s each, 0.085 apart, total %d s', (from, to, n, total) => {
    const [anim] = planTurns(state(from), to, 1.15, P);
    expect(anim!.length).toBe(n);
    expect(anim!.every((e) => e.dur === 0.55 && e.ease === 'inOutQuad')).toBe(true);
    expect(anim![1]!.delay).toBeCloseTo(0.085, 10);
    expect(TurnClock.length(anim!)).toBeCloseTo(total, 10);
  });
  it('backward riffle starts with the nearest leaf', () => {
    const [anim] = planTurns(state(9), 4, 1.15, P);
    expect(anim!.map((e) => e.leaf)).toEqual([8, 7, 6, 5, 4]);
    expect(anim!.every((e) => e.to === 0)).toBe(true);
  });
  it('no move when already there', () => {
    expect(planTurns(state(4), 4, 1.15, P)).toEqual([]);
  });
});

describe('turn clock (S2 timing table)', () => {
  it('single forward turn leaf fraction vs time', () => {
    const times = [0.1, 0.2, 0.3, 0.4, 0.5, 0.575, 0.7, 0.8, 0.9, 1.0, 1.15];
    const want = [0.0026, 0.021, 0.071, 0.1683, 0.3288, 0.5, 0.7603, 0.8872, 0.9589, 0.9911, 1];
    const { out } = run(4, 5, 1.15, times);
    out.forEach((p, i) => expect(p - 4).toBeCloseTo(want[i]!, 3));
  });
  it('backward turn is the mirror', () => {
    const { out } = run(5, 4, 1.15, [0.3, 0.575, 0.9]);
    expect(out[0]).toBeCloseTo(5 - 0.071, 3);
    expect(out[1]).toBeCloseTo(4.5, 3);
    expect(out[2]).toBeCloseTo(5 - 0.9589, 3);
  });
  it('jump 1 -> 11 position vs time', () => {
    const times = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.315];
    const want = [1.068, 1.358, 2.018, 2.999, 4.146, 5.322, 6.5, 7.678, 8.837, 9.853, 10.569, 10.907, 11];
    const { out } = run(1, 11, 1.15, times);
    out.forEach((p, i) => expect(p).toBeCloseTo(want[i]!, 2));
  });
  it('boot position vs book time', () => {
    const times = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.146];
    const want = [0.003, 0.024, 0.1035, 0.2817, 0.5768, 0.9819, 1.3631, 1.6513, 1.8407, 1.9494, 1.9953, 2.0];
    const { out } = run(0, 2, 1.1, times);
    out.forEach((p, i) => expect(p).toBeCloseTo(want[i]!, 3));
  });
  it('emits a landing per leaf and resolves when done', async () => {
    const c = state(1);
    const clock = new TurnClock();
    const landed: number[] = [];
    const done = clock.start(planTurns(c, 4, 1.15, P)[0]!, c);
    for (let i = 0; i < 200; i++) clock.update(0.01, c, (leaf) => landed.push(leaf));
    await done;
    expect(landed).toEqual([1, 2, 3]);
    expect(sum(c)).toBe(4);
    expect(clock.active).toBe(false);
  });
});
