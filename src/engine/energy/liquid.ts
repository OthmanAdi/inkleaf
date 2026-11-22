/**
 * The glowing jar liquid: a unit-height cylinder scaled to the fill level, shaded brighter toward the top, with a
 * rim glow, slow internal currents and a bright cap. Output is HDR (above 1) so the selective bloom picks it up.
 */
import { Color, FrontSide, ShaderMaterial, type IUniform } from 'three';
import { energyConfig } from './config';

/** Shading uniforms shared by every liquid (one write per frame updates all jars). */
const shared = {
  uBase: { value: 0.58 },
  uHeight: { value: 0.34 },
  uRim: { value: 0.55 },
  uRimPow: { value: 2.2 },
  uCurrent: { value: 0.16 },
  uCurY: { value: 0.42 },
  uCurSpeed: { value: 1.1 },
  uSwirl: { value: 1.6 },
  uSwirlFreq: { value: 3 },
  uSwirlSpeed: { value: 0.6 },
  uCapBase: { value: 1.25 },
  uCapGain: { value: 0.55 },
  uCapRadius: { value: 11.7 },
  uCapEdge: { value: 0.55 },
} satisfies Record<string, IUniform<number>>;

/** Copies `energy.jar-liquid` into the shared uniforms. */
export function syncLiquidUniforms(): void {
  const l = energyConfig.liquid;
  shared.uBase.value = l.base;
  shared.uHeight.value = l.height;
  shared.uRim.value = l.rim;
  shared.uRimPow.value = l.rimPower;
  shared.uCurrent.value = l.current;
  shared.uCurY.value = l.currentY;
  shared.uCurSpeed.value = l.currentSpeed;
  shared.uSwirl.value = l.swirl;
  shared.uSwirlFreq.value = l.swirlFreq;
  shared.uSwirlSpeed.value = l.swirlSpeed;
  shared.uCapBase.value = l.capBase;
  shared.uCapGain.value = l.capGain;
  shared.uCapRadius.value = l.capRadius;
  shared.uCapEdge.value = l.capEdge;
}

const VERTEX = /* glsl */ `
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
void main() {
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uGlow;
uniform float uAlpha;
uniform float uTop;
uniform float uTime;
uniform float uBase, uHeight, uRim, uRimPow, uCurrent, uCurY, uCurSpeed, uSwirl, uSwirlFreq, uSwirlSpeed;
uniform float uCapBase, uCapGain, uCapRadius, uCapEdge;
varying vec3 vP;
varying vec3 vN;
varying vec3 vV;
void main() {
  vec3 n = normalize(vN);
  float hgt = clamp(vP.y / uTop, 0.0, 1.0);
  float facing = abs(dot(n, normalize(vV)));
  float rim = pow(1.0 - facing, uRimPow);
  float a = atan(vP.z, vP.x);
  float sw = 0.5 + 0.5 * sin(uCurY * vP.y - uCurSpeed * uTime + uSwirl * sin(uSwirlFreq * a + uSwirlSpeed * uTime));
  float b = uBase + uHeight * hgt + uRim * rim + uCurrent * sw;
  if (n.y > 0.5) {
    float rr = length(vP.xz) / uCapRadius;
    b = uCapBase + uCapGain * smoothstep(uCapEdge, 1.0, rr);
  }
  gl_FragColor = vec4(uColor * uGlow * b, uAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export interface LiquidUniforms {
  uColor: IUniform<Color>;
  uGlow: IUniform<number>;
  uAlpha: IUniform<number>;
  uTop: IUniform<number>;
  uTime: IUniform<number>;
}

export type LiquidMaterial = ShaderMaterial & { uniforms: LiquidUniforms & typeof shared };

export function createLiquidMaterial(color: Color): LiquidMaterial {
  syncLiquidUniforms();
  const m = new ShaderMaterial({
    uniforms: {
      uColor: { value: color.clone() },
      uGlow: { value: energyConfig.glow.liquid },
      uAlpha: { value: 0 },
      uTop: { value: 1 },
      uTime: { value: 0 },
      ...shared,
    },
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    side: FrontSide,
    transparent: true,
    depthWrite: true,
  });
  m.name = 'energy-liquid';
  return m as LiquidMaterial;
}
