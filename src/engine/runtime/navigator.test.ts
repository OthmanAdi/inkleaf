import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { FigureModule } from '../contracts';
import type { TourControl } from './deps';
import { createNavigator, type NavigatorHooks, type RuntimeShared } from './navigator';
import { createProgress } from './progress';
import { createRuntime } from './runtime';
import { fakeBook, fakeEngine, fakeFigure, fakeLayout, fakePop, fakeSound, worldManifest } from './test-fakes';
import type { LessonRuntime } from './types';
import { loadWorld } from './world';

const fig: FigureModule = () => ({ update: () => {}, glowObjects: () => [] });
const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
};

interface FakeRt extends LessonRuntime {
  liveFlag: boolean;
  busyFlag: boolean;
}

function fakeRuntime(spread: number, log: string[]): FakeRt {
  const rt = {
    n: spread - 1, spread, id: `lesson-${spread - 1}`, liveFlag: false, busyFlag: false, flapObject: () => null,
    get live() { return rt.liveFlag; },
    busy: () => rt.busyFlag,
    prepare: () => void log.push(`rt${spread}.prepare`),
    arrive: () => void log.push(`rt${spread}.arrive`),
    leave: (o?: { instant?: boolean }) => {
      log.push(`rt${spread}.leave${o?.instant ? ':instant' : ''}`);
      return Promise.resolve();
    },
    update: () => {},
    setActive: () => {},
    cancelDrag: () => void log.push(`rt${spread}.cancelDrag`),
    framePose: (pos: readonly number[], look: readonly number[], fov: number) => ({ pos: new Vector3(...pos), look: new Vector3(...look), fov }),
    setPredict: (i: number | null) => void log.push(`rt${spread}.predict:${i}`),
    setSwitch: (id: string, v: string | number) => {
      log.push(`rt${spread}.switch:${id}:${v}`);
      return true;
    },
    toggleFlap: () => void log.push(`rt${spread}.flap`),
    dispose: () => void log.push(`rt${spread}.dispose`),
  };
  return rt as unknown as FakeRt;
}

function fakeTour(log: string[]): TourControl & { running: boolean } {
  const t = {
    running: false,
    paused: false,
    start: () => {
      t.running = true;
      log.push('tour.start');
    },
    stop: () => {
      t.running = false;
      log.push('tour.stop');
    },
  };
  return t;
}

function setup(o: { hash?: string; search?: string; aspect?: number; hooks?: NavigatorHooks; layout?: boolean } = {}) {
  const log: string[] = [];
  const { engine, step } = fakeEngine(log);
  engine.camera.aspect = o.aspect ?? 16 / 9;
  const book = fakeBook(log);
  const sound = fakeSound(log);
  const progress = createProgress('nav', { storage: null, bookmark: 2 });
  const world = loadWorld(worldManifest(), { ramp: fig, spring: fig });
  let clock = 0;
  const rts = new Map<number, FakeRt>();
  const tour = fakeTour(log);
  const loc = { hash: o.hash ?? '', search: o.search ?? '', pathname: '/book/' };
  const urls: string[] = [];
  const opened: string[] = [];
  const nav = createNavigator(engine, {
    world, book, sound, progress, tour,
    makeRuntime: (k) => {
      const rt = fakeRuntime(k, log);
      rts.set(k, rt);
      return rt;
    },
    camera: { hold: (pose, until) => void log.push(`camera.hold:${pose ? `${pose.pos.toArray().join(',')}` : 'null'}${until ? `:${until}` : ''}`) },
    hooks: {
      cleanup: () => void log.push('hooks.cleanup'),
      arrived: (info) => void log.push(`arrived:${info.k}`),
      ready: () => void log.push('ready'),
      open: (url) => void opened.push(url),
      ...o.hooks,
    },
    layout: o.layout ? { regions: () => [] } : undefined,
    location: loc,
    history: { replaceState: (_d, _u, url) => void urls.push(url ?? '') },
    now: () => clock,
    idle: () => {},
  });
  const frame = (ms = 1000 / 60) => {
    clock += ms;
    step(ms / 1000);
  };
  const until = (ms: number) => {
    while (clock < ms) frame();
  };
  const land = async () => {
    await nav.start();
    until(1700);
    until(2200);
    await flush();
    book.finishTurn();
    await flush();
  };
  return { log, engine, book, sound, progress, world, nav, rts, tour, urls, opened, loc, frame, until, land, clock: () => clock };
}

describe('navigator: opening', () => {
  it('passes the ready gate after 4 frames and 1.6 s, opens 0.45 s later with a riffle, then holds the hero pose for 7.8 s', async () => {
    const { nav, log, book, until, frame, progress, clock } = setup();
    await nav.start();
    expect(log).toContain('rt2.prepare');
    expect(book.calls).toContain('ribbon:2');
    until(1580);
    expect(log).not.toContain('ready');
    until(1600);
    expect(log).toContain('ready');
    const readyAt = clock();
    while (clock() <= readyAt + 450) frame();
    await flush();
    expect(book.calls).toContain('goTo:2:1.1');
    expect(log.filter((l) => l === 'sound:riffle')).toHaveLength(1);
    expect(nav.landing).toBe(true);
    book.finishTurn();
    await flush();
    expect(nav.landing).toBe(false);
    expect(nav.k).toBe(2);
    expect(log).toContain('rt2.arrive');
    const hold = log.find((l) => l.startsWith('camera.hold:') && !l.includes('null'))!;
    expect(hold).toBe(`camera.hold:100,188,250:${clock() + 7800}`);
    expect(nav.heroActive).toBe(true);
    expect(progress.data.bookmark).toBeNull();
  });

  it('skips the opening on input: instant jump, no hero, bookmark untouched', async () => {
    const { nav, log, book, progress } = setup();
    await nav.start();
    expect(nav.skip()).toBe(true);
    await flush();
    expect(book.calls).toContain('goTo:2:instant');
    expect(nav.k).toBe(2);
    expect(log.some((l) => l.startsWith('camera.hold:1'))).toBe(false);
    expect(progress.data.bookmark).toBeNull();
    expect(nav.skip()).toBe(false);
  });

  it('turns a step during the opening into a skip', async () => {
    const { nav, book } = setup();
    await nav.start();
    await nav.step(1);
    await flush();
    expect(book.calls).toContain('goTo:2:instant');
  });

  it('follows a deep link at boot without the opening or the hero hold, and clears the hash', async () => {
    const { nav, book, urls, until, log } = setup({ hash: '#quiz' });
    await nav.start();
    await flush();
    expect(book.calls).toContain('goTo:4:instant');
    expect(urls).toEqual(['/book/']);
    until(3000);
    expect(book.calls.filter((c) => c.startsWith('goTo'))).toEqual(['goTo:4:instant']);
    expect(log.some((l) => l.startsWith('camera.hold:1'))).toBe(false);
  });

  it('skips the hero hold on portrait screens', async () => {
    const { land, log } = setup({ aspect: 0.6 });
    await land();
    expect(log.some((l) => l.startsWith('camera.hold:1'))).toBe(false);
  });
});

describe('navigator: turns', () => {
  it('cleans up in order, sinks the leaving lesson, then turns and arrives', async () => {
    const { land, nav, log, tour, rts } = setup();
    await land();
    tour.running = true;
    log.length = 0;
    void nav.goTo(3);
    await flush();
    expect(log).toEqual([
      'tour.stop', 'camera.hold:null', 'rt2.cancelDrag', 'hooks.cleanup', 'event:leave:{"spread":2}',
      'rt3.prepare', 'sound:pageTurn', 'rt2.leave', 'book.goTo:3',
    ]);
    expect(rts.has(3)).toBe(true);
  });

  it('queues requests during a turn (latest wins) and continues from where it landed', async () => {
    const { land, nav, log, book } = setup();
    await land();
    log.length = 0;
    void nav.goTo(3);
    await flush();
    void nav.goTo(4);
    void nav.step(1);
    expect(nav.target).toBe(5);
    void nav.goTo(6);
    expect(nav.target).toBe(6);
    book.finishTurn();
    await flush();
    expect(nav.k).toBe(3);
    expect(log).not.toContain('rt3.arrive');
    expect(log.filter((l) => l.startsWith('book.goTo'))).toEqual(['book.goTo:3', 'book.goTo:6']);
    expect(log.filter((l) => l.startsWith('sound:'))).toEqual(['sound:pageTurn', 'sound:riffle']);
    book.finishTurn();
    await flush();
    expect(nav.k).toBe(6);
    expect(log.filter((l) => l.startsWith('arrived:'))).toEqual(['arrived:6']);
  });

  it('drops a queued request equal to the running target', async () => {
    const { land, nav, book, log } = setup();
    await land();
    log.length = 0;
    void nav.goTo(3);
    await flush();
    void nav.goTo(5);
    void nav.goTo(3);
    book.finishTurn();
    await flush();
    expect(nav.k).toBe(3);
    expect(log.filter((l) => l.startsWith('book.goTo'))).toEqual(['book.goTo:3']);
  });

  it('moves the bookmark on user navigation and repaints the contents page', async () => {
    const { land, nav, book, progress, world } = setup();
    await land();
    void nav.goTo(3);
    await flush();
    book.finishTurn();
    await flush();
    expect(progress.bookmark).toBe(3);
    expect(world.pageState.bookmark).toBe(3);
    expect(book.calls).toContain('invalidate:1:right');
  });

  it('jumps instantly in still mode with an instant leave', async () => {
    const { land, nav, engine, log } = setup();
    await land();
    engine.setStill(true);
    log.length = 0;
    await nav.goTo(5);
    expect(log).toContain('rt2.leave:instant');
    expect(log).toContain('book.goTo:5:instant');
    expect(log.some((l) => l.startsWith('sound:'))).toBe(false);
  });
});

describe('navigator: tours', () => {
  it('starts the first-visit tour 0.9 s after the figure is live and idle, and cancels the hero hold', async () => {
    const { land, rts, frame, log, progress, clock } = setup();
    await land();
    const rt = rts.get(2)!;
    frame();
    expect(log).not.toContain('tour.start');
    rt.liveFlag = true;
    rt.busyFlag = true;
    for (let i = 0; i < 120; i++) frame();
    expect(log).not.toContain('tour.start');
    rt.busyFlag = false;
    frame();
    const armed = clock();
    while (clock() + 1000 / 60 <= armed + 900) frame();
    expect(log).not.toContain('tour.start');
    frame();
    frame();
    expect(log).toContain('tour.start');
    expect(progress.watched(1)).toBe(true);
    expect(log.indexOf('camera.hold:null')).toBeLessThan(log.indexOf('tour.start'));
  });

  it('arms only on the first visit and refuses tours in still mode', async () => {
    const { land, nav, rts, engine, log, book, frame } = setup();
    await land();
    rts.get(2)!.liveFlag = true;
    void nav.goTo(3);
    await flush();
    book.finishTurn();
    await flush();
    void nav.goTo(2);
    await flush();
    book.finishTurn();
    await flush();
    for (let i = 0; i < 120; i++) frame();
    expect(log).not.toContain('tour.start');
    engine.setStill(true);
    expect(nav.startTour()).toBe(false);
  });
});

describe('navigator: page actions', () => {
  it('routes lesson actions to the open runtime after stopping a tour', async () => {
    const { land, nav, log, tour } = setup();
    await land();
    tour.running = true;
    log.length = 0;
    expect(nav.handleAction('predict:1')).toBe(true);
    expect(nav.handleAction('switch:friction:on')).toBe(true);
    expect(nav.handleAction('flap')).toBe(true);
    expect(log).toEqual(['tour.stop', 'rt2.predict:1', 'rt2.switch:friction:on', 'rt2.flap']);
    expect(nav.handleAction('nonsense')).toBe(false);
  });

  it('stores the spread in the URL before leaving for a source', async () => {
    const { land, nav, opened, urls } = setup();
    await land();
    nav.handleAction('source:2');
    expect(urls.at(-1)).toBe('/book/#spread-1');
    expect(opened).toEqual(['https://data.example.com/springs']);
  });

  it('picks quiz answers, lifts flaps, stamps 0.35 s after the last lift and clears the quiz when leaving it', async () => {
    let complete = 0;
    const { land, nav, book, sound, world } = setup({ hooks: { quizComplete: () => void complete++ } });
    await land();
    void nav.goTo(4);
    await flush();
    book.finishTurn();
    await flush();
    nav.handleAction('quiz:0:1');
    nav.handleAction('quiz:1:1');
    nav.handleAction('quiz:1:1');
    nav.handleAction('quiz:2:1');
    expect([...world.pageState.quizPicks]).toEqual([[0, 1], [2, 1]]);
    expect(sound.played.filter((p) => p.name === 'pen')).toHaveLength(4);
    for (const q of [0, 1, 2]) nav.handleAction(`quiz-flap:${q}`);
    expect(world.pageState.quizOpen.size).toBe(3);
    expect(nav.quizScore()).toEqual({ right: 2, picked: 2, checked: 3, of: 3, complete: true });
    expect(sound.played.find((p) => p.name === 'stamp')?.opts).toEqual({ delay: 0.35 });
    expect(complete).toBe(1);
    expect(book.calls).toContain('invalidate:4:right');
    void nav.goTo(5);
    await flush();
    expect(world.pageState.quizPicks.size).toBe(0);
    expect(world.pageState.quizChecked.size).toBe(0);
  });

  it('starts again after confirmation: progress cleared, runtimes rebuilt, pages repainted, ribbon home', async () => {
    const { land, nav, log, progress, book, world } = setup({ hooks: { confirmReset: () => true } });
    await land();
    progress.stamp(1);
    world.pageState.stamps.add(1);
    log.length = 0;
    nav.handleAction('reset');
    await flush();
    expect(progress.stamped(1)).toBe(false);
    expect(world.pageState.stamps.size).toBe(0);
    expect(log).toEqual(expect.arrayContaining(['rt2.dispose', 'rt2.prepare', 'rt2.arrive']));
    expect(log.indexOf('rt2.dispose')).toBeLessThan(log.indexOf('rt2.prepare'));
    expect(book.calls).toContain('invalidate:6:right');
    expect(book.calls.at(-1)).toBe('ribbon:2');
  });

  it('turns on hash changes after the opening and clears the hash', async () => {
    const { land, nav, book, loc, urls } = setup();
    await land();
    book.calls.length = 0;
    loc.hash = '#contents';
    nav.hashChanged();
    await flush();
    expect(book.calls).toContain('goTo:1:1.15');
    expect(urls.at(-1)).toBe('/book/');
    loc.hash = '#nowhere';
    nav.hashChanged();
    expect(urls).toHaveLength(1);
  });
});

describe('navigator with real runtimes', () => {
  it('sinks a live lesson for 0.5 s before the turn, and peels the next one when the turn ends', async () => {
    const log: string[] = [];
    const { engine, step } = fakeEngine(log);
    const book = fakeBook(log);
    const sound = fakeSound(log);
    const progress = createProgress('real', { storage: null });
    const world = loadWorld(worldManifest(), { ramp: fakeFigure().figure, spring: fakeFigure().figure });
    let clock = 0;
    const nav = createNavigator(engine, {
      world, book, sound, progress, location: { hash: '#spread-1', search: '?nowatch', pathname: '/' }, history: null, now: () => clock, idle: () => {},
      makeRuntime: (k, shared: RuntimeShared) => createRuntime(engine, {
        book, sound, progress, spread: k, lesson: world.spreads[k]!.lesson!, figure: world.spreads[k]!.figure!, quantities: world.quantities,
        createPop: (_e, init) => fakePop(init, 1.45), layout: fakeLayout(k), ...shared,
      }),
    });
    const frame = () => {
      clock += 1000 / 60;
      step(1 / 60);
    };
    await nav.start();
    await flush();
    expect(nav.k).toBe(2);
    expect(nav.current!.state).toBe('peel');
    for (let i = 0; i < 120; i++) frame();
    expect(nav.current!.live).toBe(true);

    void nav.step(1);
    await flush();
    expect(nav.runtime(2)!.state).toBe('undraw');
    let frames = 0;
    while (!book.calls.includes('goTo:3:1.15')) {
      frame();
      await flush();
      frames++;
    }
    expect(frames).toBeGreaterThanOrEqual(30);
    expect(frames).toBeLessThanOrEqual(31);
    expect(nav.runtime(3)!.state).toBe('print');
    for (let i = 0; i < 10; i++) frame();
    expect(nav.runtime(3)!.state).toBe('print');
    book.finishTurn();
    await flush();
    expect(nav.runtime(3)!.state).toBe('peel');
    expect(sound.loops.map((l) => l.name)).toEqual(['pen', 'pen']);

    void nav.goTo(1);
    await flush();
    while (!book.calls.includes('goTo:1:1.15')) {
      frame();
      await flush();
    }
    book.finishTurn();
    await flush();
    expect(nav.k).toBe(1);
    void nav.goTo(2);
    await flush();
    expect(book.calls.at(-1)).toBe('goTo:2:1.15');
  });
});
