/**
 * Where the magnifier's card goes, in CSS pixels: above the read region if it fits, else below, left or right of
 * it; without a region, left of the disc, above it or below it; finally clamped inside the margins and above the
 * toolbar reserve at the bottom.
 */

export interface PlaceInput {
  /** Pointer (disc centre). */
  x: number;
  y: number;
  /** Screen rectangle of the read region, if known. */
  rect?: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Card width and height. */
  w: number;
  h: number;
  vw: number;
  vh: number;
  /** Disc radius. */
  r: number;
  gap: number;
  margin: number;
  /** Space kept free at the bottom for the toolbar. */
  reserve: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function placeCard(p: PlaceInput): { u: number; v: number } {
  const { x, y, w, h, vw, vh, gap, margin: M, reserve: S, r } = p;
  const fitsX = (u: number) => u >= M && u + w <= vw - M;
  const fitsY = (v: number) => v >= M && v + h <= vh - S;
  const mx = clamp(x - w / 2, M, vw - w - M);
  let u: number | null = null, v = 0;
  if (p.rect) {
    const { x0, y0, x1, y1 } = p.rect;
    const cands: [number, number][] = [[mx, y0 - gap - h], [mx, y1 + gap], [x0 - gap - w, y - h / 2], [x1 + gap, y - h / 2]];
    for (const [cu, cv] of cands) {
      if (fitsX(cu) && fitsY(cv)) {
        u = cu;
        v = cv;
        break;
      }
    }
  }
  if (u === null) {
    const off = r + gap;
    if (x - off - w >= M) [u, v] = [x - off - w, y - h / 2];
    else if (y - off - h >= M) [u, v] = [x - w / 2, y - off - h];
    else [u, v] = [x - w / 2, y + off];
  }
  return { u: clamp(u, M, vw - w - M), v: clamp(v, M, vh - h - S) };
}
