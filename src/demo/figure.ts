import {
  BoxGeometry, Color, CylinderGeometry, GridHelper, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, Plane, Raycaster, SphereGeometry, Vector2, Vector3,
} from 'three';
import { createEngine, supportsWebGL2 } from '../engine/core/app';
import type { Registry } from '../engine/core/registry';

export function mountPendulumFigure(canvas: HTMLCanvasElement, registry: Registry) {
  if (!supportsWebGL2()) return undefined;
  const plate = canvas.parentElement!;
  const engine = createEngine(canvas, {
    registry,
    ao: false,
    tier: 'low',
    size: () => plate.getBoundingClientRect(),
  });
  const { scene, camera } = engine.ctx;
  registry.set('stage.scene', 'background', '#e9dcc2');
  for (const id of ['stage.desk', 'stage.pad']) {
    const object = registry.get(id)?.object;
    if (object) object.visible = false;
  }

  const copper = new MeshStandardMaterial({ color: '#a86341', roughness: 0.52, metalness: 0.48 });
  const cutEdge = new MeshStandardMaterial({ color: '#624136', roughness: 0.8 });
  const cream = new MeshStandardMaterial({ color: '#ead4a8', roughness: 0.87 });
  const floor = new Mesh(new BoxGeometry(440, 7, 260), cream);
  floor.position.set(0, -5, 0);
  floor.receiveShadow = true;
  scene.add(floor);

  const grid = new GridHelper(396, 22, new Color('#aa8565'), new Color('#b49b7a'));
  grid.scale.z = 0.68;
  grid.position.y = -1.4;
  scene.add(grid);

  const popup = new Group();
  popup.position.set(0, 0, -4);
  scene.add(popup);
  const stand = new Group();
  popup.add(stand);

  const box = (group: Group, material: MeshStandardMaterial, size: [number, number, number], position: [number, number, number]) => {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const x of [-93, 93]) {
    box(stand, cutEdge, [13, 6, 71], [x, 3, 0]);
    box(stand, copper, [10, 122, 12], [x, 65, 0]);
    const brace = box(stand, cutEdge, [8, 54, 8], [x * 0.87, 26, 0]);
    brace.rotation.z = Math.sign(x) * -0.5;
  }
  box(stand, copper, [197, 11, 17], [0, 123, 0]);
  box(stand, cutEdge, [190, 2, 18], [0, 116.5, 0]);

  const pivot = new Group();
  pivot.position.set(0, 122, 11);
  stand.add(pivot);
  const pin = new Mesh(new CylinderGeometry(7, 7, 12, 16), cutEdge);
  pin.rotation.x = Math.PI / 2;
  pivot.add(pin);

  const arm = new Group();
  pivot.add(arm);
  const armLength = 93;
  const thread = new Mesh(new CylinderGeometry(1, 1, armLength, 8), cutEdge);
  thread.position.y = -armLength / 2;
  arm.add(thread);
  const bob = new Mesh(new SphereGeometry(13.5, 32, 16), copper);
  bob.position.y = -armLength;
  bob.castShadow = true;
  arm.add(bob);
  const inset = new Mesh(new SphereGeometry(4, 18, 12), new MeshBasicMaterial({ color: '#dbaf71' }));
  inset.position.set(0, -armLength, 12.9);
  arm.add(inset);

  const figureEntities = [
    [popup, 'demo.swing.apparatus', 'Folding pendulum apparatus', 'demo.swing'],
    [stand, 'demo.swing.apparatus.frame', 'Copper frame', 'demo.swing.apparatus'],
    [arm, 'demo.swing.apparatus.arm', 'Pendulum arm', 'demo.swing.apparatus'],
    [bob, 'demo.swing.apparatus.bob', 'Copper bob', 'demo.swing.apparatus.arm'],
  ] as const;
  for (const [object, id, label, parent] of figureEntities) {
    registry.add({ id, label, kind: 'object', tags: ['ink', 'object'], parent, object, source: 'src/demo/figure.ts' });
  }

  const aimCamera = () => {
    const aspect = Math.max(0.5, camera.aspect);
    const widthFit = Math.max(1, 1.33 / aspect);
    camera.position.set(201 * widthFit, 214 * widthFit, 385 * widthFit);
    camera.lookAt(0, 54, 0);
  };
  aimCamera();
  engine.ctx.events.on('resize', aimCamera);
  const resize = new ResizeObserver(() => engine.resize());
  resize.observe(plate);
  engine.ctx.onFrame('after', () => {
    if (canvas.dataset.loupeActive === 'true') canvas.dispatchEvent(new Event('inkleaf:frame'));
  });
  canvas.addEventListener('inkleaf:request-frame', () => {
    if (!canvas.isConnected || canvas.hidden || !canvas.getClientRects().length) return;
    engine.post.render(0);
    canvas.dispatchEvent(new Event('inkleaf:frame'));
  });
  engine.ctx.start();
  canvas.hidden = false;

  const ray = new Raycaster();
  const coordinate = new Vector2();
  const plane = new Plane();
  const origin = new Vector3();
  const normal = new Vector3();
  const point = new Vector3();

  return {
    setPose(lift: number, angle: number) {
      popup.rotation.x = -(1 - lift) * Math.PI / 2;
      arm.rotation.z = angle;
    },
    angleAt(clientX: number, clientY: number, requireBob: boolean): number | undefined {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      coordinate.set((clientX - rect.left) / rect.width * 2 - 1, 1 - (clientY - rect.top) / rect.height * 2);
      scene.updateMatrixWorld();
      camera.updateMatrixWorld();
      ray.setFromCamera(coordinate, camera);
      if (requireBob && !ray.intersectObject(bob, false).length) return;

      pivot.localToWorld(origin.set(0, 0, 0));
      normal.set(0, 0, 1).transformDirection(pivot.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(normal, origin);
      if (!ray.ray.intersectPlane(plane, point)) return;
      pivot.worldToLocal(point);
      return Math.atan2(point.x, -point.y) * 180 / Math.PI;
    },
  };
}
