/**
 * The spill glow map: a top-down orthographic render of the glow layer (energy liquids, streams, lamp filaments)
 * into a tiny half-float target, blurred three times. Page materials multiply it onto the paper after lighting, so
 * coloured glow appears directly under each glowing object, whatever its height.
 */
import {
  Color, HalfFloatType, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, Vector2, Vector3, Vector4,
  WebGLRenderTarget, type Texture, type WebGLRenderer,
} from 'three';
import { LAYERS, type SpillMap } from '../contracts';

export interface SpillMapParams {
  x0: number; z0: number; width: number; depth: number;
  resX: number; resY: number;
  spread: number; iterations: number;
  gain: number; tail: number;
  cameraHeight: number; near: number; far: number;
  w0: number; w1: number; w2: number; o1: number; o2: number;
}

export const SPILL_MAP_DEFAULTS: SpillMapParams = {
  x0: -200, z0: -130, width: 400, depth: 260, resX: 224, resY: 150, spread: 1.15, iterations: 3, gain: 2.4, tail: 40,
  cameraHeight: 1500, near: 1, far: 3000, w0: 0.227, w1: 0.316, w2: 0.07, o1: 1.38, o2: 3.23,
};

const blurVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;
const blurFrag = /* glsl */ `
uniform sampler2D tMap;
uniform vec2 uStep;
uniform vec3 uW;
uniform vec2 uO;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tMap, vUv).rgb * uW.x;
  c += (texture2D(tMap, vUv + uStep * uO.x).rgb + texture2D(tMap, vUv - uStep * uO.x).rgb) * uW.y;
  c += (texture2D(tMap, vUv + uStep * uO.y).rgb + texture2D(tMap, vUv - uStep * uO.y).rgb) * uW.z;
  gl_FragColor = vec4(c, 1.0);
}
`;

export class SpillMapRenderer implements SpillMap {
  readonly rect = new Vector4();
  gain: number;
  /** Frames left to keep rendering after the glow stopped being live. */
  tailLeft = 0;
  /** Renders performed (for tests and the inspector). */
  renders = 0;
  private a: WebGLRenderTarget;
  private b: WebGLRenderTarget;
  private readonly cam: OrthographicCamera;
  private readonly quadScene = new Scene();
  private readonly quadCam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: ShaderMaterial;
  private readonly quad: Mesh;
  private readonly prevClear = new Color();

  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, public params: SpillMapParams = { ...SPILL_MAP_DEFAULTS }) {
    const opts = { type: HalfFloatType, minFilter: LinearFilter, magFilter: LinearFilter, generateMipmaps: false };
    this.a = new WebGLRenderTarget(params.resX, params.resY, { ...opts, depthBuffer: true });
    this.b = new WebGLRenderTarget(params.resX, params.resY, { ...opts, depthBuffer: false });
    this.a.texture.name = 'post.spill-map';
    this.cam = new OrthographicCamera();
    this.cam.layers.set(LAYERS.glow);
    this.mat = new ShaderMaterial({
      vertexShader: blurVert, fragmentShader: blurFrag, depthTest: false, depthWrite: false,
      uniforms: { tMap: { value: null }, uStep: { value: new Vector2() }, uW: { value: new Vector3() }, uO: { value: new Vector2() } },
    });
    this.quad = new Mesh(new PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    this.gain = params.gain;
    this.configure();
  }

  get texture(): Texture {
    return this.a.texture;
  }

  /** Applies params: camera frustum, rect, target size. */
  configure(): void {
    const p = this.params;
    if (this.a.width !== p.resX || this.a.height !== p.resY) {
      this.a.setSize(p.resX, p.resY);
      this.b.setSize(p.resX, p.resY);
    }
    const c = this.cam;
    c.left = p.x0;
    c.right = p.x0 + p.width;
    c.top = -p.z0;
    c.bottom = -(p.z0 + p.depth);
    c.near = p.near;
    c.far = p.far;
    c.position.set(0, p.cameraHeight, 0);
    c.up.set(0, 0, -1);
    c.lookAt(0, 0, 0);
    c.updateProjectionMatrix();
    c.updateMatrixWorld(true);
    this.rect.set(p.x0, p.z0, p.width, p.depth);
    (this.mat.uniforms.uW!.value as Vector3).set(p.w0, p.w1, p.w2);
    (this.mat.uniforms.uO!.value as Vector2).set(p.o1, p.o2);
  }

  update(live: boolean): void {
    if (live) this.tailLeft = this.params.tail;
    if (this.tailLeft > 0) this.render();
    if (!live && this.tailLeft > 0) this.tailLeft--;
  }

  /** Renders and blurs the glow layer now. */
  render(): void {
    const r = this.renderer;
    const p = this.params;
    const prevTarget = r.getRenderTarget();
    const prevAlpha = r.getClearAlpha();
    r.getClearColor(this.prevClear);
    const prevBg = this.scene.background;
    const prevAuto = r.shadowMap.autoUpdate;
    const prevAutoClear = r.autoClear;
    this.scene.background = null;
    r.shadowMap.autoUpdate = false;
    r.autoClear = true;
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(this.a);
    r.render(this.scene, this.cam);
    const step = this.mat.uniforms.uStep!.value as Vector2;
    for (let t = 0; t < p.iterations; t++) {
      const k = p.spread * (1 + t);
      this.mat.uniforms.tMap!.value = this.a.texture;
      step.set(k / p.resX, 0);
      r.setRenderTarget(this.b);
      r.render(this.quadScene, this.quadCam);
      this.mat.uniforms.tMap!.value = this.b.texture;
      step.set(0, k / p.resY);
      r.setRenderTarget(this.a);
      r.render(this.quadScene, this.quadCam);
    }
    this.scene.background = prevBg;
    r.shadowMap.autoUpdate = prevAuto;
    r.autoClear = prevAutoClear;
    r.setClearColor(this.prevClear, prevAlpha);
    r.setRenderTarget(prevTarget);
    this.renders++;
  }

  dispose(): void {
    this.a.dispose();
    this.b.dispose();
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
