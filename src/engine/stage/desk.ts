/**
 * Desk and desk pad geometry: an 8 m oak plane with UVs in texture tiles (planks run along world X) and a lino pad,
 * a rounded rectangle extruded with a soft bevel, with millimetre UVs so the lino tile repeats every 96 mm.
 */
import { ExtrudeGeometry, PlaneGeometry, Shape, type BufferGeometry } from 'three';

export interface DeskGeometryOptions { size: number; tileWidth: number; tileDepth: number }
export const DESK_GEOMETRY_DEFAULTS: DeskGeometryOptions = { size: 8000, tileWidth: 1400, tileDepth: 900 };

/** Desk plane in its local XY plane (rotate -PI/2 about X to lay it flat); one texture tile per tileWidth x tileDepth. */
export function deskGeometry(o: DeskGeometryOptions = DESK_GEOMETRY_DEFAULTS): PlaneGeometry {
  const g = new PlaneGeometry(o.size, o.size);
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / o.tileWidth, -pos.getY(i) / o.tileDepth);
  uv.needsUpdate = true;
  return g;
}

export interface PadGeometryOptions {
  width: number; depth: number; thickness: number; corner: number; bevel: number; bevelSegments: number; curveSegments: number;
}
export const PAD_GEOMETRY_DEFAULTS: PadGeometryOptions = { width: 640, depth: 430, thickness: 2.5, corner: 7, bevel: 0.5, bevelSegments: 2, curveSegments: 5 };

/**
 * Pad solid spanning y 0..thickness, centred on x and z. Group 0 = caps (lino), group 1 = side walls and bevel (edge).
 * UVs of every vertex are (x, z) in mm.
 */
export function padGeometry(o: PadGeometryOptions = PAD_GEOMETRY_DEFAULTS): BufferGeometry {
  const w = o.width / 2 - o.bevel, h = o.depth / 2 - o.bevel, r = o.corner;
  const s = new Shape();
  s.moveTo(-w + r, -h);
  s.lineTo(w - r, -h);
  s.quadraticCurveTo(w, -h, w, -h + r);
  s.lineTo(w, h - r);
  s.quadraticCurveTo(w, h, w - r, h);
  s.lineTo(-w + r, h);
  s.quadraticCurveTo(-w, h, -w, h - r);
  s.lineTo(-w, -h + r);
  s.quadraticCurveTo(-w, -h, -w + r, -h);
  const g = new ExtrudeGeometry(s, {
    depth: o.thickness - 2 * o.bevel, bevelEnabled: true, bevelThickness: o.bevel, bevelSize: o.bevel,
    bevelSegments: o.bevelSegments, curveSegments: o.curveSegments,
  });
  g.translate(0, 0, o.bevel);
  g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position!;
  const uv = g.attributes.uv!;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i), pos.getZ(i));
  uv.needsUpdate = true;
  return g;
}
