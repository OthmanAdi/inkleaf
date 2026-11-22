/**
 * Paper-white model surfaces with engraved hatching: a patched MeshLambertMaterial. The vertex stage folds the
 * surface with the pop (`popWorld`); the light loop collects coloured spill from point lights and how visible the
 * key spot light is (its colour after cone, window cookie and shadow over its raw colour); the final colour is
 * replaced by paper tone plus object-space hatching whose lines keep their width on screen.
 */
import {
  BasicDepthPacking, Color, DoubleSide, FrontSide, MeshDepthMaterial, MeshLambertMaterial, ShaderChunk, Vector3, Vector4,
  type IUniform, type Texture, type WebGLProgramParametersWithUniforms,
} from 'three';
import { FOLD_GLSL } from './fold';
import type { InkEnv } from './params';
import type { PopUniforms } from './uniforms';

export interface PaperOptions {
  color?: string;
  ink?: string;
  /** Main hatch plane normal in object space (lines are the surface's intersections with planes along it). */
  hatchA?: readonly number[];
  /** Cross-hatch plane normal (shadow only). */
  hatchB?: readonly number[];
  /** Hatch line spacing in mm. */
  spacing?: number;
  /** Darkening of the paper tone on dark sides (0..1). */
  shade?: number;
  /** 1 = hatched, 0 = plain paper. */
  hatch?: number;
  seed?: number;
  map?: Texture | null;
  doubleSided?: boolean;
}

export const HATCH_GLSL = /* glsl */ `
uniform vec4 uHatchK0; // coverage, wobble, wobbleFreq, breakScale
uniform vec4 uHatchK1; // dutyMin, dutyMax, pxMin, pxMax
uniform vec4 uHatchK2; // aa, breakThreshold, breakHash, crossSpacing
uniform vec4 uHatchK3; // fineFrom, fineTo, fineDarkness, moireGain
uniform vec4 uHatchK4; // moireFrom, moireTo, overlap, mask1From
uniform vec4 uHatchK5; // mask1To, dark1From, mask2From, mask2To
uniform vec4 uHatchK6; // dark2From, seedCross, seedFine, breakSeed
uniform float uHatchQ;

float inkHs(vec3 q) {
  vec3 m = 17.0 * fract(0.3183099 * q + 0.1);
  return fract(m.x * m.y * m.z * (m.x + m.y + m.z));
}

float inkN3(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(inkHs(i), inkHs(i + vec3(1.0, 0.0, 0.0)), f.x), mix(inkHs(i + vec3(0.0, 1.0, 0.0)), inkHs(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(inkHs(i + vec3(0.0, 0.0, 1.0)), inkHs(i + vec3(1.0, 0.0, 1.0)), f.x), mix(inkHs(i + vec3(0.0, 1.0, 1.0)), inkHs(i + vec3(1.0)), f.x), f.y),
    f.z);
}

// One family of hatch lines at line coordinate h (centres at half-integers), fw = screen derivative of h.
float inkLevel(float h, float fw, float a, float bw, float darkness, float seed) {
  float f = abs(fract(h) - 0.5);
  float hw = min(mix(uHatchK1.x, uHatchK1.y, darkness), mix(uHatchK1.z, uHatchK1.w, darkness) * fw);
  float aa = max(uHatchK2.x * fw, 1e-4);
  float line = 1.0 - smoothstep(hw - aa, hw + aa, f);
  float brk = inkN3(vec3(floor(h) * uHatchK2.z + seed, a, uHatchK6.w * seed));
  line *= mix(1.0, smoothstep(uHatchK2.y - bw, uHatchK2.y + bw, brk), uHatchQ);
  return mix(line, uHatchK3.w * hw, smoothstep(uHatchK4.x, uHatchK4.y, fw));
}

float inkHatch(vec3 p, vec3 dir, vec3 along, float spacing, float darkness, float seed) {
  float h = dot(p, dir) / spacing + uHatchK0.y * (inkN3(uHatchK0.z * p + seed) - 0.5);
  float fw = fwidth(h);
  float a = dot(p, along) / uHatchK0.w;
  float bw = max(0.6 * fwidth(a), 0.001);
  float c = inkLevel(h, fw, a, bw, darkness, seed);
  float fine = 1.0 - smoothstep(uHatchK3.y, uHatchK3.x, fw);
  float c2 = inkLevel(2.0 * h, 2.0 * fw, a, bw, uHatchK3.z * darkness, seed + uHatchK6.z);
  return max(c, c2 * fine);
}
`;

const LUM = 'vec3( 0.2126, 0.7152, 0.0722 )';

/** The standard light loop with spill and key-visibility taps inserted before each light's RE_Direct call. */
export function patchedLightsChunk(): string {
  let src = ShaderChunk.lights_fragment_begin;
  const insertBeforeREAfter = (marker: string, code: string) => {
    const at = src.indexOf(marker);
    if (at < 0) throw new Error(`inkleaf: light loop marker "${marker}" not found (three.js changed)`);
    const re = src.indexOf('RE_Direct(', at);
    if (re < 0) throw new Error(`inkleaf: RE_Direct after "${marker}" not found (three.js changed)`);
    src = src.slice(0, re) + code + '\n\t\t' + src.slice(re);
  };
  insertBeforeREAfter('getPointLightInfo(', 'inkSpill += directLight.color * saturate( dot( geometryNormal, directLight.direction ) );');
  insertBeforeREAfter(
    'getSpotLightInfo(',
    `#if ( UNROLLED_LOOP_INDEX == 0 )\n\t\tinkKeyVis = dot( directLight.color, ${LUM} ) / max( dot( spotLight.color, ${LUM} ), 1e-6 );\n\t\t#endif`,
  );
  insertBeforeREAfter(
    'getDirectionalLightInfo(',
    `#if ( NUM_SPOT_LIGHTS == 0 ) && ( UNROLLED_LOOP_INDEX == 0 )\n\t\tinkKeyVis = dot( directLight.color, ${LUM} ) / max( dot( directionalLight.color, ${LUM} ), 1e-6 );\n\t\t#endif`,
  );
  return src;
}

let lightsChunk: string | null = null;

function inject(src: string, anchor: string, code: string, where: 'before' | 'after' | 'replace'): string {
  if (!src.includes(anchor)) throw new Error(`inkleaf: shader anchor "${anchor}" missing (three.js changed)`);
  const out = where === 'replace' ? code : where === 'before' ? `${code}\n${anchor}` : `${anchor}\n${code}`;
  return src.replace(anchor, () => out);
}

/** Unit vector across the hatch lines' direction of travel: (0,1,0) (or (1,0,0) when the plane is nearly horizontal) minus its component along `dir`. */
export function alongOf(dir: Vector3, out = new Vector3()): Vector3 {
  const e = Math.abs(dir.y) >= 0.9 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  return out.copy(e).addScaledVector(dir, -e.dot(dir)).normalize();
}

export interface PaperUniforms {
  uInkCol: IUniform<Color>;
  uHatchA: IUniform<Vector3>;
  uHatchB: IUniform<Vector3>;
  uAlongA: IUniform<Vector3>;
  uAlongB: IUniform<Vector3>;
  uSpacing: IUniform<number>;
  uShade: IUniform<number>;
  uHatch: IUniform<number>;
  uSeed: IUniform<number>;
  uClip: IUniform<Vector4>;
}

export interface PaperMaterial extends MeshLambertMaterial {
  userData: { isPaper: true; paperOpts: PaperOptions; paper: PaperUniforms; kitScale?: number };
}

/** Sets a hatch direction (normalised) and its along vector. */
export function setHatchDir(u: PaperUniforms, which: 'A' | 'B', dir: readonly number[]): void {
  const d = (which === 'A' ? u.uHatchA : u.uHatchB).value.set(dir[0] ?? 0, dir[1] ?? 1, dir[2] ?? 0).normalize();
  alongOf(d, (which === 'A' ? u.uAlongA : u.uAlongB).value);
}

/** Creates a paper material sharing the pop's uniforms and the world's hatch parameters. */
export function createPaperMaterial(env: InkEnv, pu: PopUniforms, opts: PaperOptions = {}): PaperMaterial {
  const m = new MeshLambertMaterial({
    color: new Color(opts.color ?? env.paper.color),
    map: opts.map ?? null,
    transparent: true,
    side: opts.doubleSided ? DoubleSide : FrontSide,
  }) as PaperMaterial;
  m.name = 'ink.paper';
  m.forceSinglePass = true;
  const pq: PaperUniforms = {
    uInkCol: { value: new Color(opts.ink ?? env.line.color) },
    uHatchA: { value: new Vector3() },
    uHatchB: { value: new Vector3() },
    uAlongA: { value: new Vector3() },
    uAlongB: { value: new Vector3() },
    uSpacing: { value: opts.spacing ?? env.paper.spacing },
    uShade: { value: opts.shade ?? env.paper.shade },
    uHatch: { value: opts.hatch ?? 1 },
    uSeed: { value: opts.seed ?? 1 },
    uClip: { value: new Vector4(0, 0, 0, -1) },
  };
  setHatchDir(pq, 'A', opts.hatchA ?? env.paper.hatchA);
  setHatchDir(pq, 'B', opts.hatchB ?? env.paper.hatchB);
  const all: Record<string, IUniform> = {
    ...pq,
    uScene: pu.uScene,
    uSceneInv: pu.uSceneInv,
    uCab: pu.uCab,
    uFoldK: env.u.uFoldK,
    uLiftSurf: pu.uLiftSurf,
    uPrint: pu.uPrint,
    uSurfAlpha: pu.uSurfAlpha,
    uIllus: env.u.uIllus,
    uHatchQ: env.u.uHatchQ,
    uHatchK0: env.u.uHatchK0,
    uHatchK1: env.u.uHatchK1,
    uHatchK2: env.u.uHatchK2,
    uHatchK3: env.u.uHatchK3,
    uHatchK4: env.u.uHatchK4,
    uHatchK5: env.u.uHatchK5,
    uHatchK6: env.u.uHatchK6,
    uPaperK0: env.u.uPaperK0,
    uPaperK1: env.u.uPaperK1,
  };
  m.userData = { isPaper: true, paperOpts: { ...opts }, paper: pq };
  m.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, all);
    let v = shader.vertexShader;
    v = inject(v, '#include <common>', `uniform mat4 uScene;\nuniform mat4 uSceneInv;\nuniform vec2 uCab;\nuniform vec4 uFoldK;\nuniform float uLiftSurf;\nvarying vec3 vInkObj;\nvarying vec3 vInkWorld;\n${FOLD_GLSL}`, 'after');
    v = inject(v, '#include <begin_vertex>', 'vInkObj = transformed;', 'after');
    v = inject(v, '#include <project_vertex>', /* glsl */ `
vec4 inkW = vec4( transformed, 1.0 );
#ifdef USE_BATCHING
  inkW = batchingMatrix * inkW;
#endif
#ifdef USE_INSTANCING
  inkW = instanceMatrix * inkW;
#endif
inkW = modelMatrix * inkW;
vec3 inkFolded = popWorld( inkW.xyz, uLiftSurf );
vInkWorld = inkFolded;
vec4 mvPosition = viewMatrix * vec4( inkFolded, 1.0 );
gl_Position = projectionMatrix * mvPosition;`, 'replace');
    v = inject(v, '#include <worldpos_vertex>', /* glsl */ `
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined ( USE_SHADOWMAP ) || defined ( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
  worldPosition = vec4( inkFolded, 1.0 );
#endif`, 'after');
    shader.vertexShader = v;

    let f = shader.fragmentShader;
    f = inject(f, '#include <common>', /* glsl */ `
uniform vec3 uInkCol;
uniform vec3 uHatchA;
uniform vec3 uHatchB;
uniform vec3 uAlongA;
uniform vec3 uAlongB;
uniform float uSpacing;
uniform float uShade;
uniform float uHatch;
uniform float uSeed;
uniform vec4 uClip;
uniform float uPrint;
uniform float uSurfAlpha;
uniform vec3 uIllus;
uniform vec4 uPaperK0; // form, formFloor, shadowFactor, spillGain
uniform vec4 uPaperK1; // keyVisFrom, keyVisTo, gain
varying vec3 vInkObj;
varying vec3 vInkWorld;
${HATCH_GLSL}`, 'after');
    f = inject(f, '#include <clipping_planes_fragment>', 'if ( dot( vec4( vInkWorld, 1.0 ), uClip ) > 0.0 ) discard;', 'after');
    lightsChunk ??= patchedLightsChunk();
    f = inject(f, '#include <lights_fragment_begin>', `vec3 inkSpill = vec3( 0.0 );\nfloat inkKeyVis = 1.0;\n${lightsChunk}`, 'replace');
    f = inject(f, '#include <opaque_fragment>', /* glsl */ `
float inkForm = clamp( dot( normal, uIllus ), 0.0, 1.0 ) * uPaperK0.x + uPaperK0.y;
float inkDark = 1.0 - inkForm * mix( uPaperK0.z, 1.0, smoothstep( uPaperK1.x, uPaperK1.y, inkKeyVis ) );
float inkH1 = inkHatch( vInkObj, uHatchA, uAlongA, uSpacing, smoothstep( uHatchK5.y, 1.0, inkDark ), uSeed ) * smoothstep( uHatchK4.w, uHatchK5.x, inkDark );
float inkH2 = inkHatch( vInkObj, uHatchB, uAlongB, uHatchK2.w * uSpacing, smoothstep( uHatchK6.x, 1.0, inkDark ), uSeed + uHatchK6.y ) * smoothstep( uHatchK5.z, uHatchK5.w, inkDark ) * uHatchQ;
float inkCov = clamp( max( inkH1, inkH2 ) + uHatchK4.z * min( inkH1, inkH2 ), 0.0, 1.0 ) * uHatch * uHatchK0.x;
vec3 inkBase = diffuseColor.rgb;
vec3 inkCol = inkBase * uPaperK1.z * ( 1.0 - uShade * inkDark ) + inkBase * inkSpill * uPaperK0.w;
if ( uPrint > 0.5 ) inkCol = vec3( 1.0 );
outgoingLight = mix( inkCol, uInkCol, inkCov );
diffuseColor.a *= uSurfAlpha;
#include <opaque_fragment>`, 'replace');
    shader.fragmentShader = f;
  };
  m.customProgramCacheKey = () => 'ink-paper-v1';
  return m;
}

/** The shared shadow depth material of a pop's surfaces: alpha-hashed so shadows fade with the paper. */
export function createFadingShadowMaterial(): MeshDepthMaterial {
  const m = new MeshDepthMaterial({ depthPacking: BasicDepthPacking, alphaHash: true });
  m.name = 'ink.fading-shadow';
  return m;
}
