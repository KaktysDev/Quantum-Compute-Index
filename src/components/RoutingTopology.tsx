"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const NODES: Array<[number, number]> = [
  [-4.6, 2.3], [-3.9, .4], [-4.8, -1.8], [-2.4, 2.8], [-2.7, -2.5],
  [2.4, 2.7], [3.8, 1.4], [4.7, -.2], [3.4, -2.2], [1.8, -2.9],
];

export default function RoutingTopology() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-6, 6, 3.6, -3.6, .1, 30);
    camera.position.set(0, 0, 10);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power", preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const neutral = new THREE.LineBasicMaterial({ color: 0x65736b, transparent: true, opacity: .18 });
    const active = new THREE.LineBasicMaterial({ color: 0x23e58a, transparent: true, opacity: .82 });
    const nodeGeometry = new THREE.CircleGeometry(.055, 12);
    const nodes: THREE.Mesh[] = [];

    const junction = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.OctahedronGeometry(.42, 0)),
      new THREE.LineBasicMaterial({ color: 0xa2afa7, transparent: true, opacity: .72 }),
    );
    junction.rotation.z = Math.PI / 4;
    scene.add(junction);

    NODES.forEach(([x, y], index) => {
      const geometry = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(x * .55, y * .55, 0),
        new THREE.Vector3(x, y, 0),
      ]);
      scene.add(new THREE.Line(geometry, index === 6 ? active : neutral));
      const material = new THREE.MeshBasicMaterial({ color: index === 6 ? 0x23e58a : 0x65736b });
      const node = new THREE.Mesh(nodeGeometry, material);
      node.position.set(x, y, 0);
      node.scale.setScalar(index === 6 ? 1.8 : 1);
      nodes.push(node);
      scene.add(node);
    });

    const packet = new THREE.Mesh(
      new THREE.BoxGeometry(.11, .11, .11),
      new THREE.MeshBasicMaterial({ color: 0x52f3a6 }),
    );
    scene.add(packet);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(.14, .16, 32),
      new THREE.MeshBasicMaterial({ color: 0x23e58a, transparent: true, opacity: .5, side: THREE.DoubleSide }),
    );
    ring.position.copy(nodes[6].position);
    scene.add(ring);

    let frame = 0;
    let visible = true;
    const clock = new THREE.Clock();
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: .05 });
    observer.observe(mount);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      const aspect = width / Math.max(1, height);
      camera.left = -3.6 * aspect;
      camera.right = 3.6 * aspect;
      camera.updateProjectionMatrix();
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!visible) return;
      const elapsed = clock.getElapsedTime();
      const progress = reduced ? 1 : Math.min(1, elapsed / 2.9);
      const outbound = Math.max(0, Math.min(1, (progress - .55) / .3));
      packet.position.set(3.8 * outbound, 1.4 * outbound, 0);
      ring.scale.setScalar(reduced ? 1 : 1 + Math.max(0, Math.sin((elapsed - 2.3) * 3)) * .65);
      (ring.material as THREE.MeshBasicMaterial).opacity = reduced ? .28 : Math.max(.12, .5 - (ring.scale.x - 1) * .42);
      junction.rotation.y = reduced ? 0 : Math.sin(elapsed / 12) * .025;
      renderer.render(scene, camera);
    };

    resize();
    render();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", resize);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="qr-topology-canvas" aria-hidden="true" />;
}
