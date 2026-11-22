# Procedural sound with the Web Audio API

No audio files. Paper rustle, page flaps, pen scratch, thuds, clicks and a faint energy hum are
synthesised from noise and oscillators. Sources: MDN Web Audio API, best practices, and the
`AudioParam` method pages (checked 2026-11-22). Nothing here depends on three.

## 1. The engine: lazy context, unlock on gesture, master chain, mute

Autoplay policy (MDN best practices): create or resume the context inside a user gesture. A
context created earlier starts `suspended` and needs `resume()` from a gesture handler.

```ts
export class InkAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private muted = localStorage.getItem('inkleaf.muted') === '1';
  private lastPlay = new Map<string, number>();
  private voices = 0;
  readonly maxVoices = 12;

  /** Call from pointerdown / keydown listeners (capture phase, once). */
  unlock(): void {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      const comp = this.ctx.createDynamicsCompressor();      // gentle safety limiter
      comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4;
      comp.attack.value = 0.004; comp.release.value = 0.18;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp).connect(this.ctx.destination);
      this.noise = makeNoise(this.ctx, 2.0);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }
  setMuted(m: boolean): void {
    this.muted = m;
    localStorage.setItem('inkleaf.muted', m ? '1' : '0');
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(m ? 0 : 0.8, t, 0.03);   // no click on mute
  }
  /** Gate: context ready, not muted, not retriggered too fast, voice budget. */
  begin(key: string, minGap = 0.04): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted || this.voices >= this.maxVoices) return null;
    const last = this.lastPlay.get(key) ?? -1;
    if (ctx.currentTime - last < minGap) return null;
    this.lastPlay.set(key, ctx.currentTime);
    return ctx;
  }
  out(): AudioNode { return this.master; }
  noiseBuffer(): AudioBuffer { return this.noise; }
  track(src: AudioScheduledSourceNode, ...chain: AudioNode[]): void {
    this.voices++;
    src.onended = () => { this.voices--; src.disconnect(); for (const n of chain) n.disconnect(); };
  }
}

export const audio = new InkAudio();
const unlockOnce = () => audio.unlock();
addEventListener('pointerdown', unlockOnce, { capture: true });
addEventListener('keydown', unlockOnce, { capture: true });
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  if (document.hidden) void audio.ctx.suspend(); else void audio.ctx.resume();
});
```

Keep the listeners attached (they are cheap): some browsers suspend the context again after long
inactivity or a device change, and the next gesture resumes it.

## 2. Noise buffers

```ts
export function makeNoise(ctx: BaseAudioContext, seconds: number, seed = 1): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let s = seed >>> 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;                 // deterministic LCG
    const white = s / 2147483648 - 1;
    b0 = 0.99765 * b0 + white * 0.099046;                 // cheap pink-ish tilt
    b1 = 0.963 * b1 + white * 0.2965980;
    b2 = 0.57 * b2 + white * 1.0526913;
    d[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
  }
  return buf;
}
```

One 2 s buffer serves every noise sound; start at a random `offset` so repeats never line up.

## 3. Envelope helper

```ts
/** Attack-decay to silence on any AudioParam. Exponential ramps cannot target 0: use a floor. */
export function adEnvelope(p: AudioParam, t0: number, peak: number, attack: number, decay: number, floor = 1e-4): number {
  p.cancelScheduledValues(t0);
  p.setValueAtTime(floor, t0);
  p.linearRampToValueAtTime(peak, t0 + attack);
  p.exponentialRampToValueAtTime(floor, t0 + attack + decay);
  return t0 + attack + decay;                              // end time for stop()
}
```

MDN: `exponentialRampToValueAtTime` throws for a value of 0 (the target must be positive). Ramps
start from the previous scheduled event, so always `setValueAtTime` first. Setting `param.value`
directly is ignored while automation events are scheduled; stick to the methods for anything timed.

## 4. Page turn: rustle sweep plus a soft flap

Speed-aware: a quick flick is brighter and shorter, a slow drag darker and longer.

```ts
export function pageTurn(speed01: number, pan = 0): void {
  const ctx = audio.begin('pageTurn', 0.12); if (!ctx) return;
  const t = ctx.currentTime + 0.005;
  const dur = 0.55 - 0.3 * speed01;                       // 0.55 s slow .. 0.25 s fast
  const vary = 1 + (Math.random() - 0.5) * 0.08;          // plus or minus 4 percent pitch

  const src = ctx.createBufferSource();
  src.buffer = audio.noiseBuffer();
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(1400 * vary, t);
  bp.frequency.exponentialRampToValueAtTime((2600 + 1800 * speed01) * vary, t + dur * 0.7);
  bp.frequency.exponentialRampToValueAtTime(1100 * vary, t + dur);
  const g = ctx.createGain();
  adEnvelope(g.gain, t, 0.22 + 0.18 * speed01, dur * 0.25, dur * 0.75);
  const panner = ctx.createStereoPanner(); panner.pan.value = pan;
  src.connect(bp).connect(g).connect(panner).connect(audio.out());
  src.start(t, Math.random() * 1.2, dur + 0.05);
  audio.track(src, bp, g, panner);

  flap(t + dur * 0.92, 0.5 + 0.5 * speed01, pan);         // the sheet lands
}

function flap(t: number, strength: number, pan: number): void {
  const ctx = audio.ctx; if (!ctx) return;
  const src = ctx.createBufferSource(); src.buffer = audio.noiseBuffer();
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(180, t + 0.12);
  const g = ctx.createGain(); adEnvelope(g.gain, t, 0.35 * strength, 0.004, 0.14);
  const p = ctx.createStereoPanner(); p.pan.value = pan;
  src.connect(lp).connect(g).connect(p).connect(audio.out());
  src.start(t, Math.random() * 1.5, 0.2);
  audio.track(src, lp, g, p);
}
```

Pan from the screen: `pan = clamp(ndc.x * 0.6, -0.6, 0.6)`. Full hard pan sounds wrong for a book
in front of the listener.

## 5. Pen scratch loop (while a line draws on)

A looping noise source whose loudness and brightness follow pen speed. Create on stroke start,
ramp out and stop on stroke end.

```ts
export class PenScratch {
  private src: AudioBufferSourceNode | null = null;
  private g: GainNode | null = null;
  private bp: BiquadFilterNode | null = null;
  private lfo: OscillatorNode | null = null;

  start(): void {
    const ctx = audio.begin('pen', 0.02); if (!ctx || this.src) return;
    const t = ctx.currentTime;
    this.src = ctx.createBufferSource(); this.src.buffer = audio.noiseBuffer(); this.src.loop = true;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    this.bp = ctx.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 2.5; this.bp.frequency.value = 4200;
    this.g = ctx.createGain(); this.g.gain.setValueAtTime(1e-4, t);
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 23;   // paper tooth flutter
    const depth = ctx.createGain(); depth.gain.value = 0.02;
    this.lfo.connect(depth).connect(this.g.gain);                         // audio-rate modulation of gain
    this.src.connect(hp).connect(this.bp).connect(this.g).connect(audio.out());
    this.src.start(t, Math.random() * 1.5);
    this.lfo.start(t);
    audio.track(this.src, hp, this.bp, this.g, depth);
  }
  /** speed01: pen speed 0..1, call every frame while drawing. */
  update(speed01: number): void {
    const ctx = audio.ctx; if (!ctx || !this.g || !this.bp) return;
    const t = ctx.currentTime;
    this.g.gain.setTargetAtTime(0.03 + 0.09 * speed01, t, 0.03);
    this.bp.frequency.setTargetAtTime(3200 + 2600 * speed01, t, 0.05);
  }
  stop(): void {
    const ctx = audio.ctx; if (!ctx || !this.src || !this.g || !this.lfo) return;
    const t = ctx.currentTime;
    this.g.gain.cancelScheduledValues(t);
    this.g.gain.setTargetAtTime(1e-4, t, 0.04);
    this.src.stop(t + 0.25); this.lfo.stop(t + 0.25);
    this.src = null; this.g = null; this.bp = null; this.lfo = null;
  }
}
```

`setTargetAtTime(target, startTime, timeConstant)` is the audio twin of exponential damping and is
safe to call every frame (each call starts a new approach from the current value).
`AudioBufferSourceNode` and `OscillatorNode` start only once; make new ones per stroke.

## 6. Thud, click, pop

```ts
export function thud(strength = 1): void {                   // a diagram lands flat, a book closes
  const ctx = audio.begin('thud', 0.08); if (!ctx) return;
  const t = ctx.currentTime + 0.003;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(52, t + 0.16);
  const g = ctx.createGain(); const end = adEnvelope(g.gain, t, 0.45 * strength, 0.003, 0.2);
  o.connect(g).connect(audio.out()); o.start(t); o.stop(end + 0.02);
  audio.track(o, g);
}

export function click(): void {                               // UI tick
  const ctx = audio.begin('click', 0.03); if (!ctx) return;
  const t = ctx.currentTime + 0.002;
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = 1700 * (1 + (Math.random() - 0.5) * 0.06);
  const g = ctx.createGain(); const end = adEnvelope(g.gain, t, 0.12, 0.001, 0.03);
  o.connect(g).connect(audio.out()); o.start(t); o.stop(end + 0.01);
  audio.track(o, g);
}

export function pop(up: boolean): void {                      // peel up (rising) or fold down (falling)
  const ctx = audio.begin('pop', 0.06); if (!ctx) return;
  const t = ctx.currentTime + 0.003;
  const src = ctx.createBufferSource(); src.buffer = audio.noiseBuffer();
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
  bp.frequency.setValueAtTime(up ? 500 : 1400, t);
  bp.frequency.exponentialRampToValueAtTime(up ? 1500 : 450, t + 0.12);
  const g = ctx.createGain(); const end = adEnvelope(g.gain, t, 0.3, 0.005, 0.14);
  src.connect(bp).connect(g).connect(audio.out()); src.start(t, Math.random(), end - t + 0.02);
  audio.track(src, bp, g);
}
```

## 7. Energy hum (optional ambience)

Two slightly detuned sines through a lowpass, level tied to the energy shown on the page, never
louder than about -30 dBFS. Start it on the first interaction after unlock, fade it with
`setTargetAtTime` when the page changes, and stop it when muted or hidden. Hums fatigue quickly;
default it off and expose a toggle.

## 8. Mapping sound to the scene

| Event (scene manifest) | Sound | Parameters from the scene |
|---|---|---|
| page turn started | `pageTurn` | speed from angular velocity, pan from page side |
| diagram state `peeling` / `folding` | `pop(true)` / `pop(false)` | none |
| diagram state `printed` reached | `thud(0.4)` | strength from fold speed |
| ink stroke drawing | `PenScratch.update` | pen speed in px/s normalized |
| button press | `click` | none |
| lens opened | `click` at 0.6 level | none |

Drive sounds from state transitions (see the state machine in `animation-and-motion.md`), not from
per-frame thresholds, so they cannot double-fire. Under reduced motion keep confirmation sounds but
skip continuous ones.

## 9. Testing sound code

- happy-dom and jsdom have no Web Audio. Unit-test the scheduling logic with a tiny fake
  `AudioParam` that records calls, and keep synthesis graphs thin.
- In a real browser (Playwright), render a sound into an `OfflineAudioContext(1, sampleRate * 1,
  sampleRate)`, call `startRendering()`, and assert peak and RMS ranges and that the last 10 ms are
  near silent (no clicks at the end). The same functions work if they take a `BaseAudioContext`.

## Do

- Unlock on the first gesture; keep unlock listeners; persist mute.
- Randomise pitch and offset slightly per trigger; gate retriggers per sound key.
- Use `setTargetAtTime` for continuous control, envelopes with floors for one-shots.
- Disconnect nodes in `onended`; cap concurrent voices.

## Don't

- Don't `exponentialRampToValueAtTime(0, ...)`.
- Don't set `.value` on a param that has scheduled automation and expect it to stick.
- Don't reuse a started source node.
- Don't hard-pan or exceed comfortable loudness; a book is a quiet object.

## Pitfalls

- Silence on first click in some browsers: context created outside the gesture and never resumed.
- Clicks at sound ends: envelope ends above zero or `stop()` before the ramp finished.
- Sound piles up during fast page flipping: no retrigger gap or voice cap.
- Audio continues in a hidden tab: no `visibilitychange` handling.

## Self-check (APIs used, verified on MDN, checked 2026-11-22)

- `AudioContext` (constructor with `latencyHint`, `state`, `resume`, `suspend`, `currentTime`, `sampleRate`, `destination`), `BaseAudioContext.createBuffer`, `createBufferSource`, `createBiquadFilter`, `createGain`, `createOscillator`, `createStereoPanner`, `createDynamicsCompressor`: MDN Web Audio API interface pages
- `AudioParam.setValueAtTime`, `linearRampToValueAtTime`, `exponentialRampToValueAtTime` (positive target only), `setTargetAtTime`, `cancelScheduledValues`, `value` overridden by automation: MDN `AudioParam` pages and Web Audio best practices
- `AudioBufferSourceNode.buffer`, `loop`, `start(when, offset, duration)`, `stop`, `onended`; `BiquadFilterNode.type`, `frequency`, `Q`; `StereoPannerNode.pan`; `DynamicsCompressorNode.threshold`, `knee`, `ratio`, `attack`, `release`: MDN interface pages
- Autoplay rule (create or resume inside a user gesture): MDN Web Audio API best practices
- `OfflineAudioContext.startRendering`: MDN
- No three.js API is used in this file.
