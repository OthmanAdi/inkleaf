/**
 * The pen line shader. Each polyline is a triangle-strip ribbon extruded in screen space: standing lines keep a
 * constant on-screen width (a pen line keeps its width at any zoom), lines lying on the page are 0.34 mm wide like
 * printed ink, and the blend follows the lift. Strokes are revealed by arc length behind an invisible pen head;
 * the flat twin shows exactly the part the pen has not reached yet.
 */
import { Color, ShaderMaterial, Vector4, type IUniform } from 'three';
import { FOLD_GLSL } from './fold';
import type { InkEnv } from './params';
import type { PopUniforms } from './uniforms';

export const LINE_VERTEX = /* glsl */ `
uniform mat4 uScene;
uniform mat4 uSceneInv;
uniform vec2 uCab;
uniform vec4 uFoldK;
uniform float uClock;
uniform float uLiftAll;
uniform float uPrint;
uniform float uPxPerMm;
uniform vec2 uRes;
uniform float uWidthPx;
uniform float uBias;
uniform float uMinW;
uniform float uCopy;
uniform vec4 uLineA; // lineScale x widthScale, widthMm, standLift, aaMargin
uniform vec4 uLineB; // miterCap, miterFloor, flipDot, subPixel
uniform vec4 uLineC; // flatDepth, visFadeFrom, visFadeTo, minCoverage

attribute vec3 aPrev;
attribute vec3 aNext;
attribute float aS;
attribute vec4 aLine; // length, t0, dur, base width
attribute vec2 aSide; // side, width factor
attribute float aVis;

varying float vS;
varying float vHead;
varying float vGrow;
varying float vD;
varying float vHalf;
varying float vAlpha;
varying vec3 vWorld;

${FOLD_GLSL}

vec4 biased(vec4 v) {
  if (isOrthographic) { v.z += uBias; return v; }
  v.xyz += normalize(-v.xyz) * uBias;
  return v;
}

void main() {
  float prog = clamp((uClock - aLine.y) / max(aLine.z, 0.001), 0.0, 1.0);
  float head = prog * aLine.x + (prog >= 1.0 ? 1.0 : 0.0);
  bool printing = uPrint > 0.5;
  bool copy = uCopy > 0.5;

  vec3 wP = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 wA = (modelMatrix * vec4(aPrev, 1.0)).xyz;
  vec3 wB = (modelMatrix * vec4(aNext, 1.0)).xyz;
  float lP = 1.0;
  if (!printing) {
    lP = copy ? 0.0 : uLiftAll;
    wP = popWorld(wP, lP);
    wA = popWorld(wA, lP);
    wB = popWorld(wB, lP);
  }
  vWorld = wP;

  vec4 cP = projectionMatrix * biased(viewMatrix * vec4(wP, 1.0));
  vec4 cA = projectionMatrix * biased(viewMatrix * vec4(wA, 1.0));
  vec4 cB = projectionMatrix * biased(viewMatrix * vec4(wB, 1.0));

  vec2 halfRes = 0.5 * uRes;
  vec2 sP = cP.xy / cP.w * halfRes;
  vec2 sA = cA.xy / cA.w * halfRes;
  vec2 sB = cB.xy / cB.w * halfRes;
  vec2 t1 = sP - sA;
  vec2 t2 = sB - sP;
  float l1 = length(t1);
  float l2 = length(t2);
  vec2 dir = vec2(1.0, 0.0);
  float miter = 1.0;
  if (l1 > 1e-5 && l2 > 1e-5) {
    vec2 a = t1 / l1;
    vec2 b = t2 / l2;
    dir = dot(a, b) < uLineB.z ? b : normalize(a + b);
    miter = 1.0 / max(uLineB.y, abs(dot(vec2(-dir.y, dir.x), vec2(-a.y, a.x))));
  } else if (l1 > 1e-5) {
    dir = t1 / l1;
  } else if (l2 > 1e-5) {
    dir = t2 / l2;
  }
  vec2 n = vec2(-dir.y, dir.x);

  float pxPerMm = printing ? uPxPerMm : 0.5 * uRes.y * projectionMatrix[1][1] / cP.w;
  float stand = printing ? 0.0 : smoothstep(0.0, uLineA.z, lP);
  float w = mix(uLineA.y * pxPerMm, uWidthPx * uLineA.x, stand) * aSide.y;
  float hw = 0.5 * w;
  float alpha = clamp(hw / uLineB.w, 0.0, 1.0);
  if (!printing) {
    if (aLine.w < uMinW) alpha = 0.0;
    alpha *= mix(max(aVis, 0.0), 1.0, smoothstep(uLineC.y, uLineC.z, lP));
  } else if (aVis < -0.5) {
    alpha = 0.0;
  }
  hw = max(hw, uLineB.w);
  float ext = hw + uLineA.w;
  vD = aSide.x * ext;
  vHalf = hw;
  vAlpha = alpha;
  cP.xy += n * (aSide.x * ext * min(miter, uLineB.x)) / halfRes * cP.w;
  if (!printing && copy) {
    #ifdef USE_REVERSED_DEPTH_BUFFER
      cP.z = uLineC.x * cP.w;
    #else
      cP.z = -uLineC.x * cP.w;
    #endif
  }
  vS = aS;
  vHead = head;
  vGrow = printing ? 0.0 : (copy ? -1.0 : 1.0);
  gl_Position = cP;
}
`;

export const LINE_FRAGMENT = /* glsl */ `
uniform vec3 uInk;
uniform float uOpacity;
uniform float uStandAlpha;
uniform float uCopyAlpha;
uniform float uCopy;
uniform vec4 uClip;
uniform vec4 uLineC;

varying float vS;
varying float vHead;
varying float vGrow;
varying float vD;
varying float vHalf;
varying float vAlpha;
varying vec3 vWorld;

void main() {
  if (dot(vec4(vWorld, 1.0), uClip) > 0.0) discard;
  if (vGrow > 0.5 && vS > vHead) discard;
  if (vGrow < -0.5 && vS <= vHead) discard;
  float cov = clamp(vHalf + 0.5 - abs(vD), 0.0, 1.0) * vAlpha * uOpacity * (uCopy > 0.5 ? uCopyAlpha : uStandAlpha);
  if (cov < uLineC.w) discard;
  gl_FragColor = vec4(uInk, cov);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface InkMaterialOptions {
  color?: string;
  /** Standing width in screen pixels before the line scale (default `ink.line.widthPx` = 1.5). */
  widthPx?: number;
  opacity?: number;
  /** View-space pull toward the eye in mm (default 2). */
  bias?: number;
  /** Own pen clock (sub-assemblies redrawn on a switch); default is the pop clock. */
  clock?: IUniform<number>;
  /** Draw over everything (rings). */
  depthTest?: boolean;
}

export interface InkMaterial extends ShaderMaterial {
  userData: {
    inkOpts: InkMaterialOptions;
    /** True when the width follows the `ink.line.widthPx` default. */
    defaultWidth: boolean;
    isInk: true;
  };
}

/** Creates a pen line material sharing the pop's uniforms and the world's ink parameters. */
export function createInkMaterial(env: InkEnv, pu: PopUniforms, opts: InkMaterialOptions = {}): InkMaterial {
  const uniforms: Record<string, IUniform> = {
    uScene: pu.uScene,
    uSceneInv: pu.uSceneInv,
    uCab: pu.uCab,
    uFoldK: env.u.uFoldK,
    uClock: opts.clock ?? pu.uClock,
    uLiftAll: pu.uLiftAll,
    uPrint: pu.uPrint,
    uPxPerMm: pu.uPxPerMm,
    uRes: pu.uRes,
    uStandAlpha: pu.uStandAlpha,
    uCopyAlpha: pu.uCopyAlpha,
    uMinW: env.u.uMinW,
    uLineA: env.u.uLineA,
    uLineB: env.u.uLineB,
    uLineC: env.u.uLineC,
    uWidthPx: { value: opts.widthPx ?? env.line.widthPx },
    uBias: { value: opts.bias ?? env.line.bias },
    uInk: { value: new Color(opts.color ?? env.line.color) },
    uOpacity: { value: opts.opacity ?? env.line.opacity },
    uCopy: { value: 0 },
    uClip: { value: new Vector4(0, 0, 0, -1) },
  };
  const m = new ShaderMaterial({
    name: 'ink.line',
    uniforms,
    vertexShader: LINE_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    depthTest: opts.depthTest ?? true,
  }) as InkMaterial;
  m.userData = { inkOpts: { ...opts }, defaultWidth: opts.widthPx === undefined, isInk: true };
  return m;
}

/**
 * The flat twin's material: the same uniform objects except its own `uCopy = 1` and its own never-cutting clip.
 * Shares the compiled program with the standing material.
 */
export function createFlatMaterial(standing: ShaderMaterial): ShaderMaterial {
  const uniforms: Record<string, IUniform> = { ...standing.uniforms, uCopy: { value: 1 }, uClip: { value: new Vector4(0, 0, 0, -1) } };
  const m = new ShaderMaterial({
    name: 'ink.line.flat',
    uniforms,
    vertexShader: standing.vertexShader,
    fragmentShader: standing.fragmentShader,
    transparent: true,
    depthWrite: false,
    depthTest: standing.depthTest,
  });
  m.userData = { flatOf: standing };
  return m;
}
