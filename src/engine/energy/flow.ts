/**
 * Stream variants and the helpers that connect the ledger to streams: a stream that fades and thins quickly when
 * its flow stops, a stream that marches one bead per energy packet, and the watts between two stores.
 */
import { energyConfig } from './config';
import type { AccountMatch, Ledger } from './ledger';
import { smoothstep } from './hue';
import { Stream, type StreamFrame, type StreamOptions } from './stream';

/** A stream that, once its flow stops, decays faster than the normal glow and thins quadratically. */
export class FadingStream extends Stream {
  /** Extra decay rate (1/s) after the flow stops; null reads `energy.flow.fadeOut`. */
  fadeOut: number | null;

  constructor(opts: StreamOptions & { fadeOut?: number }) {
    super(opts);
    this.fadeOut = opts.fadeOut ?? null;
  }

  override update(dt: number, f: StreamFrame): void {
    super.update(dt, f);
    const F = energyConfig.flow;
    const rate = this.fadeOut ?? F.fadeOut;
    if (rate > 0 && !(f.live && this.power > 0)) {
      this.glow *= Math.exp(-rate * dt);
      const vis = this.glow > energyConfig.stream.visibleGlow;
      this.tube.visible = vis;
      this.beads.visible = vis;
    }
    const k = Math.min(1, F.fadeRadius * this.glow);
    this.material.uniforms.uRadius.value *= k * k;
  }
}

/** Packet stream geometry: bead e sits at d = o + spacing e along the tube, with o following the pulse peaks. */
export function packetOffsets(clock: number, len: number, spacing = energyConfig.flow.spacing, peak = energyConfig.flow.peak, speedMul = energyConfig.modes.elecSpeedMul): { o: number; count: number } {
  const o = (((speedMul * clock + peak * spacing) % spacing) + spacing) % spacing;
  let count = 0;
  while (o + spacing * count < len - 1) count++;
  return { o, count };
}

/**
 * An electrical stream that shows energy as packets: every bead is `packet` joules, beads sit on the pulse peaks and
 * march one spacing (18 mm) per packet.
 */
export class PacketStream extends Stream {
  /** Joules per bead; null reads `energy.flow.packet`. */
  packet: number | null;
  clock = 0;

  constructor(opts: StreamOptions & { packet?: number }) {
    const probe = opts.beads ?? 0;
    super({ ...opts, pathway: 'electrical', beads: Math.max(probe, 64) });
    this.packet = opts.packet ?? null;
  }

  override update(dt: number, f: StreamFrame): void {
    const frozen = !!(f.still || f.paused);
    const packet = Math.max(1e-12, this.packet ?? energyConfig.flow.packet);
    if (f.live && !frozen) this.clock += energyConfig.flow.clockRate * dt * (this.power / packet);
    super.update(dt, f);
    const u = this.material.uniforms;
    u.uSpeed.value = 1;
    u.uTime.value = this.clock;
  }

  protected override updateBeads(): void {
    const F = energyConfig.flow;
    const u = this.material.uniforms;
    const hw = u.uHw.value;
    const { o } = packetOffsets(this.clock, this.len);
    for (let e = 0; e < this.beadCount; e++) {
      const d = o + F.spacing * e;
      const show = d < this.len - 1 && this.power > 1e-9;
      const t = Math.min(1, d / this.len);
      const h = this.dir < 0 ? 1 - t : t;
      const size = show ? F.size * this.glow * Math.min(1, t / F.end, (1 - t) / F.end) : 0;
      this.placeBead(e, h, Math.max(0, size), smoothstep(0.5 - hw, 0.5 + hw, t));
    }
    this.flushBeads();
  }
}

/**
 * Smoothed watts from accounts matching `from` to accounts matching `to` (store ids such as "kinetic", full account
 * names, or predicates). `signed` subtracts the reverse flow, so a stream can reverse with the energy.
 */
export function flowPower(ledger: Ledger, from: AccountMatch, to: AccountMatch, opts: { pathway?: string; signed?: boolean } = {}): number {
  return ledger.power(from, to, opts);
}

/** Drives a stream from the ledger: stream power = scale * watts (signed), full level at `max`. */
export function driveStream(stream: Stream, ledger: Ledger, from: AccountMatch, to: AccountMatch, opts: { scale?: number; max?: number; signed?: boolean; pathway?: string } = {}): number {
  const w = ledger.power(from, to, { signed: opts.signed ?? true, pathway: opts.pathway }) * (opts.scale ?? 1);
  stream.setPower(w, opts.max ?? stream.maxPower);
  return w;
}
