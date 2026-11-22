/** Shared layout helpers: the layout accumulator, rectangles, regions and the running head. */
import type { PageRegion, Side } from '../../contracts';
import type { LayoutParams } from './params';
import type { DrawOp, FontSpec, ReadRegion, Rect } from './types';

export interface LayoutCtx {
  ops: DrawOp[];
  regions: PageRegion[];
  reads: ReadRegion[];
  anchors: Record<string, Rect>;
}

export const newLayout = (): LayoutCtx => ({ ops: [], regions: [], reads: [], anchors: {} });

/** Rectangle from two corners. */
export const rect = (u: number, v: number, u1: number, v1: number): Rect => ({ u, v, w: u1 - u, h: v1 - v });

export function region(L: LayoutCtx, id: string, kind: PageRegion['kind'], r: Rect, action: string, label?: string): void {
  L.regions.push({ id, kind, u: r.u, v: r.v, w: r.w, h: r.h, action, label });
}

export function read(L: LayoutCtx, id: string, r: Rect, text?: string): void {
  L.reads.push({ id, ...r, text });
}

export function runningHead(L: LayoutCtx, side: Side, head: string | undefined, folio: number | undefined, P: LayoutParams): void {
  const h = P.head, c = P.palette;
  const hf: FontSpec = { size: h.size, weight: 500, caps: true };
  const ff: FontSpec = { size: h.folioSize, weight: 500 };
  if (side === 'left') {
    if (head) L.ops.push({ op: 'text', x: h.leftX, y: h.v, text: head, font: hf, color: c.ink2 });
    if (folio !== undefined) L.ops.push({ op: 'text', x: h.leftX, y: h.folioV, text: String(folio), font: ff, color: c.ink2 });
    L.ops.push({ op: 'line', x0: h.leftX, y0: h.ruleV, x1: h.leftRuleTo, y1: h.ruleV, width: h.ruleWidth, color: c.rule });
  } else {
    if (head) L.ops.push({ op: 'text', x: h.rightX, y: h.v, text: head, font: hf, color: c.ink2, align: 'right' });
    if (folio !== undefined) L.ops.push({ op: 'text', x: h.rightX, y: h.folioV, text: String(folio), font: ff, color: c.ink2, align: 'right' });
    L.ops.push({ op: 'line', x0: h.rightRuleFrom, y0: h.ruleV, x1: h.rightX, y1: h.ruleV, width: h.ruleWidth, color: c.rule });
  }
}

/** Back-matter header: accent kicker and title. */
export function backHeader(L: LayoutCtx, x: number, kicker: string, title: string, P: LayoutParams): void {
  const b = P.back, c = P.palette;
  L.ops.push({ op: 'text', x, y: b.kickerV, text: kicker, font: { size: b.kickerSize, weight: 600, caps: true }, color: c.accent });
  L.ops.push({ op: 'text', x, y: b.titleV, text: title, font: { size: b.titleSize, weight: 560 }, color: c.ink });
}

/** Default flap face wording (a world can override each line). */
export const FLAP_WORDS = { main: 'Lift the flap to find out', sub: 'Make your prediction first.', hand: 'lift me', quizHand: 'lift to check' };
