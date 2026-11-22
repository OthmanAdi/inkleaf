/**
 * The printed page image: an orthographic camera above the model frame with a cabinet shear, rendering layer 1
 * (the pop's lines and surfaces) into a 1080 x 1200 4x MSAA texture that the right page multiplies onto the paper.
 * A model point (x, y, z) lands on the image at (x - 0.12 z, y - 0.32 z). A second, cheap pass works out which
 * pen-line vertices are hidden behind surfaces in the print, so lines hidden there stay hidden while lying flat.
 */
import {
  BufferGeometry, Color, DepthTexture, FloatType, LinearFilter, Matrix4, NearestFilter, NoColorSpace, OrthographicCamera,
  Points, Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector4, WebGLRenderTarget, type BufferAttribute, type Texture,
  type WebGLRenderer,
} from 'three';
import { LAYERS } from '../contracts';

export interface PrintRect { x0: number; x1: number; y0: number; y1: number }

export const PRINT_RECT: PrintRect = { x0: -10, x1: 170, y0: -4, y1: 196 };

/** Orthographic camera whose projection includes the cabinet shear, so the shear survives projection updates. */
export class ObliqueCamera extends OrthographicCamera {
  readonly cab = new Vector2(0.12, 0.32);
  /** Height of the camera above the hinge plane (model z of the eye). */
  zc = 1000;
  private readonly shear = new Matrix4();

  override updateProjectionMatrix(): void {
    super.updateProjectionMatrix();
    if (!this.shear) return;
    const cx = this.cab.x, cy = this.cab.y, z = this.zc;
    this.shear.set(1, 0, -cx, -cx * z, 0, 1, -cy, -cy * z, 0, 0, 1, 0, 0, 0, 0, 1);
    this.projectionMatrix.multiply(this.shear);
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}

/** Where model point (x, y, z) lands on the print image (model-frame mm). */
export function obliqueProject(x: number, y: number, z: number, cabX = 0.12, cabY = 0.32): [number, number] {
  return [x - cabX * z, y - cabY * z];
}

/**
 * The print rect in page millimetres for a page slot: `(u0, v0, width, height)` with the image's X axis along u and
 * its Y axis toward the page head. `originU` and `hingeV` are the page point of the model frame origin.
 */
export function printPageRect(rect: PrintRect, originU: number, hingeV: number, offsetU = 0, out = new Vector4()): Vector4 {
  return out.set(originU + rect.x0 + offsetU, hingeV - rect.y1, rect.x1 - rect.x0, rect.y1 - rect.y0);
}

const VIS_VERTEX = /* glsl */ `
uniform sampler2D uDepth;
uniform mat4 uVP;
uniform mat4 uModel;
uniform float uSide;
uniform float uBias;
varying float vVis;
void main() {
  vec4 c = uVP * uModel * vec4(position, 1.0);
  vec3 ndc = c.xyz / c.w;
  vec2 uv = ndc.xy * 0.5 + 0.5;
  float d = ndc.z * 0.5 + 0.5;
  float vis = 1.0;
  if (uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0) {
    float sd = textureLod(uDepth, uv, 0.0).r;
    vis = (d - uBias <= sd) ? 1.0 : 0.0;
  }
  vVis = vis;
  float id = float(gl_VertexID);
  float px = mod(id, uSide);
  float py = floor(id / uSide);
  gl_Position = vec4((px + 0.5) / uSide * 2.0 - 1.0, (py + 0.5) / uSide * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;

const VIS_FRAGMENT = /* glsl */ `
varying float vVis;
void main() { gl_FragColor = vec4(vVis, vVis, vVis, 1.0); }
`;

export interface PrintOptions {
  rect?: PrintRect;
  pxPerMm?: number;
  samples?: number;
  cab?: Vector2;
  cameraZ?: number;
  near?: number;
  far?: number;
  /** Visibility depth pass resolution relative to the print (0.5 -> 540 x 600). */
  visScale?: number;
  /** Hidden-line depth tolerance in mm. */
  visBias?: number;
}

/** A set whose vertices get a print-visibility value. */
export interface VisTarget {
  mesh: { matrixWorld: Matrix4; geometry: BufferGeometry };
  setVisibility(vis: ArrayLike<number>): void;
}

export class PrintRenderer {
  readonly camera = new ObliqueCamera();
  readonly target: WebGLRenderTarget;
  readonly rect: PrintRect;
  readonly width: number;
  readonly height: number;
  readonly pxPerMm: number;
  private depthTarget: WebGLRenderTarget;
  private visTarget: WebGLRenderTarget | null = null;
  private visScene = new Scene();
  private visPoints: Points;
  private visMat: ShaderMaterial;
  private visBuf = new Uint8Array(0);
  private range: number;
  private visBias: number;

  constructor(opts: PrintOptions = {}) {
    this.rect = { ...(opts.rect ?? PRINT_RECT) };
    this.pxPerMm = opts.pxPerMm ?? 6;
    const { x0, x1, y0, y1 } = this.rect;
    this.width = Math.max(1, Math.round((x1 - x0) * this.pxPerMm));
    this.height = Math.max(1, Math.round((y1 - y0) * this.pxPerMm));
    this.target = new WebGLRenderTarget(this.width, this.height, {
      samples: opts.samples ?? 4,
      type: UnsignedByteType,
      depthBuffer: true,
      generateMipmaps: false,
      minFilter: LinearFilter,
      magFilter: LinearFilter,
      colorSpace: NoColorSpace,
    });
    this.target.texture.name = 'ink.print';
    const vs = opts.visScale ?? 0.5;
    const dw = Math.max(1, Math.round(this.width * vs)), dh = Math.max(1, Math.round(this.height * vs));
    const depth = new DepthTexture(dw, dh, FloatType);
    depth.minFilter = NearestFilter;
    depth.magFilter = NearestFilter;
    this.depthTarget = new WebGLRenderTarget(dw, dh, { depthTexture: depth, depthBuffer: true, generateMipmaps: false });
    const cam = this.camera;
    if (opts.cab) cam.cab.copy(opts.cab);
    cam.zc = opts.cameraZ ?? 1000;
    cam.left = x0;
    cam.right = x1;
    cam.top = y1;
    cam.bottom = y0;
    cam.near = opts.near ?? 1;
    cam.far = opts.far ?? 2000;
    cam.matrixAutoUpdate = false;
    cam.layers.set(LAYERS.pop);
    cam.updateProjectionMatrix();
    this.range = cam.far - cam.near;
    this.visBias = opts.visBias ?? 2;
    this.visMat = new ShaderMaterial({
      name: 'ink.print-visibility',
      uniforms: {
        uDepth: { value: depth },
        uVP: { value: new Matrix4() },
        uModel: { value: new Matrix4() },
        uSide: { value: 1 },
        uBias: { value: this.visBias / this.range },
      },
      vertexShader: VIS_VERTEX,
      fragmentShader: VIS_FRAGMENT,
      depthTest: false,
      depthWrite: false,
    });
    this.visPoints = new Points(new BufferGeometry(), this.visMat);
    this.visPoints.frustumCulled = false;
    this.visPoints.layers.enableAll();
    this.visScene.add(this.visPoints);
  }

  get texture(): Texture {
    return this.target.texture;
  }

  /** Places the camera at `frame × translate(0, 0, zc)`, looking down the model frame's -Z. */
  setFrame(frame: Matrix4): void {
    const cam = this.camera;
    cam.matrix.copy(frame).multiply(new Matrix4().makeTranslation(0, 0, cam.zc));
    cam.updateMatrixWorld(true);
  }

  setCab(x: number, y: number): void {
    this.camera.cab.set(x, y);
    this.camera.updateProjectionMatrix();
  }

  /**
   * Renders `scene` (layer 1 only) into the print target with a white clear and the scene background off.
   * The caller has applied the print overrides to the materials.
   */
  render(renderer: WebGLRenderer, scene: Scene): Texture {
    const prevTarget = renderer.getRenderTarget();
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    const prevAuto = renderer.autoClear;
    const prevBg = scene.background;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    scene.background = null;
    renderer.autoClear = true;
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.target);
    renderer.clear(true, true, true);
    renderer.render(scene, this.camera);
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    scene.background = prevBg;
    renderer.xr.enabled = prevXr;
    return this.target.texture;
  }

  /**
   * Hidden-line pass: renders the scene depth from the print camera, then tests every vertex of each static set
   * against it (one pixel per vertex, read back once). A vertex is visible when it lies in front of the nearest
   * surface within the bias, or outside the image. Lines write no depth, so only surfaces occlude.
   */
  visibility(renderer: WebGLRenderer, scene: Scene, sets: readonly VisTarget[]): void {
    if (!sets.length) return;
    const prevTarget = renderer.getRenderTarget();
    const prevBg = scene.background;
    const prevAuto = renderer.autoClear;
    const prevClear = renderer.getClearColor(new Color());
    const prevAlpha = renderer.getClearAlpha();
    scene.background = null;
    renderer.autoClear = true;
    renderer.setClearColor(0xffffff, 1);
    renderer.setRenderTarget(this.depthTarget);
    renderer.clear(true, true, true);
    renderer.render(scene, this.camera);
    const cam = this.camera;
    (this.visMat.uniforms.uVP!.value as Matrix4).multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.visMat.uniforms.uBias!.value = this.visBias / this.range;
    for (const s of sets) {
      const pos = s.mesh.geometry.getAttribute('position') as BufferAttribute | undefined;
      if (!pos) continue;
      const n = pos.count;
      if (n === 0) continue;
      const side = Math.ceil(Math.sqrt(n));
      if (!this.visTarget || this.visTarget.width < side) {
        this.visTarget?.dispose();
        const sz = Math.max(side, 64);
        this.visTarget = new WebGLRenderTarget(sz, sz, { depthBuffer: false, generateMipmaps: false, minFilter: NearestFilter, magFilter: NearestFilter });
      }
      const sz = this.visTarget.width;
      const g = this.visPoints.geometry;
      g.setAttribute('position', pos);
      g.setDrawRange(0, n);
      this.visMat.uniforms.uSide!.value = sz;
      (this.visMat.uniforms.uModel!.value as Matrix4).copy(s.mesh.matrixWorld);
      renderer.setRenderTarget(this.visTarget);
      renderer.clear(true, false, false);
      renderer.render(this.visScene, cam);
      const rows = Math.ceil(n / sz);
      if (this.visBuf.length < sz * rows * 4) this.visBuf = new Uint8Array(sz * rows * 4);
      renderer.readRenderTargetPixels(this.visTarget, 0, 0, sz, rows, this.visBuf);
      const vis = new Float32Array(n);
      for (let i = 0; i < n; i++) vis[i] = this.visBuf[i * 4]! > 127 ? 1 : 0;
      s.setVisibility(vis);
      g.deleteAttribute('position');
    }
    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClear, prevAlpha);
    renderer.autoClear = prevAuto;
    scene.background = prevBg;
  }

  dispose(): void {
    this.target.dispose();
    this.depthTarget.depthTexture?.dispose();
    this.depthTarget.dispose();
    this.visTarget?.dispose();
    this.visMat.dispose();
  }
}
