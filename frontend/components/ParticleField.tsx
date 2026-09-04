"use client";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Floating particle field — used as background on Login and Dashboard.
 * ~600 small spheres drifting slowly in a sphere volume.
 */
export default function ParticleField({ count = 600, color = "#6366f1" }: { count?: number; color?: string }) {
  const mesh = useRef<THREE.InstancedMesh>(null!);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Random positions + drift speeds generated once
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 14,
      y: (Math.random() - 0.5) * 14,
      z: (Math.random() - 0.5) * 14,
      vx: (Math.random() - 0.5) * 0.002,
      vy: (Math.random() - 0.5) * 0.002,
      vz: (Math.random() - 0.5) * 0.001,
      phase: Math.random() * Math.PI * 2,
    }));
  }, [count]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    particles.forEach((p, i) => {
      p.x += p.vx;
      p.y += p.vy + Math.sin(t * 0.3 + p.phase) * 0.001;
      p.z += p.vz;
      // Wrap around bounds
      if (Math.abs(p.x) > 7) p.vx *= -1;
      if (Math.abs(p.y) > 7) p.vy *= -1;
      if (Math.abs(p.z) > 7) p.vz *= -1;

      dummy.position.set(p.x, p.y, p.z);
      dummy.updateMatrix();
      mesh.current.setMatrixAt(i, dummy.matrix);
    });
    mesh.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.04, 6, 6]} />
      <meshBasicMaterial color={color} transparent opacity={0.55} />
    </instancedMesh>
  );
}
