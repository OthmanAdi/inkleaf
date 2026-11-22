/**
 * The room environment: a procedural room (grey walls, warm floor, a bright four-pane window at the key light and a
 * warm bounce panel) rendered once into a PMREM cube. Glossy and rough surfaces pick up a cool window reflection
 * from back-left, a dim warm fill from back-right, a mid-grey ceiling and a dark warm floor.
 */
import {
  BackSide, BoxGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, PMREMGenerator, Scene, Vector3,
  type Texture, type WebGLRenderer, type WebGLRenderTarget, type BufferGeometry,
} from 'three';

type V3 = readonly [number, number, number];

export interface RoomOptions {
  /** Half size of the room box, mm. */
  roomHalf: number;
  /** Linear wall colours in BoxGeometry group order: +X, -X, +Y (ceiling), -Y (floor), +Z, -Z. */
  walls: readonly [V3, V3, V3, V3, V3, V3];
  floorSize: number;
  floorY: number;
  floorColor: V3;
  /** Direction from the origin to the window (the key light direction). */
  windowDir: V3;
  windowDistance: number;
  windowWidth: number;
  windowHeight: number;
  /** Extra size of the backing frame beyond the window opening. */
  frameMargin: number;
  frameColor: V3;
  /** Width of the mullion cross between panes. */
  mullion: number;
  paneLow: V3;
  paneHigh: V3;
  bounceDir: V3;
  bounceDistance: number;
  bounceWidth: number;
  bounceHeight: number;
  bounceColor: V3;
  sigma: number;
  near: number;
  far: number;
}

export const ROOM_DEFAULTS: RoomOptions = {
  roomHalf: 3000,
  walls: [[0.44, 0.44, 0.45], [0.40, 0.40, 0.42], [0.62, 0.63, 0.66], [0.26, 0.23, 0.20], [0.36, 0.36, 0.38], [0.46, 0.47, 0.49]],
  floorSize: 4000, floorY: -40, floorColor: [0.40, 0.36, 0.30],
  windowDir: [-0.6, 0.66, -0.48], windowDistance: 2400, windowWidth: 1500, windowHeight: 1900, frameMargin: 220,
  frameColor: [0.85, 0.86, 0.88], mullion: 70, paneLow: [3.0, 3.2, 3.6], paneHigh: [3.4, 3.7, 4.2],
  bounceDir: [0.62, 0.5, -0.61], bounceDistance: 2600, bounceWidth: 1100, bounceHeight: 1000, bounceColor: [1.5, 1.44, 1.34],
  sigma: 0.02, near: 10, far: 20000,
};

const lin = (c: V3) => new Color().setRGB(c[0], c[1], c[2]);

function basic(c: V3, side = DoubleSide as typeof DoubleSide | typeof BackSide) {
  return new MeshBasicMaterial({ color: lin(c), side, toneMapped: false });
}

/** Builds the temporary room scene. Exposed for tests and for a debug view. */
export function buildRoom(o: RoomOptions = ROOM_DEFAULTS): Scene {
  const scene = new Scene();
  const s = o.roomHalf * 2;
  scene.add(new Mesh(new BoxGeometry(s, s, s), o.walls.map((c) => basic(c, BackSide))));
  const floor = new Mesh(new PlaneGeometry(o.floorSize, o.floorSize), basic(o.floorColor));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = o.floorY;
  scene.add(floor);

  const win = new Group();
  win.position.copy(new Vector3(...o.windowDir).normalize().multiplyScalar(o.windowDistance));
  win.lookAt(0, 0, 0);
  const frame = new Mesh(new PlaneGeometry(o.windowWidth + o.frameMargin, o.windowHeight + o.frameMargin), basic(o.frameColor));
  frame.position.z = -2;
  win.add(frame);
  const pw = o.windowWidth / 2 - o.mullion, ph = o.windowHeight / 2 - o.mullion;
  const pane = new PlaneGeometry(pw, ph);
  const low = basic(o.paneLow), high = basic(o.paneHigh);
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const m = new Mesh(pane, sy < 0 ? low : high);
      m.position.set(sx * (o.windowWidth / 4), sy * (o.windowHeight / 4), 0);
      win.add(m);
    }
  }
  scene.add(win);

  const bounce = new Mesh(new PlaneGeometry(o.bounceWidth, o.bounceHeight), basic(o.bounceColor));
  bounce.position.copy(new Vector3(...o.bounceDir).normalize().multiplyScalar(o.bounceDistance));
  bounce.lookAt(0, 0, 0);
  scene.add(bounce);
  scene.updateMatrixWorld(true);
  return scene;
}

function disposeScene(scene: Scene): void {
  const geos = new Set<BufferGeometry>();
  const mats = new Set<MeshBasicMaterial>();
  scene.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    geos.add(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mats.add(mat as MeshBasicMaterial);
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
}

/** Renders the room into a PMREM texture. The caller owns the returned target. */
export function buildEnvironment(renderer: WebGLRenderer, o: RoomOptions = ROOM_DEFAULTS): { target: WebGLRenderTarget; texture: Texture } {
  const room = buildRoom(o);
  const pmrem = new PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, o.sigma, o.near, o.far);
  pmrem.dispose();
  disposeScene(room);
  target.texture.name = 'stage.environment';
  return { target, texture: target.texture };
}
