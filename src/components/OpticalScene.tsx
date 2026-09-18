import { Canvas, useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

const TILES = [
  { p: [-4.4, 1.7, -2.5], r: [-0.2, 0.5, -0.15], s: 1.15 },
  { p: [4.7, 2.3, -3.2], r: [0.25, -0.45, 0.2], s: 0.85 },
  { p: [3.4, -2.1, -1.8], r: [-0.3, -0.15, -0.1], s: 0.65 },
  { p: [-3.3, -2.4, -3.7], r: [0.2, 0.2, 0.08], s: 0.75 },
] as const;

type Vector3Tuple = readonly [number, number, number];

function QRTile({ position, rotation, scale, index }: { position: Vector3Tuple; rotation: Vector3Tuple; scale: number; index: number }) {
  const ref = useRef<THREE.Group>(null);
  const modules = useMemo(() => Array.from({ length: 36 }, (_, i) => ({
    x: (i % 6) - 2.5,
    y: Math.floor(i / 6) - 2.5,
    on: ((i * 7 + index * 11) % 13) < 6 || [0, 5, 30, 35].includes(i),
  })).filter((item) => item.on), [index]);

  useFrame(({ pointer, clock }, delta) => {
    if (!ref.current) return;
    const targetX = rotation[0] + pointer.y * 0.08;
    const targetY = rotation[1] + pointer.x * 0.12;
    ref.current.rotation.x = THREE.MathUtils.damp(ref.current.rotation.x, targetX, 4, delta);
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, targetY, 4, delta);
    ref.current.position.y = position[1] + Math.sin(clock.elapsedTime * 0.65 + index) * 0.12;
  });

  return (
    <group ref={ref} position={position as [number, number, number]} rotation={rotation as [number, number, number]} scale={scale}>
      <RoundedBox args={[2.25, 2.25, 0.16]} radius={0.12} smoothness={4} castShadow>
        <meshStandardMaterial color="#f8fbff" roughness={0.28} metalness={0.06} />
      </RoundedBox>
      {modules.map((module, i) => (
        <mesh key={i} position={[module.x * 0.28, -module.y * 0.28, 0.11]} castShadow>
          <boxGeometry args={[0.2, 0.2, 0.06]} />
          <meshStandardMaterial color={index % 2 ? "#1258dc" : "#111a27"} roughness={0.48} />
        </mesh>
      ))}
    </group>
  );
}

function Scene() {
  return (
    <>
      <hemisphereLight args={["#f7fbff", "#8daee0", 1.8]} />
      <directionalLight position={[4, 7, 6]} intensity={2.8} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
      <pointLight color="#ff8a38" position={[-4, -1, 4]} intensity={12} distance={12} />
      {TILES.map((tile, index) => <QRTile key={index} position={tile.p} rotation={tile.r} scale={tile.s} index={index} />)}
    </>
  );
}

export function OpticalScene() {
  return (
    <div className="pointer-events-none absolute right-0 top-20 -z-10 hidden h-[430px] w-[58%] lg:block" aria-hidden="true">
      <Canvas shadows dpr={1} camera={{ position: [0, 0, 10], fov: 42 }} gl={{ antialias: true, alpha: true }}>
        <Scene />
      </Canvas>
    </div>
  );
}
