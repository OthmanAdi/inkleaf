/**
 * Book geometry builders: page slabs (five hard-edged faces driven by integrated page curves), cover boards (bevelled
 * rounded extrusion with an optional chamfered recess), the spine cloth strip, head-band tubes and the ribbon grid.
 * Dynamic geometry is updated in place on dynamic-draw buffers.
 */
import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, ExtrudeGeometry, Path, Shape, Uint16BufferAttribute,
  Uint32BufferAttribute, Vector3,
} from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Dims } from './dims';
import type { Curve } from './model';

const dyn = (n: number, size: number) => {
  const a = new BufferAttribute(new Float32Array(n * size), size);
  a.setUsage(DynamicDrawUsage);
  return a;
};
const indexAttr = (idx: number[], verts: number) => (verts > 65535 ? new Uint32BufferAttribute(idx, 1) : new Uint16BufferAttribute(idx, 1));

// ------------------------------------------------------------------------------------------------ page slab

/**
 * A slab of pages between two stack coordinates: face b (top, material 0), face a (bottom, material 1), and head,
 * tail and fore-edge (material 2). Curves are indexed by sigma row j (0..nsig) and z row r (0..nz).
 */
export class Slab {
  readonly geometry = new BufferGeometry();
  readonly ns: number;
  readonly nz: number;
  readonly nsig: number;
  private pos: BufferAttribute;
  private uv: BufferAttribute;
  private oB: number; private oA: number; private oH: number; private oT: number; private oF: number;

  constructor(ns: number, nz: number, nsig: number) {
    this.ns = ns; this.nz = nz; this.nsig = nsig;
    const nf = (ns + 1) * (nz + 1), ne = (ns + 1) * (nsig + 1), nfe = (nsig + 1) * (nz + 1);
    this.oB = 0; this.oA = nf; this.oH = 2 * nf; this.oT = 2 * nf + ne; this.oF = 2 * nf + 2 * ne;
    const total = 2 * nf + 2 * ne + nfe;
    this.pos = dyn(total, 3);
    this.uv = dyn(total, 2);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('normal', dyn(total, 3));
    const idx: number[] = [];
    // grid(o, cols, rows, flip): quads between columns (fast) and rows (slow).
    const grid = (o: number, cols: number, rows: number, flip: boolean) => {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const a = o + r * (cols + 1) + c, b = a + 1, d = a + cols + 1, e = d + 1;
          if (flip) idx.push(a, d, b, b, d, e);
          else idx.push(a, b, d, b, e, d);
        }
      }
    };
    const start = () => idx.length;
    const s0 = start(); grid(this.oB, ns, nz, true);
    const s1 = start(); grid(this.oA, ns, nz, false);
    const s2 = start();
    grid(this.oH, ns, nsig, true);
    grid(this.oT, ns, nsig, false);
    grid(this.oF, nz, nsig, true);
    const s3 = start();
    this.geometry.setIndex(indexAttr(idx, total));
    this.geometry.addGroup(s0, s1 - s0, 0);
    this.geometry.addGroup(s1, s2 - s1, 1);
    this.geometry.addGroup(s2, s3 - s2, 2);
  }

  /** Writes positions and UVs from the curve grid, then normals and bounds. */
  update(d: Dims, curve: (j: number, r: number) => Curve, sigma: (j: number) => number): void {
    const { ns, nz, nsig } = this;
    const P = this.pos.array as Float32Array, U = this.uv.array as Float32Array;
    const { W, D, S } = d;
    const zr = (r: number) => -D / 2 + (D * r) / nz;
    for (let r = 0; r <= nz; r++) {
      const z = zr(r), cb = curve(nsig, r), ca = curve(0, r);
      for (let m = 0; m <= ns; m++) {
        let i = this.oB + r * (ns + 1) + m;
        P[i * 3] = cb.x[m]!; P[i * 3 + 1] = cb.y[m]!; P[i * 3 + 2] = z;
        U[i * 2] = S[m]! / W; U[i * 2 + 1] = (z + D / 2) / D;
        i = this.oA + r * (ns + 1) + m;
        P[i * 3] = ca.x[m]!; P[i * 3 + 1] = ca.y[m]!; P[i * 3 + 2] = z;
        U[i * 2] = (W - S[m]!) / W; U[i * 2 + 1] = (z + D / 2) / D;
      }
    }
    for (let j = 0; j <= nsig; j++) {
      const sg = sigma(j), ch = curve(j, 0), ct = curve(j, nz);
      for (let m = 0; m <= ns; m++) {
        let i = this.oH + j * (ns + 1) + m;
        P[i * 3] = ch.x[m]!; P[i * 3 + 1] = ch.y[m]!; P[i * 3 + 2] = -D / 2;
        U[i * 2] = S[m]!; U[i * 2 + 1] = sg;
        i = this.oT + j * (ns + 1) + m;
        P[i * 3] = ct.x[m]!; P[i * 3 + 1] = ct.y[m]!; P[i * 3 + 2] = D / 2;
        U[i * 2] = S[m]!; U[i * 2 + 1] = sg;
      }
      for (let r = 0; r <= nz; r++) {
        const c = curve(j, r), z = zr(r);
        const i = this.oF + j * (nz + 1) + r;
        P[i * 3] = c.x[ns]!; P[i * 3 + 1] = c.y[ns]!; P[i * 3 + 2] = z;
        U[i * 2] = z; U[i * 2 + 1] = sg;
      }
    }
    this.pos.needsUpdate = true;
    this.uv.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
    this.geometry.computeBoundingBox();
  }
}

// ------------------------------------------------------------------------------------------------ boards

export interface Recess { cx: number; cz: number; w: number; h: number; chamfer: number }

/**
 * A cover board spanning local x 0..w, y 0..t, z -d/2..d/2: rounded corners (radius 2), 0.5 mm bevel, creased
 * normals, mm UVs and an `aLayout` attribute on the top face ((x/w, (z + d/2)/d), else -1).
 */
export function boardGeometry(w: number, d: number, t: number, recess?: Recess, corner = 2, bevel = 0.5): BufferGeometry {
  const x0 = bevel, x1 = w - bevel, y0 = -d / 2 + bevel, y1 = d / 2 - bevel, r = corner;
  const s = new Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r);
  s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  if (recess) {
    const { cx, w: rw, h: rh, chamfer: c } = recess;
    const cy = -recess.cz;
    const hx0 = cx - rw / 2, hx1 = cx + rw / 2, hy0 = cy - rh / 2, hy1 = cy + rh / 2;
    const p = new Path();
    p.moveTo(hx0 + c, hy0);
    p.lineTo(hx0, hy0 + c);
    p.lineTo(hx0, hy1 - c);
    p.lineTo(hx0 + c, hy1);
    p.lineTo(hx1 - c, hy1);
    p.lineTo(hx1, hy1 - c);
    p.lineTo(hx1, hy0 + c);
    p.lineTo(hx1 - c, hy0);
    p.closePath();
    s.holes.push(p);
  }
  const ex = new ExtrudeGeometry(s, { depth: t - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 6 });
  ex.rotateX(-Math.PI / 2);
  ex.translate(0, bevel, 0);
  ex.deleteAttribute('uv');
  const g = toCreasedNormals(ex, Math.PI / 5);
  ex.dispose();
  const P = g.getAttribute('position') as BufferAttribute, N = g.getAttribute('normal') as BufferAttribute;
  const n = P.count;
  const uv = new Float32Array(n * 2), lay = new Float32Array(n * 2);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), fn = new Vector3();
  for (let tri = 0; tri < n; tri += 3) {
    a.fromBufferAttribute(P, tri); b.fromBufferAttribute(P, tri + 1); c.fromBufferAttribute(P, tri + 2);
    fn.subVectors(c, b).cross(a.clone().sub(b)).normalize();
    const top = fn.y > 0.3 && a.y > t - 0.001 && b.y > t - 0.001 && c.y > t - 0.001;
    for (let k = 0; k < 3; k++) {
      const i = tri + k;
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
      if (Math.abs(fn.y) > 0.6) { uv[i * 2] = x; uv[i * 2 + 1] = z; }
      else if (Math.abs(fn.x) > Math.abs(fn.z)) { uv[i * 2] = z; uv[i * 2 + 1] = y; }
      else { uv[i * 2] = x; uv[i * 2 + 1] = y; }
      if (top) { lay[i * 2] = x / w; lay[i * 2 + 1] = (z + d / 2) / d; }
      else { lay[i * 2] = -1; lay[i * 2 + 1] = -1; }
      // Exact flat normals on the two large cap faces.
      if (Math.abs(fn.y) > 0.999 && (y > t - 0.001 || y < 0.001)) N.setXYZ(i, 0, Math.sign(fn.y), 0);
    }
  }
  g.setAttribute('uv', new BufferAttribute(uv, 2));
  g.setAttribute('aLayout', new BufferAttribute(lay, 2));
  g.computeBoundingSphere();
  return g;
}

/** Box with mm UVs on every face (or full 0..1 UVs on top and bottom) and an `aLayout` of -1. */
export function mmBox(w: number, h: number, d: number, fullTop = false): BufferGeometry {
  const g = new BufferGeometry();
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  const face = (n: [number, number, number], u: [number, number, number], v: [number, number, number], su: number, sv: number, full: boolean) => {
    const o = pos.length / 3;
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
      const fu = i - 0.5, fv = j - 0.5;
      pos.push(
        (n[0] * w) / 2 + u[0] * fu * su + v[0] * fv * sv,
        (n[1] * h) / 2 + u[1] * fu * su + v[1] * fv * sv,
        (n[2] * d) / 2 + u[2] * fu * su + v[2] * fv * sv,
      );
      nor.push(...n);
      if (full) uv.push(i, 1 - j);
      else uv.push(fu * su, fv * sv);
    }
    idx.push(o, o + 2, o + 1, o + 1, o + 2, o + 3);
  };
  face([0, 1, 0], [1, 0, 0], [0, 0, 1], w, d, fullTop);
  face([0, -1, 0], [1, 0, 0], [0, 0, -1], w, d, fullTop);
  face([1, 0, 0], [0, 0, -1], [0, 1, 0], d, h, false);
  face([-1, 0, 0], [0, 0, 1], [0, 1, 0], d, h, false);
  face([0, 0, 1], [1, 0, 0], [0, 1, 0], w, h, false);
  face([0, 0, -1], [-1, 0, 0], [0, 1, 0], w, h, false);
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aLayout', new BufferAttribute(new Float32Array((pos.length / 3) * 2).fill(-1), 2));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

// ------------------------------------------------------------------------------------------------ spine cloth

/** Spine cloth: outer surface (with the spine label layout), inner surface, head cap and tail cap. */
export class SpineMesh {
  readonly geometry = new BufferGeometry();
  readonly sections: number;
  private pos: BufferAttribute; private uv: BufferAttribute; private lay: BufferAttribute;

  constructor(sections = 49) {
    this.sections = sections;
    const n = sections * 2 * 4;
    this.pos = dyn(n, 3); this.uv = dyn(n, 2); this.lay = dyn(n, 2);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('aLayout', this.lay);
    this.geometry.setAttribute('normal', dyn(n, 3));
    const idx: number[] = [];
    for (let s = 0; s < 4; s++) {
      const o = s * sections * 2;
      for (let i = 0; i < sections - 1; i++) {
        const a = o + i * 2, b = a + 1, c = a + 2, e = a + 3;
        // outer and tail cap wind one way, inner and head cap the other, so every face points outward.
        if (s === 0 || s === 3) idx.push(a, b, c, b, e, c);
        else idx.push(a, c, b, b, c, e);
      }
    }
    this.geometry.setIndex(idx);
  }

  /** outer/inner: xy pairs; z0/z1: head and tail; labelCenter and labelWidth in arc mm; layoutH: layout height mm. */
  update(outer: Float64Array, inner: Float64Array, z0: number, z1: number, labelCenter: number, labelWidth: number, spineT: number): void {
    const P = this.pos.array as Float32Array, U = this.uv.array as Float32Array, Lr = this.lay.array as Float32Array;
    const n = this.sections;
    let arc = 0;
    const H = z1 - z0;
    for (let i = 0; i < n; i++) {
      if (i > 0) arc += Math.hypot(outer[i * 2]! - outer[i * 2 - 2]!, outer[i * 2 + 1]! - outer[i * 2 - 1]!);
      const ox = outer[i * 2]!, oy = outer[i * 2 + 1]!, ix = inner[i * 2]!, iy = inner[i * 2 + 1]!;
      const put = (strip: number, side: number, x: number, y: number, z: number, u: number, v: number, lu: number, lv: number) => {
        const k = strip * n * 2 + i * 2 + side;
        P[k * 3] = x; P[k * 3 + 1] = y; P[k * 3 + 2] = z;
        U[k * 2] = u; U[k * 2 + 1] = v;
        Lr[k * 2] = lu; Lr[k * 2 + 1] = lv;
      };
      const lu = (arc - labelCenter) / labelWidth + 0.5;
      put(0, 0, ox, oy, z0, arc, z0, lu, 0);
      put(0, 1, ox, oy, z1, arc, z1, lu, 1);
      put(1, 0, ix, iy, z0, arc, z0, -1, -1);
      put(1, 1, ix, iy, z1, arc, z1, -1, -1);
      put(2, 0, ox, oy, z0, arc, 0, -1, -1);
      put(2, 1, ix, iy, z0, arc, spineT, -1, -1);
      put(3, 0, ox, oy, z1, arc, 0, -1, -1);
      put(3, 1, ix, iy, z1, arc, spineT, -1, -1);
    }
    void H;
    this.pos.needsUpdate = this.uv.needsUpdate = this.lay.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}

// ------------------------------------------------------------------------------------------------ head bands

/** Tube along a polyline in the xy plane at constant z. */
export class BandMesh {
  readonly geometry = new BufferGeometry();
  readonly points: number;
  readonly radial: number;
  private pos: BufferAttribute; private uv: BufferAttribute; private nor: BufferAttribute;

  constructor(points = 25, radial = 10) {
    this.points = points; this.radial = radial;
    const n = points * (radial + 1);
    this.pos = dyn(n, 3); this.uv = dyn(n, 2); this.nor = dyn(n, 3);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('normal', this.nor);
    const idx: number[] = [];
    for (let i = 0; i < points - 1; i++) {
      for (let j = 0; j < radial; j++) {
        const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, e = c + 1;
        idx.push(a, c, b, b, c, e);
      }
    }
    this.geometry.setIndex(idx);
  }

  update(path: Float64Array, z: number, radius: number, beadsPerMm: number): void {
    const P = this.pos.array as Float32Array, U = this.uv.array as Float32Array, N = this.nor.array as Float32Array;
    const n = this.points, R = this.radial;
    let arc = 0;
    for (let i = 0; i < n; i++) {
      const ip = Math.max(0, i - 1), inx = Math.min(n - 1, i + 1);
      let tx = path[inx * 2]! - path[ip * 2]!, ty = path[inx * 2 + 1]! - path[ip * 2 + 1]!;
      const tl = Math.hypot(tx, ty) || 1;
      tx /= tl; ty /= tl;
      if (i > 0) arc += Math.hypot(path[i * 2]! - path[i * 2 - 2]!, path[i * 2 + 1]! - path[i * 2 - 1]!);
      // h = t x z (in plane), l = h x t (along z).
      const hx = ty, hy = -tx;
      for (let j = 0; j <= R; j++) {
        const th = (j / R) * Math.PI * 2;
        const cx = Math.cos(th), sz = Math.sin(th);
        const nx = hx * cx, ny = hy * cx, nz = sz;
        const k = i * (R + 1) + j;
        P[k * 3] = path[i * 2]! + nx * radius; P[k * 3 + 1] = path[i * 2 + 1]! + ny * radius; P[k * 3 + 2] = z + nz * radius;
        N[k * 3] = nx; N[k * 3 + 1] = ny; N[k * 3 + 2] = nz;
        U[k * 2] = (arc * beadsPerMm) / 16; U[k * 2 + 1] = j / R;
      }
    }
    this.pos.needsUpdate = this.uv.needsUpdate = this.nor.needsUpdate = true;
    this.geometry.computeBoundingSphere();
  }
}

// ------------------------------------------------------------------------------------------------ ribbon

/** Ribbon grid: rows x cols points; uv = (across in mm, cumulative length of the middle column in mm). */
export class RibbonMesh {
  readonly geometry = new BufferGeometry();
  readonly rows: number;
  readonly cols: number;
  readonly data: Float64Array;
  private pos: BufferAttribute; private uv: BufferAttribute;

  constructor(rows = 90, cols = 5) {
    this.rows = rows; this.cols = cols;
    const n = rows * cols;
    this.data = new Float64Array(n * 3);
    this.pos = dyn(n, 3); this.uv = dyn(n, 2);
    this.geometry.setAttribute('position', this.pos);
    this.geometry.setAttribute('uv', this.uv);
    this.geometry.setAttribute('normal', dyn(n, 3));
    const idx: number[] = [];
    for (let r = 0; r < rows - 1; r++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = r * cols + c, b = a + 1, d = a + cols, e = d + 1;
        idx.push(a, d, b, b, d, e);
      }
    }
    this.geometry.setIndex(idx);
  }

  /** Copies `data` (rows x cols x xyz) into the buffers. */
  commit(width: number): void {
    const P = this.pos.array as Float32Array, U = this.uv.array as Float32Array, D = this.data;
    const { rows, cols } = this;
    const mid = (cols - 1) >> 1;
    let len = 0;
    for (let r = 0; r < rows; r++) {
      if (r > 0) {
        const a = ((r - 1) * cols + mid) * 3, b = (r * cols + mid) * 3;
        len += Math.hypot(D[b]! - D[a]!, D[b + 1]! - D[a + 1]!, D[b + 2]! - D[a + 2]!);
      }
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        P[k * 3] = D[k * 3]!; P[k * 3 + 1] = D[k * 3 + 1]!; P[k * 3 + 2] = D[k * 3 + 2]!;
        U[k * 2] = (c / (cols - 1)) * width; U[k * 2 + 1] = len;
      }
    }
    this.pos.needsUpdate = this.uv.needsUpdate = true;
    this.geometry.computeVertexNormals();
    this.geometry.computeBoundingSphere();
  }
}
