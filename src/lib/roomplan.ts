// Importa la medición de una sala hecha con la app de refuerzo MICE Capture (iPhone/iPad con
// LiDAR, RoomPlan de Apple). Convierte paredes, puertas, ventanas y huecos en un espacio de
// MICE Design: medidas, altura, puertas, ventanas y tabiques para salas con forma en L.

import type { Item } from '../types';
import { snapToWall } from './geometry';
import { uid } from './db';

interface RPSurface {
  dimensions: number[]; // [ancho, alto, fondo] en metros
  transform: number[]; // matriz 4×4 por columnas
}

export interface RoomPlanFile {
  format: 'mice-roomplan';
  version: number;
  walls: RPSurface[];
  doors?: RPSurface[];
  windows?: RPSurface[];
  openings?: RPSurface[];
  objects?: (RPSurface & { category: string })[];
}

export interface RoomPlanResult {
  width: number;
  depth: number;
  height: number;
  items: Item[];
  summary: string;
}

const pos = (t: number[]) => ({ x: t[12], y: t[13], z: t[14] });
const axisX = (t: number[]) => {
  const l = Math.hypot(t[0], t[2]) || 1;
  return { x: t[0] / l, z: t[2] / l };
};

export function parseRoomPlan(json: unknown): RoomPlanResult {
  const f = json as RoomPlanFile;
  if (!f || f.format !== 'mice-roomplan' || !Array.isArray(f.walls) || !f.walls.length)
    throw new Error('El archivo no es una medición de MICE Capture (.mice-room.json).');

  // 1. Orientación dominante: la de la pared más larga, para alinear la sala con los ejes.
  const longest = [...f.walls].sort((a, b) => b.dimensions[0] - a.dimensions[0])[0];
  const u = axisX(longest.transform);
  const theta = Math.atan2(u.z, u.x);
  const c = Math.cos(-theta);
  const s = Math.sin(-theta);
  const rot = (x: number, z: number) => ({ x: x * c - z * s, z: x * s + z * c });

  // 2. Extremos de cada pared en planta, ya girados.
  const segs = f.walls.map((w) => {
    const p = pos(w.transform);
    const d = axisX(w.transform);
    const h = w.dimensions[0] / 2;
    const a = rot(p.x - d.x * h, p.z - d.z * h);
    const b = rot(p.x + d.x * h, p.z + d.z * h);
    return { a, b, len: w.dimensions[0], height: w.dimensions[1] };
  });
  const xs = segs.flatMap((g) => [g.a.x, g.b.x]);
  const zs = segs.flatMap((g) => [g.a.z, g.b.z]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = maxX - minX;
  const depth = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  const height = Math.max(...segs.map((g) => g.height));
  // RoomPlan mide desde su origen; el suelo es la base más baja de las paredes.
  const floorY = Math.min(...f.walls.map((w) => pos(w.transform).y - w.dimensions[1] / 2));

  const local = (t: number[]) => {
    const p = pos(t);
    const r = rot(p.x, p.z);
    return { x: r.x - cx, y: p.y - floorY, z: r.z - cz };
  };

  const items: Item[] = [];
  const r2 = (v: number) => Math.round(v * 100) / 100;

  // 3. Paredes interiores (salas en L o con entrantes): las que no están en el contorno.
  const tol = 0.35;
  const onEdge = (g: (typeof segs)[number]) =>
    (Math.abs(g.a.x - minX) < tol && Math.abs(g.b.x - minX) < tol) ||
    (Math.abs(g.a.x - maxX) < tol && Math.abs(g.b.x - maxX) < tol) ||
    (Math.abs(g.a.z - minZ) < tol && Math.abs(g.b.z - minZ) < tol) ||
    (Math.abs(g.a.z - maxZ) < tol && Math.abs(g.b.z - maxZ) < tol);
  let inner = 0;
  for (const g of segs) {
    if (onEdge(g)) continue;
    inner++;
    const mx = (g.a.x + g.b.x) / 2 - cx;
    const mz = (g.a.z + g.b.z) / 2 - cz;
    const ang = Math.atan2(g.b.z - g.a.z, g.b.x - g.a.x);
    items.push({ id: uid('i_'), type: 'tabique', x: r2(mx), z: r2(mz), rot: r2((-ang * 180) / Math.PI), w: r2(g.len), h: r2(g.height) });
  }

  // 4. Puertas, huecos y ventanas, ancladas a la pared más cercana.
  const place = (list: RPSurface[] | undefined, type: 'puerta' | 'ventana') => {
    (list ?? []).forEach((sf) => {
      const p = local(sf.transform);
      const w = r2(sf.dimensions[0]);
      const h = r2(sf.dimensions[1]);
      const depthItem = type === 'ventana' ? 0.08 : 0.12;
      const snap = snapToWall(p.x, p.z, width, depth, depthItem);
      const it: Item = { id: uid('i_'), type, x: r2(snap.x), z: r2(snap.z), rot: snap.rot, w, h };
      // Las ventanas se dibujan desde 1 m de altura; se ajusta con su altura real de alféizar.
      if (type === 'ventana') it.y = r2(p.y - h / 2 - 1.0);
      items.push(it);
    });
  };
  place(f.doors, 'puerta');
  place(f.openings, 'puerta');
  place(f.windows, 'ventana');

  const nd = (f.doors?.length ?? 0) + (f.openings?.length ?? 0);
  const nw = f.windows?.length ?? 0;
  const fm = (v: number) => r2(v).toString().replace('.', ',');
  const summary =
    `Sala de ${fm(width)} × ${fm(depth)} m y ${fm(height)} m de altura · ${f.walls.length} paredes, ${nd} puertas o huecos, ${nw} ventanas` +
    (inner ? ` · ${inner} tramos interiores añadidos como tabiques` : '') +
    '. Revisa qué puertas son salidas de emergencia.';
  return { width: r2(width), depth: r2(depth), height: r2(height), items, summary };
}
