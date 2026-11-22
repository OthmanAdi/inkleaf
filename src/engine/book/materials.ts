/**
 * Book materials: the page paper (MeshStandardMaterial patched with print, ink and glow-spill slots plus back-lit
 * translucency), the page-edge material with sheet striation, the cloth (MeshPhysicalMaterial with weave, foil and
 * blind stamping), ribbon, head bands and the cover plate.
 */
import {
  Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, Vector2, Vector4,
  type IUniform, type Texture, type Vector3, type WebGLProgramParametersWithUniforms,
} from 'three';
import { dataTexture } from './textures';

const white1 = () => dataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
const black1 = () => dataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
const flat1 = () => dataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1);

let WHITE: Texture | null = null, BLACK: Texture | null = null, FLAT: Texture | null = null;
export const whiteTex = () => (WHITE ??= white1());
export const blackTex = () => (BLACK ??= black1());
export const flatNormalTex = () => (FLAT ??= flat1());

/** A material that draws nothing (used for hidden faces of the page slabs). */
export const invisibleMaterial = () => {
  const m = new MeshBasicMaterial();
  m.visible = false;
  return m;
};

// ------------------------------------------------------------------------------------------------ page paper

export interface PageUniforms {
  uPageSize: IUniform<Vector2>;
  uInk: IUniform<Texture>;
  uInkRect: IUniform<Vector4>;
  uInkAlpha: IUniform<number>;
  uPrint: IUniform<Texture>;
  uPrintRect: IUniform<Vector4>;
  uPrintAlpha: IUniform<number>;
  uSpill: IUniform<Texture>;
  uSpillRect: IUniform<Vector4>;
  uSpillGain: IUniform<number>;
  uTrans: IUniform<number>;
  uKeyDir: IUniform<Vector3>;
  uKeyColor: IUniform<Color>;
}

const PAGE_PARS = /* glsl */ `
uniform vec2 uPageSize;
uniform sampler2D uInk; uniform vec4 uInkRect; uniform float uInkAlpha;
uniform sampler2D uPrint; uniform vec4 uPrintRect; uniform float uPrintAlpha;
uniform sampler2D uSpill; uniform vec4 uSpillRect; uniform float uSpillGain;
uniform float uTrans;
uniform vec3 uKeyDir; uniform vec3 uKeyColor;
varying vec2 vPageUv;
// Slot helper: page mm -> slot UV (v flipped so canvas row 0 lands on the slot's top edge); w = 1 inside.
vec3 inkleafSlot(vec4 r) {
  vec2 mm = vPageUv * uPageSize;
  vec2 q = (mm - r.xy) / max(r.zw, vec2(1e-4));
  float inside = step(0.0, q.x) * step(q.x, 1.0) * step(0.0, q.y) * step(q.y, 1.0) * step(1e-4, r.z);
  return vec3(clamp(q.x, 0.0, 1.0), 1.0 - clamp(q.y, 0.0, 1.0), inside);
}
`;

export class PageMaterial extends MeshStandardMaterial {
  readonly uniforms: PageUniforms;
  constructor(opts: { map: Texture | null; normalMap: Texture; normalScale: number; roughness: number; keyDir: IUniform<Vector3>; keyColor: IUniform<Color> }) {
    super({ color: 0xffffff, roughness: opts.roughness, metalness: 0, map: opts.map, normalMap: opts.normalMap, normalScale: new Vector2(opts.normalScale, opts.normalScale) });
    this.uniforms = {
      uPageSize: { value: new Vector2(190, 250) },
      uInk: { value: whiteTex() }, uInkRect: { value: new Vector4() }, uInkAlpha: { value: 1 },
      uPrint: { value: whiteTex() }, uPrintRect: { value: new Vector4() }, uPrintAlpha: { value: 0 },
      uSpill: { value: blackTex() }, uSpillRect: { value: new Vector4() }, uSpillGain: { value: 2.4 },
      uTrans: { value: 0 },
      uKeyDir: opts.keyDir, uKeyColor: opts.keyColor,
    };
  }

  override onBeforeCompile(sh: WebGLProgramParametersWithUniforms): void {
    Object.assign(sh.uniforms, this.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPageUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvPageUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + PAGE_PARS)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        vec3 inkS = inkleafSlot(uInkRect);
        vec4 inkT = texture2D(uInk, inkS.xy);
        diffuseColor.rgb *= mix(vec3(1.0), inkT.rgb, inkT.a * inkS.z * uInkAlpha);
        vec3 prS = inkleafSlot(uPrintRect);
        vec4 prT = texture2D(uPrint, prS.xy);
        diffuseColor.rgb *= mix(vec3(1.0), prT.rgb, prT.a * prS.z * uPrintAlpha);
        vec3 spS = inkleafSlot(uSpillRect);
        vec3 spillCol = texture2D(uSpill, spS.xy).rgb * spS.z * uSpillGain;`,
      )
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse += uTrans * uKeyColor * max(0.0, dot(-normal, uKeyDir)) * diffuseColor.rgb;`,
      )
      .replace('#include <opaque_fragment>', 'outgoingLight += diffuseColor.rgb * spillCol;\n#include <opaque_fragment>');
  }

  override customProgramCacheKey(): string {
    return 'inkleaf-page-1';
  }
}

// ------------------------------------------------------------------------------------------------ page edges

export class EdgeMaterial extends MeshStandardMaterial {
  readonly uniforms = {
    uLeafFrom: { value: 6 }, uLeafTo: { value: 13.15 }, uLeaf: { value: 0.55 },
    uSheet: { value: 0.11 }, uSheetLine: { value: 0.1 }, uLeafLine: { value: 0.16 },
  };
  constructor(color = '#efe7d6', roughness = 0.9) {
    super({ color, roughness, metalness: 0 });
  }
  override onBeforeCompile(sh: WebGLProgramParametersWithUniforms): void {
    Object.assign(sh.uniforms, this.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vEdgeUv;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvEdgeUv = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vEdgeUv;
        uniform float uLeafFrom, uLeafTo, uLeaf, uSheet, uSheetLine, uLeafLine;
        float edgeHash(float n) { return fract(sin(n * 91.345) * 47453.5453); }
        // Thin line at every half-integer of f, fading to its mean coverage 2w when below a pixel.
        float edgeLines(float f, float w) {
          float fw = max(fwidth(f), 1e-4);
          float d = abs(f - floor(f + 0.5));
          float l = smoothstep(0.5 - w - fw, 0.5 - w + fw, d);
          return mix(l, 2.0 * w, smoothstep(0.25, 0.6, fw));
        }`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float sigma = vEdgeUv.y;
        float sheet = sigma / uSheet;
        float tone = 0.94 + 0.06 * edgeHash(floor(sheet));
        tone = mix(tone, 0.97, smoothstep(0.3, 0.8, fwidth(sheet)));
        float linesS = edgeLines(sheet, 0.12);
        float inLeaves = step(uLeafFrom, sigma) * step(sigma, uLeafTo);
        float leafL = edgeLines((sigma - uLeafFrom) / uLeaf + 0.5, 0.06) * inLeaves;
        float wav = 0.985 + 0.015 * sin(0.21 * vEdgeUv.x + 1.7 * floor(sheet));
        diffuseColor.rgb *= tone * wav * (1.0 - uSheetLine * linesS - uLeafLine * leafL);`,
      );
  }
  override customProgramCacheKey(): string {
    return 'inkleaf-edge-1';
  }
}

// ------------------------------------------------------------------------------------------------ cloth

export interface ClothLook {
  color: string;
  sheen: number;
  sheenColor: string;
  sheenRoughness: number;
  normalScale: number;
  foilColor: readonly number[];
  foilRoughness: number;
  foilBoost: number;
  debossDarken: number;
  threads: number;
  tileMm: number;
}

export class ClothMaterial extends MeshPhysicalMaterial {
  readonly uniforms = {
    uLayout: { value: blackTex() as Texture },
    uLayoutN: { value: flatNormalTex() as Texture },
    uHasLayout: { value: 0 },
    uThreads: { value: 72 },
    uFoilColor: { value: new Color(0.96, 0.5, 0.24) },
    uFoilRough: { value: 0.15 },
    uFoilBoost: { value: 1.15 },
    uDebossDarken: { value: 0.22 },
  };
  constructor(weave: { ar: Texture; normal: Texture }, look: ClothLook) {
    super({
      color: look.color, roughness: 1, metalness: 0, roughnessMap: weave.ar, normalMap: weave.normal,
      normalScale: new Vector2(look.normalScale, look.normalScale), sheen: look.sheen, sheenColor: look.sheenColor, sheenRoughness: look.sheenRoughness,
    });
    this.apply(look);
  }
  apply(look: ClothLook): void {
    this.color.set(look.color);
    this.sheen = look.sheen;
    this.sheenColor.set(look.sheenColor);
    this.sheenRoughness = look.sheenRoughness;
    this.normalScale.set(look.normalScale, look.normalScale);
    this.uniforms.uFoilColor.value.setRGB(look.foilColor[0] ?? 0.96, look.foilColor[1] ?? 0.5, look.foilColor[2] ?? 0.24);
    this.uniforms.uFoilRough.value = look.foilRoughness;
    this.uniforms.uFoilBoost.value = look.foilBoost;
    this.uniforms.uDebossDarken.value = look.debossDarken;
    this.uniforms.uThreads.value = look.threads;
    for (const t of [this.roughnessMap, this.normalMap]) t?.repeat.set(1 / look.tileMm, 1 / look.tileMm);
  }
  setLayout(layout: Texture | null, normal: Texture | null): void {
    this.uniforms.uLayout.value = layout ?? blackTex();
    this.uniforms.uLayoutN.value = normal ?? flatNormalTex();
    this.uniforms.uHasLayout.value = layout ? 1 : 0;
  }
  override onBeforeCompile(sh: WebGLProgramParametersWithUniforms): void {
    Object.assign(sh.uniforms, this.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aLayout;\nvarying vec2 vLayout;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvLayout = aLayout;');
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        varying vec2 vLayout;
        uniform sampler2D uLayout, uLayoutN;
        uniform float uHasLayout, uThreads, uFoilRough, uFoilBoost, uDebossDarken;
        uniform vec3 uFoilColor;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float lHas = step(0.0, vLayout.x) * uHasLayout;
        vec2 lUv = clamp(vLayout, 0.0, 1.0);
        vec4 lay = texture2D(uLayout, lUv);
        float foil = lay.r * lHas;
        float deb = lay.g * lHas;
        float tone = mix(0.5, lay.b, lHas);
        float threadPx = length(fwidth(vNormalMapUv * uThreads));
        float fine = 1.0 - smoothstep(0.32, 0.62, threadPx);
        vec4 weaveTex = texture2D(roughnessMap, vRoughnessMapUv);
        float weave = mix(0.5, weaveTex.r, mix(0.35, 1.0, fine));
        vec3 clothCol = diffuseColor.rgb * 2.0 * weave * (1.0 + (tone - 0.5) * 1.6) * (1.0 - uDebossDarken * deb);
        vec3 metalCol = uFoilColor * (0.9 + 0.2 * weave);
        diffuseColor.rgb = mix(clothCol, metalCol, foil);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness * weaveTex.g;
        roughnessFactor = mix(roughnessFactor * 0.92 * (1.0 - 0.25 * deb), uFoilRough * (0.75 + 0.5 * weave), foil);`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 1.0, foil);')
      .replace(
        '#include <normal_fragment_maps>',
        `vec3 mapN = texture2D(normalMap, vNormalMapUv).xyz * 2.0 - 1.0;
        mapN.xy *= normalScale * (1.0 - 0.1 * foil) * (1.0 - 0.45 * deb) * mix(0.3, 1.0, fine);
        vec3 layN = lHas > 0.5 ? texture2D(uLayoutN, lUv).xyz * 2.0 - 1.0 : vec3(0.0, 0.0, 1.0);
        normal = normalize(tbn * normalize(vec3(mapN.xy + layN.xy, mapN.z * layN.z)));`,
      )
      .replace('material.sheenColor = sheenColor;', 'material.sheenColor = sheenColor * (1.0 - foil);')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
        reflectedLight.directDiffuse *= mix(1.0, uFoilBoost, foil);
        reflectedLight.directSpecular *= mix(1.0, uFoilBoost, foil);`,
      );
  }
  override customProgramCacheKey(): string {
    return 'inkleaf-cloth-1';
  }
}

// ------------------------------------------------------------------------------------------------ ribbon

export class RibbonMaterial extends MeshPhysicalMaterial {
  readonly uniforms = { uRib: { value: whiteTex() as Texture } };
  constructor(rib: { albedo: Texture; normal: Texture }, look: { color: string; roughness: number; normalScale: number; sheen: number; sheenColor: string; sheenRoughness: number; tileMm: number }) {
    super({
      color: look.color, roughness: look.roughness, normalMap: rib.normal, normalScale: new Vector2(look.normalScale, look.normalScale),
      sheen: look.sheen, sheenColor: look.sheenColor, sheenRoughness: look.sheenRoughness, side: DoubleSide,
    });
    this.uniforms.uRib.value = rib.albedo;
    rib.normal.repeat.set(1 / look.tileMm, 1 / look.tileMm);
  }
  override onBeforeCompile(sh: WebGLProgramParametersWithUniforms): void {
    Object.assign(sh.uniforms, this.uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uRib;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 2.0 * texture2D(uRib, vNormalMapUv).r;');
  }
  override customProgramCacheKey(): string {
    return 'inkleaf-ribbon-1';
  }
}
