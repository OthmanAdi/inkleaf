/**
 * The procedural sound engine. Every cue is rendered once (per parameter change) from its recipe into an AudioBuffer
 * after the first user gesture unlocks audio, then played through one graph: voice -> voice gain -> master gain
 * (0 or 1) -> compressor -> speakers. Playback rules: variants never repeat back to back, small pitch and level
 * jitter (wider when a cue repeats quickly), voice limits per cue and overall, a 2 ms attack, tails for truncated
 * clips, looping cues with equal-power layer crossfades. Sound is off until the user turns it on.
 */
import type { SoundApi, SoundLoop, SoundName } from '../contracts';
import type { Registry } from '../core/registry';
import { tunable, type Tuned } from '../core/tune';
import { RECIPES, defaults, type CueParams, type CueRecipe } from './recipes';

export interface PlayOptions {
  gain?: number;
  rate?: number;
  variant?: number;
  /** Seconds from now. */
  delay?: number;
  /** Truncate the clip to this many seconds with a short tail (a looping cue played once defaults to `oneShotLen`). */
  len?: number;
}

export interface SoundEngine extends SoundApi {
  play(name: SoundName, opts?: PlayOptions): void;
  /** Mutes the master without touching the user's preference (a paused tour holds sound). */
  hold(on: boolean): void;
  readonly held: boolean;
  /** Fades every voice and loop out in 50 ms. */
  stopAll(): void;
  /** The rendered samples of a cue variant at the given rate (renders on demand; used by the sound board). */
  samples(name: SoundName, variant?: number, sampleRate?: number): Float32Array;
  readonly context: AudioContext | null;
  /** Called with the enabled state whenever it changes. */
  onChange(fn: (enabled: boolean) => void): () => void;
  dispose(): void;
}

const ENGINE_PARAMS = {
  master: { value: 1, min: 0, max: 2, step: 0.01, help: 'Master level while sound is on' },
  masterTau: { value: 0.03, min: 0.001, max: 0.5, step: 0.001, unit: 's', help: 'Time constant of the master on/off fade' },
  suspendDelay: { value: 0.2, min: 0, max: 2, step: 0.01, unit: 's', help: 'Audio context suspends this long after sound is turned off' },
  compThreshold: { value: -1, min: -40, max: 0, step: 0.5, unit: 'dB', help: 'Compressor threshold' },
  compKnee: { value: 0, min: 0, max: 40, step: 1, unit: 'dB', help: 'Compressor knee' },
  compRatio: { value: 20, min: 1, max: 20, step: 0.5, help: 'Compressor ratio' },
  compAttack: { value: 0.001, min: 0, max: 0.1, step: 0.001, unit: 's', help: 'Compressor attack' },
  compRelease: { value: 0.1, min: 0.01, max: 1, step: 0.01, unit: 's', help: 'Compressor release' },
  variation: { value: true, help: 'Random pitch and level jitter per play' },
  cents: { value: 30, min: 0, max: 200, step: 1, unit: 'cents', help: 'Pitch jitter range (plus or minus)' },
  centsRecent: { value: 55, min: 0, max: 200, step: 1, unit: 'cents', help: 'Pitch jitter when the same cue played under 0.25 s ago' },
  levelJitter: { value: 1.2, min: 0, max: 12, step: 0.1, unit: 'dB', help: 'Level jitter range (plus or minus)' },
  levelJitterRecent: { value: 2.2, min: 0, max: 12, step: 0.1, unit: 'dB', help: 'Level jitter for quick repeats' },
  doubleCut: { value: 3, min: 0, max: 24, step: 0.5, unit: 'dB', help: 'Level cut when the same cue starts twice within 30 ms' },
  recentWindow: { value: 0.25, min: 0, max: 2, step: 0.01, unit: 's', help: 'A repeat within this time counts as recent' },
  doubleWindow: { value: 0.03, min: 0, max: 0.5, step: 0.005, unit: 's', help: 'A repeat within this time counts as a double' },
  voicesPerCue: { value: 6, min: 1, max: 32, step: 1, help: 'Most voices of one cue at once (the oldest fades out)' },
  voicesTotal: { value: 24, min: 1, max: 64, step: 1, help: 'Most voices overall' },
  stealFade: { value: 0.03, min: 0.001, max: 0.5, step: 0.001, unit: 's', help: 'Fade of a stolen voice' },
  attack: { value: 0.002, min: 0, max: 0.1, step: 0.001, unit: 's', help: 'Linear fade-in of every voice' },
  tail: { value: 0.08, min: 0.005, max: 0.5, step: 0.005, unit: 's', help: 'Longest fade-out of a truncated or looped one-shot' },
  stopFade: { value: 0.06, min: 0.005, max: 1, step: 0.005, unit: 's', help: 'Fade when a voice is stopped' },
  loopIn: { value: 0.025, min: 0.001, max: 1, step: 0.001, unit: 's', help: 'Time constant of a loop fading in' },
  loopSet: { value: 0.04, min: 0.001, max: 1, step: 0.001, unit: 's', help: 'Time constant of loop gain and rate changes' },
  loopStop: { value: 0.08, min: 0.005, max: 2, step: 0.005, unit: 's', help: 'Default fade when a loop stops' },
  oneShotLen: { value: 0.5, min: 0.05, max: 3, step: 0.01, unit: 's', help: 'Length when a looping cue is played once (pen tick)' },
} as const;

type EngineCfg = Tuned<typeof ENGINE_PARAMS>;

/** Picks a variant: the requested one, else a random one that differs from the last. */
export function pickVariant(count: number, last: number, rnd: () => number, requested?: number): number {
  if (requested !== undefined) return ((Math.floor(requested) % count) + count) % count;
  if (count <= 1) return 0;
  const v = Math.floor(rnd() * (count - 1));
  return last >= 0 && v >= last ? v + 1 : v;
}

/** Pitch and level jitter for one play: returns the playback rate factor and the gain factor. */
export function jitter(cfg: Pick<EngineCfg, 'variation' | 'cents' | 'centsRecent' | 'levelJitter' | 'levelJitterRecent' | 'doubleCut'>, recent: boolean, double: boolean, rnd: () => number): { rate: number; gain: number } {
  if (!cfg.variation) return { rate: 1, gain: double ? Math.pow(10, -cfg.doubleCut / 20) : 1 };
  const cents = (rnd() * 2 - 1) * (recent ? cfg.centsRecent : cfg.cents);
  const db = (rnd() * 2 - 1) * (recent ? cfg.levelJitterRecent : cfg.levelJitter) - (double ? cfg.doubleCut : 0);
  return { rate: Math.pow(2, cents / 1200), gain: Math.pow(10, db / 20) };
}

/** Equal-power layer gains of a layered loop: `mix` defaults to smoothstep((g - 0.35) / 0.55). */
export function layerGains(gain: number, mix?: number): [number, number] {
  const x = Math.min(1, Math.max(0, (gain - 0.35) / 0.55));
  const m = mix ?? x * x * (3 - 2 * x);
  return [gain * Math.cos((m * Math.PI) / 2), gain * Math.sin((m * Math.PI) / 2)];
}

/** The tail of a truncated voice: fade starts `min(tail, T / (3 rate))` before the end. */
export const tailLength = (T: number, rate: number, tail: number) => Math.min(tail, T / (3 * rate));

interface Voice { cue: SoundName; src: AudioBufferSourceNode; gain: GainNode; t0: number; done: boolean }

interface LoopState extends SoundLoop {
  name: SoundName;
  gain: number;
  rate: number;
  layer?: number;
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
  stopped: boolean;
  start(): void;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function createSound(registry: Registry, opts: { enabled?: boolean; autoUnlock?: boolean; random?: () => number } = {}): SoundEngine {
  const rnd = opts.random ?? Math.random;
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let comp: DynamicsCompressorNode | null = null;
  let enabled = opts.enabled ?? false;
  let held = false;
  const buffers = new Map<string, AudioBuffer>();
  const samplesCache = new Map<string, Float32Array>();
  const cfg: EngineCfg = tunable(registry, {
    id: 'sound.engine', label: 'Sound engine', kind: 'sound-engine', tags: ['sound'],
    describe: 'Procedural sound playback: master on/off, compressor, jitter, voice limits, envelopes and loop fades. Sound is off by default; the first pointer press unlocks audio.',
    source: 'src/engine/sound/engine.ts',
    params: ENGINE_PARAMS,
    onChange: (k) => {
      if (k.startsWith('comp')) applyCompressor();
      if (k === 'master') applyMaster();
    },
  });

  const cueCfg = new Map<SoundName, Record<string, number>>();
  for (const rec of RECIPES) {
    const t = tunable(registry, {
      id: `sound.${rec.id}`, label: rec.label, kind: rec.loop ? 'sound-loop' : 'sound-cue', tags: ['sound'],
      describe: `${rec.describe} ${rec.variants > 1 ? (rec.layers ? `Layers: ${rec.layers.join(', ')}.` : `${rec.variants} variants.`) : ''}`.trim(),
      source: 'src/engine/sound/recipes.ts',
      params: rec.params,
      onChange: (k) => {
        if (k === 'gain') return;
        for (const key of [...buffers.keys()]) if (key.startsWith(rec.name + ':')) buffers.delete(key);
        for (const key of [...samplesCache.keys()]) if (key.startsWith(rec.name + ':')) samplesCache.delete(key);
      },
    });
    cueCfg.set(rec.name, t as unknown as Record<string, number>);
  }
  const recipeOf = new Map<SoundName, CueRecipe>(RECIPES.map((r) => [r.name, r]));

  let suspendTimer: ReturnType<typeof setTimeout> | null = null;
  let warmTimer: ReturnType<typeof setTimeout> | null = null;
  const voices: Voice[] = [];
  const loops = new Set<LoopState>();
  const last = new Map<SoundName, { t: number; variant: number }>();
  const listeners = new Set<(on: boolean) => void>();

  const params = (name: SoundName): CueParams => {
    const t = cueCfg.get(name);
    const out: CueParams = { ...defaults(recipeOf.get(name)!) };
    if (t) for (const k of Object.keys(out)) out[k] = Number(t[k]);
    return out;
  };

  function samples(name: SoundName, variant = 0, sampleRate = ctx?.sampleRate ?? 48000): Float32Array {
    const rec = recipeOf.get(name)!;
    const key = `${name}:${variant}:${sampleRate}`;
    let s = samplesCache.get(key);
    if (!s) {
      s = rec.render(sampleRate, params(name), variant);
      samplesCache.set(key, s);
    }
    return s;
  }

  function buffer(name: SoundName, variant: number): AudioBuffer | null {
    if (!ctx) return null;
    const key = `${name}:${variant}`;
    let b = buffers.get(key);
    if (!b) {
      const data = samples(name, variant, ctx.sampleRate);
      b = ctx.createBuffer(1, data.length, ctx.sampleRate);
      b.getChannelData(0).set(data);
      buffers.set(key, b);
    }
    return b;
  }

  function applyCompressor(): void {
    if (!comp || !ctx) return;
    const t = ctx.currentTime;
    comp.threshold.setValueAtTime(cfg.compThreshold, t);
    comp.knee.setValueAtTime(cfg.compKnee, t);
    comp.ratio.setValueAtTime(cfg.compRatio, t);
    comp.attack.setValueAtTime(cfg.compAttack, t);
    comp.release.setValueAtTime(cfg.compRelease, t);
  }

  function applyMaster(): void {
    if (!master || !ctx) return;
    master.gain.setTargetAtTime(enabled && !held ? cfg.master : 0, ctx.currentTime, cfg.masterTau);
  }

  function resume(): void {
    if (ctx && enabled && ctx.state === 'suspended') void ctx.resume().catch(() => undefined);
  }

  /** Renders every cue in the background, one per slice, so the first play of each is instant. */
  function warm(): void {
    const queue: [SoundName, number][] = [];
    for (const r of RECIPES) for (let v = 0; v < r.variants; v++) queue.push([r.name, v]);
    const step = () => {
      const item = queue.shift();
      if (!item || !ctx) return;
      buffer(item[0], item[1]);
      warmTimer = setTimeout(step, 0);
    };
    warmTimer = setTimeout(step, 0);
  }

  function unlock(): void {
    if (ctx) {
      resume();
      return;
    }
    const AC: typeof AudioContext | undefined = (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext
      ?? (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });
    master = ctx.createGain();
    master.gain.value = 0;
    comp = ctx.createDynamicsCompressor();
    applyCompressor();
    master.connect(comp).connect(ctx.destination);
    applyMaster();
    if (!enabled) void ctx.suspend().catch(() => undefined);
    for (const l of loops) if (!l.stopped && !l.sources.length) l.start();
    warm();
  }

  function fadeVoice(v: Voice, fade: number): void {
    if (v.done || !ctx) return;
    v.done = true;
    const t = ctx.currentTime;
    v.gain.gain.cancelScheduledValues(t);
    v.gain.gain.setValueAtTime(v.gain.gain.value, t);
    v.gain.gain.linearRampToValueAtTime(0, t + fade);
    try {
      v.src.stop(t + fade + 0.01);
    } catch {
      /* already stopped */
    }
  }

  function play(name: SoundName, o: PlayOptions = {}): void {
    const rec = recipeOf.get(name);
    if (!rec || rec.layers || !ctx || !master || !enabled || held) return;
    const cue = cueCfg.get(name)!;
    const gain = (o.gain ?? 1) * cue.gain!;
    if (gain <= 0) return;
    const now = ctx.currentTime;
    const prev = last.get(name);
    const variant = pickVariant(rec.variants, prev?.variant ?? -1, rnd, o.variant);
    const age = prev ? now - prev.t : Infinity;
    const j = jitter(cfg, age < cfg.recentWindow, age < cfg.doubleWindow, rnd);
    last.set(name, { t: now, variant });
    const buf = buffer(name, variant);
    if (!buf) return;
    const rate = clamp((o.rate ?? 1) * j.rate, 0.25, 4);
    const G = gain * j.gain;
    const mine = voices.filter((v) => v.cue === name && !v.done);
    if (mine.length >= cfg.voicesPerCue) fadeVoice(mine[0]!, cfg.stealFade);
    const live = voices.filter((v) => !v.done);
    if (live.length >= cfg.voicesTotal) fadeVoice(live[0]!, cfg.stealFade);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = rec.loop;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    src.connect(g).connect(master);
    const t0 = now + Math.max(0, o.delay ?? 0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(G, t0 + cfg.attack);
    const T = o.len ?? (rec.loop ? cfg.oneShotLen : buf.duration);
    if (rec.loop || T < buf.duration) {
      const end = t0 + T / rate;
      const fade = tailLength(T, rate, cfg.tail);
      g.gain.setValueAtTime(G, Math.max(t0 + cfg.attack, end - fade));
      g.gain.linearRampToValueAtTime(0, end);
      src.start(t0);
      src.stop(end + 0.01);
    } else src.start(t0);
    const voice: Voice = { cue: name, src, gain: g, t0, done: false };
    voices.push(voice);
    src.onended = () => {
      voice.done = true;
      const i = voices.indexOf(voice);
      if (i >= 0) voices.splice(i, 1);
      src.disconnect();
      g.disconnect();
    };
  }

  function loop(name: SoundName, o: { gain?: number; rate?: number } = {}): SoundLoop {
    const rec = recipeOf.get(name)!;
    const layerCount = rec.layers?.length ?? 1;
    const state: LoopState = {
      name, gain: o.gain ?? 1, rate: o.rate ?? 1, sources: [], gains: [], stopped: false,
      get playing() {
        return !state.stopped;
      },
      start() {
        if (!ctx || !master || state.stopped) return;
        const now = ctx.currentTime;
        const variant = rec.layers ? -1 : pickVariant(rec.variants, -1, rnd);
        for (let i = 0; i < layerCount; i++) {
          const buf = buffer(name, rec.layers ? i : variant);
          if (!buf) continue;
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.loop = true;
          src.playbackRate.value = clamp(state.rate, 0.25, 4);
          const g = ctx.createGain();
          g.gain.setValueAtTime(0, now);
          src.connect(g).connect(master);
          src.start(now, rnd() * 0.95 * buf.duration);
          state.sources.push(src);
          state.gains.push(g);
        }
        apply(cfg.loopIn);
      },
      set(p) {
        if (p.gain !== undefined) state.gain = p.gain;
        if (p.rate !== undefined) state.rate = p.rate;
        if (p.layer !== undefined) state.layer = p.layer;
        apply(cfg.loopSet);
      },
      stop(fade = cfg.loopStop) {
        if (state.stopped) return;
        state.stopped = true;
        loops.delete(state);
        if (!ctx) return;
        const t = ctx.currentTime;
        for (const g of state.gains) {
          g.gain.cancelScheduledValues(t);
          g.gain.setTargetAtTime(0, t, Math.max(0.001, fade / 3));
        }
        for (const s of state.sources) {
          try {
            s.stop(t + 2 * fade + 0.02);
          } catch {
            /* already stopped */
          }
          s.onended = () => s.disconnect();
        }
      },
    };
    const apply = (tau: number) => {
      if (!ctx) return;
      const t = ctx.currentTime;
      const base = state.gain * Number(cueCfg.get(name)!.gain);
      const g = rec.layers ? layerGains(base, state.layer) : [base];
      state.gains.forEach((node, i) => node.gain.setTargetAtTime(g[i] ?? 0, t, tau));
      for (const s of state.sources) s.playbackRate.setTargetAtTime(clamp(state.rate, 0.25, 4), t, tau);
    };
    loops.add(state);
    state.start();
    return state;
  }

  function setEnabled(on: boolean): void {
    if (on === enabled) return;
    enabled = on;
    if (suspendTimer) clearTimeout(suspendTimer);
    suspendTimer = null;
    applyMaster();
    if (on) resume();
    else if (ctx) {
      const c = ctx;
      suspendTimer = setTimeout(() => {
        if (!enabled && c.state === 'running') void c.suspend().catch(() => undefined);
      }, cfg.suspendDelay * 1000);
    }
    for (const fn of listeners) fn(on);
  }

  function stopAll(): void {
    for (const v of [...voices]) fadeVoice(v, 0.05);
    for (const l of [...loops]) l.stop(0.05);
  }

  const onFirst = () => unlock();
  const onGesture = () => resume();
  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => undefined);
    else resume();
  };
  if (opts.autoUnlock !== false && typeof window !== 'undefined') {
    window.addEventListener('pointerdown', onFirst, { capture: true, once: true });
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisibility);
  }

  return {
    get enabled() {
      return enabled;
    },
    get held() {
      return held;
    },
    get context() {
      return ctx;
    },
    setEnabled,
    unlock,
    play,
    loop,
    hold(on) {
      held = on;
      applyMaster();
    },
    stopAll,
    samples,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      stopAll();
      if (warmTimer) clearTimeout(warmTimer);
      if (suspendTimer) clearTimeout(suspendTimer);
      window.removeEventListener('pointerdown', onFirst, { capture: true });
      for (const ev of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(ev, onGesture, { capture: true });
      document.removeEventListener('visibilitychange', onVisibility);
      void ctx?.close().catch(() => undefined);
      ctx = null;
      registry.removeTree('sound');
    },
  };
}
