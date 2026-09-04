"use client";
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

type Status = "ready" | "recording" | "transcribing" | "thinking" | "speaking";

interface VoiceOrbProps {
  status: Status;
  emotion?: string;
}

const STATUS_CONFIG: Record<Status, { color: string; emissive: string; distort: number; speed: number; scale: number }> = {
  ready:        { color: "#4f46e5", emissive: "#312e81", distort: 0.15, speed: 1.2,  scale: 1.0  },
  recording:    { color: "#ef4444", emissive: "#7f1d1d", distort: 0.55, speed: 3.5,  scale: 1.12 },
  transcribing: { color: "#f59e0b", emissive: "#78350f", distort: 0.3,  speed: 2.0,  scale: 1.05 },
  thinking:     { color: "#8b5cf6", emissive: "#4c1d95", distort: 0.2,  speed: 1.0,  scale: 1.0  },
  speaking:     { color: "#10b981", emissive: "#064e3b", distort: 0.45, speed: 4.0,  scale: 1.08 },
};

const EMOTION_EMISSIVE: Record<string, string> = {
  happy:   "#f59e0b",
  excited: "#ef4444",
  sad:     "#3b82f6",
  calm:    "#10b981",
  angry:   "#dc2626",
  fearful: "#8b5cf6",
  neutral: "#312e81",
};

export default function VoiceOrb({ status, emotion = "neutral" }: VoiceOrbProps) {
  const meshRef = useRef<THREE.Mesh>(null!);
  const ringRef = useRef<THREE.Mesh>(null!);
  const cfg = STATUS_CONFIG[status];

  // Override emissive with emotion colour when speaking
  const emissive = status === "speaking"
    ? (EMOTION_EMISSIVE[emotion] ?? cfg.emissive)
    : cfg.emissive;

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (meshRef.current) {
      meshRef.current.rotation.y = t * 0.4;
      meshRef.current.rotation.x = Math.sin(t * 0.3) * 0.15;

      // Pulse scale
      const pulse = status === "recording"
        ? 1 + Math.sin(t * 8) * 0.06
        : status === "speaking"
        ? 1 + Math.sin(t * 6) * 0.04
        : 1 + Math.sin(t * 1.5) * 0.02;
      const target = cfg.scale * pulse;
      meshRef.current.scale.lerp(new THREE.Vector3(target, target, target), 0.12);
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * (status === "thinking" ? 1.8 : 0.6);
      ringRef.current.rotation.x = Math.sin(t * 0.5) * 0.4;
      const ringScale = status === "recording" ? 1 + Math.sin(t * 8) * 0.08 : 1;
      ringRef.current.scale.setScalar(ringScale);
    }
  });

  return (
    <group>
      {/* Outer glow ring */}
      <mesh ref={ringRef}>
        <torusGeometry args={[1.55, 0.015, 8, 80]} />
        <meshBasicMaterial color={cfg.color} transparent opacity={status === "thinking" ? 0.9 : 0.35} />
      </mesh>

      {/* Second ring — counter-rotate */}
      <mesh rotation={[Math.PI / 3, 0, 0]}>
        <torusGeometry args={[1.7, 0.008, 8, 80]} />
        <meshBasicMaterial color={cfg.color} transparent opacity={0.2} />
      </mesh>

      {/* Main orb */}
      <mesh ref={meshRef}>
        <sphereGeometry args={[1.1, 64, 64]} />
        <MeshDistortMaterial
          color={cfg.color}
          emissive={emissive}
          emissiveIntensity={0.6}
          distort={cfg.distort}
          speed={cfg.speed}
          roughness={0.15}
          metalness={0.4}
        />
      </mesh>

      {/* Inner glow core */}
      <mesh>
        <sphereGeometry args={[0.65, 32, 32]} />
        <meshBasicMaterial color={emissive} transparent opacity={0.25} />
      </mesh>

      {/* Point light emanating from orb */}
      <pointLight color={cfg.color} intensity={2.5} distance={6} decay={2} />
    </group>
  );
}
