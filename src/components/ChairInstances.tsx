// Sillas genéricas dibujadas «en grupo» (instancing): todas las sillas iguales se envían a la
// tarjeta gráfica en una sola orden de dibujo. Cada silla sigue perteneciendo a su elemento
// (la mesa o la propia silla) y al pulsarla se selecciona y se arrastra como siempre.
// Las sillas escaneadas del hotel siguen dibujándose una a una con su modelo real.

import { createContext, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import type { CatalogDef, Item, Project } from '../types';
import { findDef, isRoundTable, itemDims, rectChairLayout } from '../catalog';
import { DEG } from '../lib/geometry';

/** Si es true, las mesas y sillas no dibujan sus sillas genéricas (lo hace ChairInstances). */
export const InstancedChairsContext = createContext(false);

const GENERIC = new Set(['silla', 'silla-conferencia']);
const isGeneric = (type: string | undefined, custom: CatalogDef[]) => !type || (GENERIC.has(type) && !findDef(type, custom)?.modelAssetId);
export const chairIsInstanced = isGeneric;

// ---------- Geometría (la misma silla que la versión pieza a pieza) ----------
const SEAT_H = 0.46;
const leg = (x: number, z: number) => new THREE.CylinderGeometry(0.012, 0.012, SEAT_H, 6).translate(x, SEAT_H / 2, z);
const legs = () => [leg(-0.19, -0.19), leg(0.19, -0.19), leg(-0.19, 0.19), leg(0.19, 0.19)];
const seat = () => new THREE.BoxGeometry(0.44, 0.06, 0.44).translate(0, SEAT_H, 0);
const back = () => new THREE.BoxGeometry(0.42, 0.42, 0.04).translate(0, SEAT_H + 0.24, 0.2);

const GEO = {
  // Silla de banquete: cojín claro + estructura (respaldo y patas) del color de la silla
  banquetCushion: seat(),
  banquetFrame: mergeGeometries([back(), ...legs()])!,
  // Silla de conferencia: tapizado (asiento y respaldo) + patas oscuras
  confUpholstery: mergeGeometries([seat(), back()])!,
  confLegs: mergeGeometries(legs())!,
};
const MAT = {
  banquetCushion: new THREE.MeshStandardMaterial({ color: '#f3efe6', roughness: 0.8 }),
  banquetFrame: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.45, metalness: 0.5 }),
  confUpholstery: new THREE.MeshStandardMaterial({ color: '#3d4b5f', roughness: 0.8 }),
  confLegs: new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.4, metalness: 0.6 }),
};

interface ChairPose {
  owner: string;
  conference: boolean;
  color: string;
  matrix: THREE.Matrix4;
}

const tmpObj = new THREE.Object3D();
const tmpLocal = new THREE.Matrix4();

/** Posiciones locales de las sillas de una mesa (las mismas que usa Furniture). */
export function tableChairPoses(item: Item, def: CatalogDef | undefined): { x: number; z: number; rot: number }[] {
  const chairs = item.chairs ?? def?.chairs ?? 0;
  if (!chairs || !def) return [];
  const { w, d } = itemDims(item, def);
  const round = isRoundTable(item.type) || (!!def.modelAssetId && def.w === def.d);
  if (round) {
    const R = w / 2 + 0.32;
    return Array.from({ length: chairs }, (_, i) => {
      const a = (i / chairs) * Math.PI * 2;
      return { x: Math.sin(a) * R, z: Math.cos(a) * R, rot: a };
    });
  }
  const lay = rectChairLayout(item.type, w, d, chairs);
  const out: { x: number; z: number; rot: number }[] = [];
  const row = (n: number, z: number, rot: number) => {
    for (let i = 0; i < n; i++) out.push({ x: -w / 2 + (w / n) * (i + 0.5), z, rot });
  };
  row(lay.back, d / 2 + 0.3, 0);
  row(lay.front, -d / 2 - 0.3, Math.PI);
  // Las mesas escaneadas solo llevan sillas en los lados largos
  if (!def.modelAssetId) {
    if (lay.ends >= 1) out.push({ x: -w / 2 - 0.3, z: 0, rot: -Math.PI / 2 });
    if (lay.ends >= 2) out.push({ x: w / 2 + 0.3, z: 0, rot: Math.PI / 2 });
  }
  return out;
}

/** Todas las sillas genéricas de la escena con su matriz en el mundo. */
export function collectChairs(project: Project, elevation: (it: Item) => number): ChairPose[] {
  const out: ChairPose[] = [];
  const custom = project.customCatalog;
  for (const it of project.items) {
    const def = findDef(it.type, custom);
    const base = new THREE.Matrix4().compose(
      new THREE.Vector3(it.x, elevation(it) + (it.y ?? 0), it.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.rot * DEG),
      new THREE.Vector3(1, 1, 1),
    );
    if (GENERIC.has(it.type) && isGeneric(it.type, custom)) {
      out.push({ owner: it.id, conference: it.type === 'silla-conferencia', color: it.color ?? def?.color ?? '#c9a45c', matrix: base });
      continue;
    }
    if (!def || def.chairs === undefined || !isGeneric(it.chairType, custom)) continue;
    const conference = it.chairType === 'silla-conferencia';
    const color = findDef(it.chairType ?? 'silla', custom)?.color ?? '#c9a45c';
    for (const p of tableChairPoses(it, def)) {
      tmpObj.position.set(p.x, 0, p.z);
      tmpObj.rotation.set(0, p.rot, 0);
      tmpObj.updateMatrix();
      tmpLocal.copy(tmpObj.matrix);
      out.push({ owner: it.id, conference, color, matrix: base.clone().multiply(tmpLocal) });
    }
  }
  return out;
}

function Batch({
  poses,
  geometry,
  material,
  colored,
  onDown,
}: {
  poses: ChairPose[];
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  colored: boolean;
  onDown?: (e: ThreeEvent<PointerEvent>, owner: string) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  // Capacidad en potencias de 2 para no recrear el objeto en cada cambio
  const capacity = Math.max(16, 2 ** Math.ceil(Math.log2(Math.max(1, poses.length))));
  useLayoutEffect(() => {
    const m = ref.current;
    if (!m) return;
    const c = new THREE.Color();
    poses.forEach((p, i) => {
      m.setMatrixAt(i, p.matrix);
      if (colored) m.setColorAt(i, c.set(p.color));
    });
    m.count = poses.length;
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.computeBoundingBox();
    invalidate();
  }, [poses, colored, capacity, invalidate]);
  if (!poses.length) return null;
  return (
    <instancedMesh
      key={capacity}
      ref={ref}
      args={[geometry, material, capacity]}
      castShadow
      receiveShadow
      onPointerDown={onDown ? (e) => e.instanceId !== undefined && onDown(e, poses[e.instanceId].owner) : undefined}
    />
  );
}

export function ChairInstances({
  project,
  elevation,
  onDown,
}: {
  project: Project;
  elevation: (it: Item) => number;
  onDown?: (e: ThreeEvent<PointerEvent>, owner: string) => void;
}) {
  const poses = useMemo(() => collectChairs(project, elevation), [project.items, project.customCatalog, elevation]);
  const banquet = useMemo(() => poses.filter((p) => !p.conference), [poses]);
  const conf = useMemo(() => poses.filter((p) => p.conference), [poses]);
  return (
    <group name="sillas-agrupadas">
      <Batch poses={banquet} geometry={GEO.banquetCushion} material={MAT.banquetCushion} colored={false} onDown={onDown} />
      <Batch poses={banquet} geometry={GEO.banquetFrame} material={MAT.banquetFrame} colored onDown={onDown} />
      <Batch poses={conf} geometry={GEO.confUpholstery} material={MAT.confUpholstery} colored={false} onDown={onDown} />
      <Batch poses={conf} geometry={GEO.confLegs} material={MAT.confLegs} colored={false} onDown={onDown} />
    </group>
  );
}
