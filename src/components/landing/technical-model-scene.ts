import * as THREE from "three";

export interface TechnicalScene {
  select(index: number): void;
  setVisible(visible: boolean): void;
  dispose(): void;
}

// A presentation model only. These nodes do not represent execution or a solver result.
const NODES: ReadonlyArray<readonly [number, number, "box" | "sphere"]> = [
  [-7, 0, "box"], [-5, -1.6, "sphere"], [-5, 2.3, "box"],
  [-3.4, -2.3, "box"], [-3.4, 0.5, "sphere"], [-3.1, 3, "sphere"],
  [-1.1, -2.2, "box"], [-0.7, 0.2, "box"], [-0.5, 2.8, "box"],
  [1.7, -1.3, "sphere"], [1.6, 1.5, "box"], [4, -2.3, "box"],
  [4, 0.5, "sphere"], [4, 3.1, "box"], [6.6, 1, "box"],
];
const EDGES = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 4], [2, 5], [3, 6], [4, 7], [5, 7], [5, 8], [6, 9], [7, 9], [7, 10], [8, 10], [9, 11], [9, 12], [10, 12], [10, 13], [11, 14], [12, 14], [13, 14]];
const PATH = new Set(["0:4", "4:7", "7:10", "10:12", "12:14"]);

export function createTechnicalScene(mount: HTMLElement, onLost: () => void): TechnicalScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setClearColor(0xf25120);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.setAttribute("aria-hidden", "true");
  mount.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf25120);
  const group = new THREE.Group();
  scene.add(group);
  const camera = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 70);
  camera.position.set(9, 13, 16);
  camera.lookAt(0, 0, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xba451e, 2.6));
  const light = new THREE.DirectionalLight(0xfff6e6, 4.1);
  light.position.set(-8, 14, 7);
  light.castShadow = true;
  light.shadow.mapSize.set(1024, 1024);
  Object.assign(light.shadow.camera, { left: -15, right: 15, top: 12, bottom: -12, near: 0.1, far: 45 });
  light.shadow.normalBias = 0.04;
  light.shadow.bias = -0.0001;
  scene.add(light);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(150, 150), new THREE.MeshStandardMaterial({ color: 0xf25120, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(60, 60, 0xffa37b, 0xff976c);
  grid.position.y = 0.005;
  const gridMaterial = grid.material as THREE.LineBasicMaterial;
  gridMaterial.transparent = true; gridMaterial.opacity = 0.3;
  scene.add(grid);
  const ivory = new THREE.MeshStandardMaterial({ color: 0xfffcf6, roughness: 0.55, metalness: 0.02 });
  const ink = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.55 });
  const cube = new THREE.BoxGeometry(0.92, 0.92, 0.92);
  const ball = new THREE.SphereGeometry(0.3, 24, 16);
  const nodeMeshes: THREE.Mesh[] = [];
  NODES.forEach(([x, z, shape], i) => {
    const mesh = new THREE.Mesh(shape === "box" ? cube : ball, ivory);
    mesh.position.set(x, shape === "box" ? 0.7 : 0.7, z);
    if (i === 0 || i === 14) mesh.scale.setScalar(1.3);
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); nodeMeshes.push(mesh);
    if (shape === "box") {
      const edge = new THREE.LineSegments(new THREE.EdgesGeometry(cube), new THREE.LineBasicMaterial({ color: 0xddd8ce, transparent: true, opacity: 0.6 }));
      mesh.add(edge);
    }
  });
  const links: Array<{ mesh: THREE.Mesh; path: boolean; index: number }> = [];
  EDGES.forEach(([a, b], index) => {
    const from = nodeMeshes[a].position;
    const to = nodeMeshes[b].position;
    const delta = new THREE.Vector3().subVectors(to, from);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, delta.length(), 10), ivory);
    mesh.position.addVectors(from, to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.castShadow = true;
    group.add(mesh); links.push({ mesh, path: PATH.has(a + ":" + b), index });
  });

  let disposed = false;
  let visible = true;
  let contextLost = false;
  let frame = 0;
  let targetX = 0;
  let targetY = 0;
  function draw() {
    frame = 0;
    if (disposed || contextLost || !visible || document.hidden) return;
    group.rotation.x += (targetX - group.rotation.x) * 0.12;
    group.rotation.y += (targetY - group.rotation.y) * 0.12;
    renderer.render(scene, camera);
    if (Math.abs(targetX - group.rotation.x) + Math.abs(targetY - group.rotation.y) > 0.0003) frame = requestAnimationFrame(draw);
  }
  function requestDraw() { if (!frame && !disposed && !contextLost && visible && !document.hidden) frame = requestAnimationFrame(draw); }
  function resize() {
    const { width, height } = mount.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    renderer.setSize(width, height, false);
    const aspect = width / height;
    const extent = Math.max(4.3, 10.3 / aspect);
    camera.left = -extent * aspect; camera.right = extent * aspect;
    camera.top = extent; camera.bottom = -extent;
    camera.updateProjectionMatrix(); requestDraw();
  }
  function move(event: PointerEvent) {
    if (event.pointerType !== "mouse") return;
    const box = mount.getBoundingClientRect();
    targetY = ((event.clientX - box.left) / box.width - 0.5) * 0.13;
    targetX = ((event.clientY - box.top) / box.height - 0.5) * 0.035;
    requestDraw();
  }
  function leave() { targetX = 0; targetY = 0; requestDraw(); }
  function lost(event: Event) { event.preventDefault(); contextLost = true; cancelAnimationFrame(frame); frame = 0; onLost(); }
  const observer = new ResizeObserver(resize); observer.observe(mount);
  mount.addEventListener("pointermove", move);
  mount.addEventListener("pointerleave", leave);
  renderer.domElement.addEventListener("webglcontextlost", lost);
  document.addEventListener("visibilitychange", requestDraw);
  resize();
  return {
    select(index) {
      links.forEach(({ mesh, path, index: edgeIndex }) => { mesh.material = path && (index === 2 || edgeIndex < (index === 0 ? 4 : 14)) ? ink : ivory; });
      nodeMeshes.forEach((mesh, i) => { mesh.material = index === 2 && [4, 7, 10, 12].includes(i) ? ink : ivory; });
      requestDraw();
    },
    setVisible(next) { visible = next; if (!visible) { cancelAnimationFrame(frame); frame = 0; } else requestDraw(); },
    dispose() {
      if (disposed) return;
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      mount.removeEventListener("pointermove", move); mount.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", requestDraw);
      renderer.domElement.removeEventListener("webglcontextlost", lost);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>([ivory, ink]);
      scene.traverse((item) => {
        if (item instanceof THREE.Mesh || item instanceof THREE.LineSegments) {
          geometries.add(item.geometry);
          (Array.isArray(item.material) ? item.material : [item.material]).forEach((material) => materials.add(material));
        }
      });
      geometries.forEach((geometry) => geometry.dispose()); materials.forEach((material) => material.dispose());
      light.shadow.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
    },
  };
}
