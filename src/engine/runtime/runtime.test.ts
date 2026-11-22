import { describe, expect, it } from 'vitest';
import { Vector2, Vector3 } from 'three';
import { LAYERS } from '../contracts';
import { createProgress } from './progress';
import { createRuntime } from './runtime';
import { fakeBook, fakeEngine, fakeFigure, fakeLayout, fakePop, fakeSound, lessonSpec, type FakePop } from './test-fakes';
import { createPageState, createSession, type RuntimeFlags } from './types';

const FLAGS: RuntimeFlags = { still: false, paused: false, touring: false };

function setup(opts: { stamped?: boolean } = {}) {
  const log: string[] = [];
  const { engine } = fakeEngine(log);
  const book = fakeBook(log);
  book.openSpreadValue = 3;
  const sound = fakeSound(log);
  const progress = createProgress('t', { storage: null });
  if (opts.stamped) progress.stamp(1);
  const { figure, probe } = fakeFigure();
  const pageState = createPageState(2);
  const session = createSession();
  let pop!: FakePop;
  const stampChanges: string[] = [];
  const bloom: string[] = [];
  const rt = createRuntime(engine, {
    book, figure, lesson: lessonSpec(), spread: 3, quantities: [{ id: 'kinetic', label: 'Kinetic', color: '#2f7bff' }], sound, progress,
    createPop: (_e, init) => (pop = fakePop(init, 1.45)),
    post: { bloomSelect: (o, on) => void bloom.push(`${o.uuid === probe.glow.uuid ? 'glow' : '?'}:${on}`) },
    layout: fakeLayout(3), session, pageState,
    onStampChange: (n, on) => void stampChanges.push(`${n}:${on}`),
  });
  const run = (seconds: number, flags: RuntimeFlags = FLAGS, dt = 1 / 60) => {
    for (let t = 0; t < seconds - 1e-9; t += dt) rt.update(dt, flags);
  };
  return { log, engine, book, sound, progress, probe, pageState, session, pop, rt, run, stampChanges, bloom };
}

describe('lesson runtime', () => {
  it('creates the pop with the frame, print window and cab, and wires glow, slots and registry', () => {
    const { pop, probe, bloom, engine, book } = setup();
    expect(pop.init.printRect).toEqual({ x0: -10, x1: 170, y0: -4, y1: 196 });
    expect(pop.init.pxPerMm).toBe(6);
    expect(pop.init.cab).toEqual([0.12, 0.32]);
    expect(new Vector3().setFromMatrixPosition(pop.init.frame).toArray().map((v) => +v.toFixed(6))).toEqual([20, 0.05, 87]);
    expect(pop.group.parent).toBe(engine.scene);
    expect(probe.glow.layers.isEnabled(LAYERS.glow)).toBe(true);
    expect(bloom).toEqual(['glow:true']);
    expect(book.slots.get('3l')).toBeDefined();
    expect(probe.ctx!.quantity('kinetic')?.hex).toBe('#2f7bff');
    expect(probe.ctx!.switches).toEqual({ friction: 'off' });
    probe.ctx!.register('ball', 'Ball', ['object'], probe.target, 'The ball.');
    expect(engine.registry.get('lesson-1.ball')?.tags).toEqual(['object', 'lesson', 'figure']);
    expect(engine.registry.get('lesson-1')?.params.map((p) => p.key)).toEqual(['predict', 'flap', 'stamp', 'state', 'friction']);
  });

  it('runs prepare -> arrive -> peel -> shade -> live -> challenge met -> stamp', () => {
    const { rt, pop, probe, sound, book, progress, log, stampChanges, pageState, run } = setup();
    rt.prepare();
    expect(probe.log[0]).toBe('update:0:flat:paused');
    expect(pop.prints).toBe(1);
    expect(rt.state).toBe('print');
    expect(log).toContain('slot3r.setPrint:tex:10,16,180,200:1');

    rt.arrive();
    expect(rt.state).toBe('peel');
    expect(sound.loops.map((l) => l.name)).toEqual(['pen']);
    expect(progress.visited(1)).toBe(true);

    run(0.1);
    expect(book.slots.get('3r')!.printAlpha).toBeLessThan(1);
    expect(sound.loops[0]!.stops).toEqual([]);
    run(1.4);
    expect(rt.state).toBe('shade');
    expect(sound.loops[0]!.stops).toEqual([0.12]);
    run(0.5);
    expect(rt.live).toBe(true);
    expect(probe.log.filter((l) => l === 'onLive')).toHaveLength(1);
    expect(log.some((l) => l.startsWith('event:live:'))).toBe(true);
    expect(rt.lightSources()).toHaveLength(1);

    probe.margin = [{ text: 'Ep = m g h' }];
    run(0.1);
    expect(rt.marginLines()).toEqual([{ text: 'Ep = m g h' }]);

    probe.met = true;
    rt.update(1 / 60, FLAGS);
    expect(rt.stamped).toBe(true);
    expect(progress.stamped(1)).toBe(true);
    expect(pageState.stamps.has(1)).toBe(true);
    expect(sound.played.map((p) => p.name)).toContain('stamp');
    expect(stampChanges).toEqual(['1:true']);
    expect(rt.stampPress).toBeGreaterThan(0);
    expect(rt.stampPress).toBeLessThan(0.1);
    run(0.2);
    expect(rt.stampPress).toBeCloseTo(0.001 + (0.2 + 1 / 60) / 0.35, 2);
    run(0.2);
    expect(rt.stampPress).toBe(1);
    rt.update(1 / 60, FLAGS);
    expect(sound.played.filter((p) => p.name === 'stamp')).toHaveLength(1);
  });

  it('does not stamp during a tour and pauses the figure clock while the tour is paused', () => {
    const { rt, probe, run } = setup();
    rt.prepare();
    rt.arrive();
    run(2.1);
    probe.met = true;
    run(0.1, { still: false, paused: false, touring: true });
    expect(rt.stamped).toBe(false);
    probe.log.length = 0;
    rt.update(0.016, { still: false, paused: true, touring: true });
    expect(probe.log[0]).toBe('update:0:live:paused');
  });

  it('starts as stamped from saved progress', () => {
    const { rt, pageState } = setup({ stamped: true });
    expect(rt.stamped).toBe(true);
    expect(rt.stampPress).toBe(1);
    expect(pageState.stamps.has(1)).toBe(true);
  });

  it('forces the figure live on a press during the peel without the first-live event', () => {
    const { rt, probe, session, run } = setup();
    rt.prepare();
    rt.arrive();
    run(0.3);
    expect(rt.targets()).toEqual([]);
    expect(rt.targets(true)).toEqual([probe.target]);
    const r = rt.press({ object: probe.target, point: new Vector3(40, 10, 60), ndc: new Vector2(0, 0) });
    expect(r).toBe('drag');
    expect(rt.live).toBe(true);
    expect(rt.forcedLive).toBe(true);
    expect(session.liveSeen.has(3)).toBe(true);
    expect(probe.log).toContain('press:20,10,-27');
    run(0.5);
    expect(probe.log).not.toContain('onLive');
    expect(rt.dragging).toBe(true);
    rt.cancelDrag();
    expect(rt.dragging).toBe(false);
    expect(probe.log).toContain('release');
  });

  it('skips the peel and the pen loop in still mode', () => {
    const { rt, sound, probe, engine, run } = setup();
    rt.prepare();
    engine.setStill(true);
    rt.arrive();
    expect(sound.loops).toHaveLength(0);
    run(1 / 60, { still: true, paused: false, touring: false });
    expect(rt.live).toBe(true);
    expect(probe.log).not.toContain('onLive');
  });

  it('toggles predictions and switches with a pen tick and restores switches after a tour', () => {
    const { rt, sound, probe, engine } = setup();
    rt.setPredict(1);
    expect(rt.predict).toBe(1);
    rt.setPredict(1);
    expect(rt.predict).toBeNull();
    rt.setPredict(7);
    expect(rt.predict).toBeNull();
    expect(sound.played.filter((p) => p.name === 'pen')).toHaveLength(2);
    expect(sound.played[0]!.opts).toEqual({ gain: 1.4, len: 0.5 });

    expect(rt.setSwitch('friction', 'on')).toBe(true);
    expect(rt.setSwitch('friction', 'sideways')).toBe(false);
    expect(rt.setSwitch('nope', 0)).toBe(false);
    expect(rt.switches.friction).toBe('on');
    expect(probe.ctx!.switches.friction).toBe('on');
    engine.registry.set('lesson-1', 'friction', 'off');
    expect(rt.switches.friction).toBe('off');
    rt.restoreAfterTour();
    expect(probe.log.slice(-2)).toEqual(['resetTour', 'switch:friction:off:restore']);
  });

  it('lifts the flap with a sound, records the first lift and repaints the left page while it is up', () => {
    const { rt, sound, progress, book, pageState, run } = setup();
    rt.toggleFlap();
    expect(rt.flapOpen).toBe(true);
    expect(sound.played.map((p) => p.name)).toEqual(['flap']);
    expect(progress.data.flaps['1']).toBeDefined();
    rt.update(1 / 60, FLAGS);
    expect(pageState.flapsOpen.has(3)).toBe(true);
    expect(book.calls).toContain('invalidate:3:left');
    rt.toggleFlap(false);
    run(0.2);
    expect(rt.flapAmount).toBeCloseTo((1 - Math.exp(-7 / 60)) * Math.exp(-7 * 0.2), 3);
    run(1);
    expect(pageState.flapsOpen.has(3)).toBe(false);
  });

  it('sinks back into the print on leave and at once when instant', async () => {
    const { rt, probe, run } = setup();
    rt.prepare();
    rt.arrive();
    run(2.1);
    let done = false;
    const p = rt.leave().then(() => (done = true));
    expect(probe.log).toContain('leave');
    expect(rt.state).toBe('undraw');
    run(0.25);
    await Promise.resolve();
    expect(done).toBe(false);
    run(0.3);
    await p;
    expect(rt.state).toBe('print');
    rt.arrive();
    run(2.1);
    await rt.leave({ instant: true });
    expect(rt.state).toBe('print');
  });

  it('resolves tour shots in the lesson frame', () => {
    const { rt } = setup();
    expect(rt.shotCount).toBe(4);
    const wide = rt.shot(0)!;
    expect(wide.hold).toBe(2);
    expect(wide.cam!.pose!.pos.toArray().map((v) => +v.toFixed(3))).toEqual([108, 270.05, 397]);
    const fixed = rt.shot(1)!;
    expect(fixed.act).toBe('release');
    expect(fixed.cam!.pose!.look.toArray().map((v) => +v.toFixed(3))).toEqual([115, 70.05, -13]);
    const follow = rt.shot(2)!;
    expect(follow.cam!.follow!()!.toArray()).toEqual([1, 2, 3]);
    expect(follow.cam!.offset!.toArray().map((v) => +v.toFixed(3))).toEqual([10, 24, 60]);
    expect(rt.shot(3)!.cam).toBeNull();
    expect(rt.shot(9)).toBeNull();
    expect(rt.captions).toEqual(['The track.', 'The jars.', 'Follow the ball.', 'Your turn.']);
    expect(rt.a11y()).toEqual(['A ball on a U-shaped track.', 'A ball on a track.']);
  });

  it('cleans up after itself', () => {
    const { rt, pop, engine, bloom, log } = setup();
    rt.dispose();
    expect(pop.disposed).toBe(true);
    expect(pop.group.parent).toBeNull();
    expect(bloom).toEqual(['glow:true', 'glow:false']);
    expect(engine.registry.list('lesson-1')).toEqual([]);
    expect(log).toContain('slot3r.setPrint:null:0,0,0,0:0');
  });
});
