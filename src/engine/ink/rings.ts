/**
 * Dashed, slowly rotating ink rings that face the camera: a hover ring around a thing (level 0.6 while hovered,
 * 1 for 0.35 s after a press) and an attention ring pointing something out. Never part of the print.
 */
import { Vector3 } from 'three';
import type { LineOptions } from '../contracts';
import { v3, type Part, type PartOptions, type Scope, type Vec3 } from './kit-core';
import type { InkLineSet } from './line-set';
import { slot, type Lines } from './silhouette';

export interface RingOptions extends PartOptions {
  /** 'hover' (default) or 'attention'. */
  kind?: 'hover' | 'attention';
  /** Ring centre in part space (default origin). */
  center?: Vec3;
  /** Radius in mm; or give `size` [w, h] of the thing for the automatic radius clamp(0.55·hypot, 9, 22). */
  radius?: number;
  size?: readonly [number, number];
  /** Draw over everything (default true). */
  overlay?: boolean;
}

export interface RingPart extends Part {
  set: InkLineSet;
  /** Hovered on or off. */
  hover(on: boolean): void;
  /** Flash to full for the press hold time. */
  press(): void;
  /** Show or hide (attention rings). */
  show(on: boolean): void;
  readonly level: number;
}

/** A dashed rotating ring that faces the camera. */
export function hoverRing(s: Scope, o: RingOptions): RingPart {
  const kind = o.kind ?? 'hover';
  const part = s.part(kind === 'hover' ? 'ring' : 'attention', o);
  const env = s.pop.env.ring;
  const clock = { value: 1e6 };
  const mat = s.pop.ink({ color: env.color, widthPx: env.widthPx, depthTest: o.overlay === false, clock });
  const set = s.pop.lines(mat, { capacity: 128 });
  set.mesh.renderOrder = s.pop.env.order.rings;
  part.group.add(set.mesh);
  part.sets.push(set);
  const centre = v3(o.center);
  const baseR = o.radius ?? (o.size ? Math.min(env.radiusMax, Math.max(env.radiusMin, env.radiusFactor * Math.hypot(o.size[0], o.size[1]))) : 12);
  let on = 0, target = 0, hovered = false, shown = false, hold = 0, angle = 0;
  const lines: Lines = [];
  const opts: LineOptions[] = [];
  const eye = new Vector3(), d = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), c = new Vector3();
  s.every((f) => {
    if (hold > 0) hold = Math.max(0, hold - f.dt);
    target = hold > 0 ? 1 : kind === 'hover' ? (hovered ? env.hover : 0) : shown ? 1 : 0;
    on += (target - on) * Math.min(1, env.ease * f.dt);
    if (f.frozen) on = target;
    mat.uniforms.uOpacity!.value = Math.min(1, env.opacityGain * on);
    set.mesh.visible = on > 0.003;
    if (!set.mesh.visible) return;
    if (!f.frozen) angle += env.spin * f.dt;
    part.group.worldToLocal(eye.copy(f.camera.position));
    d.subVectors(eye, centre).normalize();
    if (Math.abs(d.y) < 0.95) e1.set(0, 1, 0);
    else e1.set(1, 0, 0);
    e1.addScaledVector(d, -e1.dot(d)).normalize();
    e2.crossVectors(d, e1);
    c.copy(centre).addScaledVector(d, kind === 'hover' ? env.toward : env.attentionToward);
    const R = kind === 'hover' ? baseR + env.grow * on : env.attentionRadius * (1 + env.attentionGrow * on);
    const n = Math.round(env.dashes), dp = Math.max(2, Math.round(env.dashPoints));
    const slotA = (2 * Math.PI) / n;
    for (let i = 0; i < n; i++) {
      const l = slot(lines, i, dp);
      for (let k = 0; k < dp; k++) {
        const a = angle + i * slotA + (k / (dp - 1)) * env.duty * slotA;
        l[k]!.copy(c).addScaledVector(e1, R * Math.cos(a)).addScaledVector(e2, R * Math.sin(a));
      }
      opts[i] ??= { width: 1, t0: -1, dur: 0.001, seed: 40 + i };
    }
    lines.length = n;
    opts.length = n;
    set.setLines(lines, lines, opts);
  });
  s.register(part, kind === 'hover' ? 'hover-ring' : 'attention-ring', { ...o, tags: [...(o.tags ?? []), 'ui', 'effect', 'input'] },
    kind === 'hover' ? 'A dashed ring that appears around a thing when it is hovered or pressed.' : 'A dashed ring that points something out.', [
      { key: 'radius', label: 'Radius', type: 'number', unit: 'mm', min: 1, max: 200, get: () => baseR, set: () => {} },
    ]);
  return Object.assign(part, {
    set,
    hover(v: boolean) {
      hovered = v;
    },
    press() {
      hold = env.pressHold;
    },
    show(v: boolean) {
      shown = v;
    },
    get level() {
      return on;
    },
  });
}
