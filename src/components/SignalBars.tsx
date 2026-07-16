"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

const COLUMNS = 92;
const SEGMENTS = 4;

function seededRandom(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

export default function SignalBars() {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-8, 8, 2, -2, 0.1, 10);
    camera.position.z = 5;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      return;
    }
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.appendChild(renderer.domElement);

    const geometry = new THREE.PlaneGeometry(1, 1);
    const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.78, vertexColors: true });
    const bars = new THREE.InstancedMesh(geometry, material, COLUMNS * SEGMENTS);
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();

    let instance = 0;
    for (let column = 0; column < COLUMNS; column += 1) {
      const x = -8.15 + (column / (COLUMNS - 1)) * 16.3;
      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        const seed = column * 11 + segment * 37 + 3;
        const height = 0.2 + seededRandom(seed) * 1.1;
        const width = 0.055 + seededRandom(seed + 5) * 0.075;
        const center = -1.72 + segment * 1.15 + (seededRandom(seed + 9) - 0.5) * 0.25;
        matrix.makeScale(width, height, 1);
        matrix.setPosition(x, center, 0);
        bars.setMatrixAt(instance, matrix);

        const luminance = 0.09 + seededRandom(seed + 17) * 0.24;
        color.setRGB(luminance * 0.77, luminance, luminance * 0.86);
        if (seededRandom(seed + 23) > 0.94) color.set(0x08764f);
        bars.setColorAt(instance, color);
        instance += 1;
      }
    }
    bars.instanceMatrix.needsUpdate = true;
    if (bars.instanceColor) bars.instanceColor.needsUpdate = true;
    scene.add(bars);

    const scanMaterial = new THREE.MeshBasicMaterial({ color: 0x18b47d, transparent: true, opacity: 0.2 });
    const scan = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 4), scanMaterial);
    scan.position.x = -8.5;
    scene.add(scan);

    let frame = 0;
    let visible = true;
    const clock = new THREE.Clock();
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; }, { threshold: 0.01 });
    observer.observe(mount);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      const aspect = width / Math.max(1, height);
      camera.left = -2 * aspect;
      camera.right = 2 * aspect;
      camera.top = 2;
      camera.bottom = -2;
      camera.updateProjectionMatrix();
    };

    const render = () => {
      frame = requestAnimationFrame(render);
      if (!visible) return;
      const elapsed = clock.getElapsedTime();
      if (!reducedMotion) {
        bars.position.x = Math.sin(elapsed * 0.16) * 0.035;
        material.opacity = 0.74 + Math.sin(elapsed * 0.42) * 0.04;
        scan.position.x = ((elapsed * 0.52) % 17) - 8.5;
      } else {
        scan.visible = false;
      }
      renderer.render(scene, camera);
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      resizeObserver.disconnect();
      geometry.dispose();
      material.dispose();
      scan.geometry.dispose();
      scanMaterial.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div ref={mountRef} className="signal-bars-canvas" aria-hidden="true" />;
}
