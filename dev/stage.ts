/**
 * Dev page for the stage, lights and post chain, built on the real engine (`createEngine`).
 *
 *   ?pose=read        reading camera (default: the closed-book landing camera)
 *   ?book=closed|open|none   stand-in book (default: closed for the landing pose, open for read)
 *   ?glow=0           no glowing sphere (no bloom, no spill)
 *   ?glass            glass capsule and lens over the frame
 *   ?orbit            orbit controls
 *   ?inspect          the registry inspector
 *   plus the engine switches: ?q=low|medium|high, ?noao, ?exp=, ?bloom=, ?vig=, ?lg=, ?spill=
 */
import {
  BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, SphereGeometry, Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createEngine } from '../src/engine/core/app';
import { mountInspector } from '../src/engine/core/inspector';
import { LAYERS, type GlassRect, type GlowSource } from '../src/engine/contracts';

const url = new URLSearchParams(location.search);
const canvas = document.getElementById('c') as HTMLCanvasElement;
const engine = createEngine(canvas);
const { ctx, stage, post } = engine;
const { scene, camera, registry } = ctx;

const POSES = {
  closed: { pos: new Vector3(-193.55, 360, 400), look: new Vector3(110.45, -8, 6) },
  read: { pos: new Vector3(16, 430, 400), look: new Vector3(12, 24, 4) },
};
const poseName = url.get('pose') === 'read' ? 'read' : 'closed';
const pose = POSES[poseName];
camera.position.copy(pose.pos);
camera.lookAt(pose.look);

const deskTop = stage.deskTop;
const cloth = new MeshPhysicalMaterial({ color: '#c8961e', roughness: 0.8, sheen: 1, sheenColor: new Color('#f3d79a'), sheenRoughness: 0.42 });
const paper = new MeshStandardMaterial({ color: '#f4efe2', roughness: 0.9 });
const pageEdge = new MeshStandardMaterial({ color: '#e9e2d0', roughness: 0.95 });

// The glow map lands on the stand-in pages the way page materials consume it: added after lighting.
const spillUniforms = {
  uSpill: { value: post.spillMap.texture },
  uSpillRect: { value: post.spillMap.rect },
  uSpillGain: { value: post.spillMap.gain },
};
paper.onBeforeCompile = (s: WebGLProgramParametersWithUniforms) => {
  Object.assign(s.uniforms, spillUniforms);
  s.vertexShader = s.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSpillWorld;')
    .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvSpillWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
  s.fragmentShader = s.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vSpillWorld;\nuniform sampler2D uSpill;\nuniform vec4 uSpillRect;\nuniform float uSpillGain;')
    .replace('#include <opaque_fragment>', [
      'vec2 spillQ = (vSpillWorld.xz - uSpillRect.xy) / uSpillRect.zw;',
      'float spillIn = step(0.0, spillQ.x) * step(spillQ.x, 1.0) * step(0.0, spillQ.y) * step(spillQ.y, 1.0);',
      'outgoingLight += diffuseColor.rgb * texture2D(uSpill, vec2(spillQ.x, 1.0 - spillQ.y)).rgb * uSpillGain * spillIn;',
      '#include <opaque_fragment>',
    ].join('\n'));
};

const book = new Group();
book.name = 'dev.book';
const bookMode = url.get('book') ?? (poseName === 'read' ? 'open' : 'closed');
const box = (w: number, h: number, d: number, mats: MeshStandardMaterial | MeshStandardMaterial[], x: number, y: number, z: number) => {
  const m = new Mesh(new BoxGeometry(w, h, d), mats);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  book.add(m);
  return m;
};
if (bookMode === 'closed') {
  box(204, 19, 258, cloth, 101.45, deskTop + 9.5, 0);
} else if (bookMode === 'open') {
  box(190, 3, 258, cloth, 108.45, deskTop + 1.5, 0);
  box(190, 3, 258, cloth, -108.45, deskTop + 1.5, 0);
  box(27, 2, 258, cloth, 0, deskTop + 1, 0);
  const sides = (top: MeshStandardMaterial) => [pageEdge, pageEdge, top, pageEdge, pageEdge, pageEdge];
  const yb = -9.575;
  box(190, 3.025 - yb, 250, sides(paper), 104.45, (3.025 + yb) / 2, 0);
  box(190, -3.025 - yb, 250, sides(paper), -104.45, (-3.025 + yb) / 2, 0);
}
scene.add(book);
registry.add({
  id: 'dev.book', label: 'Stand-in book', kind: 'object', tags: ['object', 'book'], object: book, source: 'dev/stage.ts',
  describe: 'Boxes standing in for the book on the stage dev page.',
});

// A small glowing sphere: selected for bloom, drawn into the glow map, and a spill light source.
const glowOn = url.get('glow') !== '0';
const glowColor = new Color('#ff7a1c');
const sphere = new Mesh(new SphereGeometry(7, 32, 16), new MeshBasicMaterial({ color: glowColor.clone().multiplyScalar(4) }));
if (bookMode === 'open') sphere.position.set(70, 34, -40);
else sphere.position.set(150, 40, 55);
sphere.visible = glowOn;
sphere.layers.enable(LAYERS.glow);
scene.add(sphere);
if (glowOn) post.bloomSelect(sphere, true);
registry.add({
  id: 'dev.glow', label: 'Glow test sphere', kind: 'object', tags: ['object', 'energy'], object: sphere, source: 'dev/stage.ts',
  describe: 'Bloom-selected sphere on the glow layer that feeds one spill light.',
});
const source: GlowSource = { id: 'dev.glow', position: sphere.position, color: glowColor, strength: 1 };
const sources = [source];
engine.setSpillDriver({ live: () => glowOn, sources: () => sources });

if (url.has('orbit')) {
  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(pose.look);
  controls.update();
  ctx.onFrame('camera', () => controls.update());
}

if (url.has('glass')) {
  const cap = document.createElement('div');
  cap.className = 'glass-demo';
  cap.textContent = '1  Energy stores';
  const lens = document.createElement('div');
  lens.className = 'lens-demo';
  lens.style.transform = `translate(${innerWidth * 0.62 - 66}px, ${innerHeight * 0.42 - 66}px)`;
  document.body.append(cap, lens);
  addEventListener('pointermove', (e) => (lens.style.transform = `translate(${e.clientX - 66}px, ${e.clientY - 66}px)`));
  const rects: GlassRect[] = [
    { x: 0, y: 0, w: 0, h: 0, radius: 27, tint: 0.38, strength: 1, pressed: false, zoom: 1 },
    { x: 0, y: 0, w: 0, h: 0, radius: 66, tint: 0.02, strength: 1, pressed: false, zoom: 1.75 },
  ];
  ctx.onFrame('ui', () => {
    const pr = ctx.renderer.getPixelRatio();
    [cap, lens].forEach((el, i) => {
      const b = el.getBoundingClientRect();
      Object.assign(rects[i]!, { x: b.left * pr, y: b.top * pr, w: b.width * pr, h: b.height * pr, radius: (i ? 66 : 27) * pr });
    });
    post.setGlassRects(rects);
  });
}

if (url.has('inspect')) mountInspector(registry);
const w = window as unknown as Record<string, unknown>;
w.inkleaf = { engine, registry, set: registry.set.bind(registry), describe: registry.describe.bind(registry) };
w.__bench = (n?: number) => engine.bench(n);
let readyFrames = -1;
void stage.ready.then(() => (readyFrames = 0));
ctx.onFrame('after', () => {
  if (readyFrames >= 0 && ++readyFrames === 8) w.__ready = true;
});
ctx.start();
