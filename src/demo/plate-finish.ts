import {
  CanvasTexture, EdgesGeometry, LineBasicMaterial, LineSegments, SRGBColorSpace,
  type DirectionalLight, type Mesh, type MeshStandardMaterial, type SpotLight,
} from 'three';
import type { Registry } from '../engine/core/registry';

/** Fixed seed and fixed work budget: the same notebook stock on every render. */
export const PLATE_PAPER_SEED = 0x1a11ea;
export const PLATE_PAPER_SIZE = 256;

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Neutral grain multiplies the material tint; recolouring the apparatus still works. */
export function createPaperGrain(): CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PLATE_PAPER_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const random = seeded(PLATE_PAPER_SEED);
  const image = context.createImageData(PLATE_PAPER_SIZE, PLATE_PAPER_SIZE);
  for (let i = 0; i < image.data.length; i += 4) {
    const value = 235 + Math.floor(random() * 21);
    image.data[i] = image.data[i + 1] = image.data[i + 2] = value;
    image.data[i + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  context.strokeStyle = 'rgba(99, 82, 61, .12)';
  context.lineWidth = 0.55;
  context.beginPath();
  for (let i = 0; i < 420; i++) {
    const x = random() * PLATE_PAPER_SIZE;
    const y = random() * PLATE_PAPER_SIZE;
    context.moveTo(x, y);
    context.lineTo(x + 1 + random() * 4, y + (random() - 0.5) * 1.6);
  }
  context.stroke();
  const texture = new CanvasTexture(canvas);
  texture.name = 'Field notebook seeded paper grain';
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** Small original treatment shared by the two lesson renderers. No scene geometry is displaced. */
export function createPlateFinish(registry: Registry, prefix: string, redraw: () => void) {
  const texture = createPaperGrain();
  const ink = new LineBasicMaterial({ color: '#49392d', transparent: true, opacity: 0.64, depthWrite: false });
  const edges: LineSegments[] = [];
  const papers = new Set<MeshStandardMaterial>();
  let relief = 0.16;
  let edgeSeed = PLATE_PAPER_SEED;
  registry.add({
    id: `${prefix}.finish`, label: 'Notebook paper and ink', kind: 'material',
    tags: ['paper', 'ink', 'texture', 'material'], source: 'src/demo/plate-finish.ts',
    describe: `Original paper grain, fixed seed ${PLATE_PAPER_SEED}, ${PLATE_PAPER_SIZE} square texels and 420 fibres. Edge ink follows the existing apparatus.`,
    params: [
      { key: 'inkOpacity', label: 'Edge ink opacity', type: 'number', min: 0, max: 1, step: 0.01,
        get: () => ink.opacity, set: value => { if (typeof value === 'number' && Number.isFinite(value)) { ink.opacity = value; redraw(); } } },
      { key: 'paperRelief', label: 'Paper grain relief', type: 'number', min: 0, max: 0.5, step: 0.01,
        get: () => relief, set: value => { if (typeof value === 'number' && Number.isFinite(value)) { relief = value; for (const material of papers) material.bumpScale = relief; redraw(); } } },
    ],
  });
  return {
    paper(material: MeshStandardMaterial) {
      if (!texture) return;
      material.map = texture;
      material.bumpMap = texture;
      material.bumpScale = relief;
      material.needsUpdate = true;
      papers.add(material);
    },
    outline(mesh: Mesh) {
      const geometry = new EdgesGeometry(mesh.geometry, 27);
      const points = geometry.getAttribute('position');
      // A submillimetre tremor, authored once, keeps the linework steady during motion.
      const random = seeded(edgeSeed++);
      for (let i = 0; i < points.count; i++) {
        points.setXYZ(i, points.getX(i) + (random() - 0.5) * 0.12,
          points.getY(i) + (random() - 0.5) * 0.12, points.getZ(i) + (random() - 0.5) * 0.12);
      }
      const line = new LineSegments(geometry, ink);
      line.name = 'Notebook ink edges';
      line.scale.setScalar(1.002);
      // Ink is visual only. It must not change bob or apparatus picking.
      line.raycast = () => {};
      mesh.add(line);
      edges.push(line);
    },
    light(light: DirectionalLight | SpotLight) {
      registry.add({
        id: `${prefix}.light`, label: 'Notebook key light', kind: 'light', tags: ['light', 'figure'],
        source: 'src/demo/plate-finish.ts',
        params: [
          { key: 'intensity', label: 'Key light intensity', type: 'number', min: 0, max: 8, step: 0.05,
            get: () => light.intensity, set: value => { if (typeof value === 'number' && Number.isFinite(value)) { light.intensity = value; redraw(); } } },
          { key: 'color', label: 'Key light colour', type: 'color',
            get: () => '#' + light.color.getHexString(), set: value => { if (typeof value === 'string') { light.color.set(value); redraw(); } } },
        ],
      });
    },
    dispose() {
      for (const line of edges) { line.removeFromParent(); line.geometry.dispose(); }
      ink.dispose();
      texture?.dispose();
      registry.remove(`${prefix}.finish`);
      registry.remove(`${prefix}.light`);
    },
  };
}
