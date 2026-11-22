import {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Scene,
  SphereGeometry,
  TorusGeometry,
  WebGLRenderer,
} from "three";
import type { Registry } from "../engine/core/registry";
import type { LessonKind, LessonPose } from "./lesson-contract";

/** Seven miniature apparatuses, each driven directly by its lesson's measured pose. */
export function mountLessonFigure(
  canvas: HTMLCanvasElement,
  kind: LessonKind,
  registry: Registry
):
  | { setPose(lift: number, pose: LessonPose): void; dispose(): void }
  | undefined {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return undefined;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new Scene();
  scene.background = new Color("#eee2c8");
  const camera = new OrthographicCamera(-180, 180, 125, -125, 1, 1000);
  camera.position.set(235, 205, 320);
  camera.lookAt(0, 55, 0);
  scene.add(new AmbientLight("#fff5dd", 1.65));
  const sun = new DirectionalLight("#ffffff", 2.1);
  sun.position.set(-100, 240, 180);
  scene.add(sun);
  const mat = (color: string, emissive = "#000000") =>
    new MeshStandardMaterial({ color, emissive, roughness: 0.78 });
  const ink = mat("#48372f"),
    wood = mat("#b9754f"),
    paper = mat("#e8c99b"),
    teal = mat("#568f85"),
    gold = mat("#dfb65d"),
    red = mat("#bf634e"),
    pale = mat("#f6e9c9"),
    glow = mat("#f4cf6b", "#7e5815");
  const root = new Group();
  scene.add(root);
  const box = (
    g: Group,
    m: MeshStandardMaterial,
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z = 0
  ) => {
    const o = new Mesh(new BoxGeometry(w, h, d), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const ball = (
    g: Group,
    m: MeshStandardMaterial,
    radius: number,
    x: number,
    y: number,
    z = 0
  ) => {
    const o = new Mesh(new SphereGeometry(radius, 20, 12), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const cylinder = (
    g: Group,
    m: MeshStandardMaterial,
    radius: number,
    h: number,
    x: number,
    y: number,
    z = 0
  ) => {
    const o = new Mesh(new CylinderGeometry(radius, radius, h, 20), m);
    o.position.set(x, y, z);
    g.add(o);
    return o;
  };
  const bar = (
    g: Group,
    m: MeshStandardMaterial,
    a: [number, number, number],
    b: [number, number, number],
    width = 3
  ) => {
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const o = box(
      g,
      m,
      width,
      Math.hypot(dx, dy, dz),
      width,
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      (a[2] + b[2]) / 2
    );
    o.quaternion.setFromUnitVectors(
      o.up.clone().normalize(),
      o.position.clone().set(dx, dy, dz).normalize()
    );
    return o;
  };
  box(root, paper, 310, 8, 150, 0, -5, 0);
  let update: (p: LessonPose) => void = () => {};
  if (kind === "stores") {
    const jars: Mesh[] = [];
    for (let i = 0; i < 8; i++) {
      const x = ((i % 4) - 1.5) * 67,
        z = i < 4 ? -34 : 34;
      cylinder(root, ink, 20, 4, x, 3, z);
      const jar = cylinder(
        root,
        [wood, teal, gold, red][i % 4]!,
        16,
        40,
        x,
        25,
        z
      );
      jars.push(jar);
      cylinder(root, pale, 17, 4, x, 47, z);
      ball(root, pale, 4, x, 52, z);
    }
    const trail = ball(root, glow, 6, 0, 62, 0);
    update = (p) => {
      const selected = Math.max(0, Math.min(7, Math.round(p.primary * 7)));
      jars.forEach((j, i) => {
        j.scale.y = i === selected ? 1 + 0.15 * p.highlight : 1;
      });
      trail.position.set(
        ((selected % 4) - 1.5) * 67 + 38 * p.secondary,
        62 + 30 * p.secondary,
        selected < 4 ? -34 : 34
      );
      trail.scale.setScalar(0.4 + 0.8 * p.secondary);
    };
  } else if (kind === "catapult") {
    box(root, wood, 140, 10, 55, -20, 5);
    box(root, ink, 14, 48, 16, -53, 32);
    const arm = new Group();
    arm.position.set(-53, 52, 0);
    root.add(arm);
    box(arm, wood, 105, 8, 13, 45, 0);
    cylinder(arm, red, 14, 6, 95, 5);
    const projectile = ball(root, gold, 10, 40, 65);
    const band = bar(root, red, [-93, 8, 0], [-8, 48, 0], 3);
    update = (p) => {
      arm.rotation.z = -0.65 + 0.9 * (1 - p.secondary);
      projectile.position.set(40 + 60 * p.primary, 65 + 85 * p.primary, 0);
      projectile.scale.setScalar(0.9 + 0.15 * p.highlight);
      band.scale.y = 0.8 + 0.5 * p.secondary;
    };
  } else if (kind === "bounce") {
    box(root, wood, 220, 7, 80, 0, 3);
    for (let i = 0; i < 5; i++) box(root, pale, 3, 2, 70, -80 + i * 40, 7);
    const b = ball(root, red, 17, 0, 30);
    const impact = cylinder(root, gold, 30, 2, 0, 8);
    const heat = ball(root, gold, 9, 76, 20);
    update = (p) => {
      b.position.y = 25 + 105 * p.primary;
      b.scale.set(
        1 + 0.25 * p.highlight,
        1 - 0.2 * p.highlight,
        1 + 0.25 * p.highlight
      );
      impact.scale.setScalar(0.2 + 0.8 * p.highlight);
      heat.scale.setScalar(0.3 + 1.4 * p.secondary);
    };
  } else if (kind === "heating") {
    const fills: Mesh[] = [];
    for (const x of [-65, 65]) {
      cylinder(root, ink, 33, 9, x, 7);
      cylinder(root, wood, 28, 10, x, 16);
      cylinder(root, pale, 27, 65, x, 53);
      fills.push(box(root, x < 0 ? teal : red, 12, 8, 5, x, 40, 27));
      box(root, ink, 5, 80, 5, x + 35, 58);
      box(root, pale, 8, 50, 7, x + 35, 65);
    }
    const flame = ball(root, glow, 12, 0, 22);
    update = (p) => {
      fills[0]!.scale.y = 1 + 3 * p.primary;
      fills[0]!.position.y = 40 + 12 * p.primary;
      fills[1]!.scale.y = 1 + 3 * p.secondary;
      fills[1]!.position.y = 40 + 12 * p.secondary;
      flame.scale.setScalar(0.4 + 0.8 * p.highlight);
    };
  } else if (kind === "lifting") {
    const weights: Mesh[] = [];
    const cords: Mesh[] = [];
    for (const x of [-70, 70]) {
      box(root, ink, 10, 130, 12, x, 70);
      box(root, wood, 72, 8, 14, x, 132);
      cylinder(root, gold, 10, 14, x + 20, 132, 0).rotation.x = Math.PI / 2;
      cords.push(box(root, ink, 3, 75, 3, x + 20, 90));
      weights.push(box(root, teal, 33, 27, 23, x + 20, 40));
    }
    const pointer = ball(root, red, 7, -70, 147);
    update = (p) => {
      [p.primary, p.secondary].forEach((v, i) => {
        weights[i]!.position.y = 35 + 75 * v;
        cords[i]!.scale.y = 1 - 0.7 * v;
        cords[i]!.position.y = 90 + 35 * v;
      });
      pointer.position.x = p.highlight < 0.5 ? -70 : 70;
    };
  } else if (kind === "lamps") {
    const bulbs: Mesh[] = [];
    const halos: Mesh[] = [];
    const ledMaterial = mat("#f4cf6b", "#d99821");
    for (const x of [-65, 65]) {
      box(root, wood, 64, 10, 54, x, 5);
      cylinder(root, ink, 10, 32, x, 26);
      bulbs.push(ball(root, x > 0 ? ledMaterial : pale, 19, x, 52));
      const halo = new Mesh(new TorusGeometry(27, 2, 8, 36), glow);
      halo.position.set(x, 52, 0);
      root.add(halo);
      halos.push(halo);
    }
    update = (p) => {
      bulbs[0]!.scale.setScalar(0.9 + p.primary);
      bulbs[1]!.scale.setScalar(0.9 + p.secondary * 0.5);
      halos[0]!.scale.setScalar(0.55 + p.primary * 3);
      halos[1]!.scale.setScalar(0.55 + p.highlight * 0.85);
      ledMaterial.emissiveIntensity = 0.15 + p.highlight * 1.8;
    };
  } else {
    box(root, ink, 12, 112, 12, -95, 60);
    const rotor = new Group();
    rotor.position.set(-95, 118, 8);
    root.add(rotor);
    for (let i = 0; i < 3; i++) {
      const blade = box(rotor, pale, 9, 48, 4, 0, 25);
      const holder = new Group();
      rotor.remove(blade);
      rotor.add(holder);
      holder.rotation.z = (i * Math.PI * 2) / 3;
      holder.add(blade);
    }
    ball(rotor, gold, 7, 0, 0);
    bar(root, ink, [-85, 8, 0], [45, 8, 0], 3);
    box(root, teal, 60, 48, 40, 73, 28);
    cylinder(root, ink, 20, 6, 73, 55);
    const water = box(root, red, 8, 35, 4, 108, 28, 22);
    const flow = ball(root, glow, 7, 0, 12, 0);
    update = (p) => {
      rotor.rotation.z = p.primary * Math.PI * 2;
      water.scale.y = 0.15 + 0.85 * p.secondary;
      water.position.y = 13 + 17 * p.secondary;
      flow.visible = p.highlight > 0;
      flow.position.x = -75 + 135 * p.primary;
    };
  }
  const id = `demo.lesson.${kind}.figure`;
  registry.add({
    id,
    label: `${kind} lesson figure`,
    kind: "object",
    tags: ["lesson", "figure", "object"],
    object: root,
    source: "src/demo/lesson-figures.ts",
  });
  let lastWidth = 0,
    lastHeight = 0,
    lastDpr = 0;
  const render = () => {
    if (disposed) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width),
      h = Math.max(1, rect.height);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w !== lastWidth || h !== lastHeight || dpr !== lastDpr) {
      renderer.setPixelRatio(dpr);
      renderer.setSize(w, h, false);
      lastWidth = w;
      lastHeight = h;
      lastDpr = dpr;
      const aspect = w / h;
      camera.left = -125 * aspect;
      camera.right = 125 * aspect;
      camera.top = 125;
      camera.bottom = -125;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    if (canvas.dataset.loupeActive === "true")
      canvas.dispatchEvent(new Event("inkleaf:frame"));
  };
  let disposed = false;
  const observer = new ResizeObserver(render);
  observer.observe(canvas);
  canvas.addEventListener("inkleaf:request-frame", render);
  canvas.hidden = false;
  render();
  return {
    setPose(lift, pose) {
      root.rotation.x = (-(1 - Math.max(0, Math.min(1, lift))) * Math.PI) / 2;
      update(pose);
      render();
    },
    dispose() {
      disposed = true;
      observer.disconnect();
      canvas.removeEventListener("inkleaf:request-frame", render);
      registry.remove(id);
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
        }
      });
      const materials = new Set<MeshStandardMaterial>();
      scene.traverse((o) => {
        if (o instanceof Mesh) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms)
            if (m instanceof MeshStandardMaterial) materials.add(m);
        }
      });
      for (const m of materials) m.dispose();
      renderer.dispose();
    },
  };
}
