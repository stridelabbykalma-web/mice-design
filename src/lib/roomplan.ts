// Importa la medición de una sala hecha con la app de refuerzo MICE Capture (iPhone/iPad con
// LiDAR, RoomPlan de Apple). Convierte paredes, puertas, ventanas y huecos en un espacio de
// MICE Design: medidas, altura, puertas, ventanas y tabiques para salas con forma en L.

import type { Item } from '../types';
import { normalizeOutline, snapToRoomWall, type P2 } from './outline';
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
  /** Contorno real de la sala si no es un rectángulo. */
  outline?: P2[];
  width: number;
  depth: number;
  height: number;
  items: Item[];
  summary: string;
  /** De dónde sale la sala en las coordenadas de la medición: giro (rad) y centro. El modelo
   *  se lleva a la medición girándolo θ alrededor de Y y desplazándolo (x, z). */
  frame: { theta: number; x: number; z: number };
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

  // 3. Contorno: se encadenan las paredes por sus extremos. Si cierran, esa es la forma real.
  const chain = chainWalls(segs);
  let outline: P2[] | undefined;
  if (chain && chain.length >= 3) {
    const centered = chain.map((p) => ({ x: p.x - cx, z: p.z - cz }));
    const isRect =
      centered.length === 4 &&
      centered.every((p) => Math.abs(Math.abs(p.x) - (maxX - minX) / 2) < 0.15 && Math.abs(Math.abs(p.z) - (maxZ - minZ) / 2) < 0.15);
    if (!isRect) outline = normalizeOutline(centered).outline;
  }

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
    if (outline || onEdge(g)) continue;
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
      const snap = snapToRoomWall(p.x, p.z, { width, depth, outline } as Parameters<typeof snapToRoomWall>[2], depthItem);
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
    (outline ? ` · sala de ${outline.length} lados` : '') +
    (inner ? ` · ${inner} tramos interiores añadidos como tabiques` : '') +
    '. Revisa qué puertas son salidas de emergencia.';
  // Centro de la sala en la medición original (giro inverso)
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const frame = { theta, x: cx * ct - cz * st, z: cx * st + cz * ct };
  return { outline, width: r2(width), depth: r2(depth), height: r2(height), items, summary, frame };
}

/** Encadena tramos de pared por sus extremos; devuelve las esquinas si forman un contorno cerrado. */
function chainWalls(segs: { a: P2; b: P2 }[], tol = 0.35): P2[] | null {
  if (segs.length < 3) return null;
  const used = new Set<number>([0]);
  const pts: P2[] = [segs[0].a];
  let end = segs[0].b;
  const near = (p: P2, q: P2) => Math.hypot(p.x - q.x, p.z - q.z) < tol;
  while (used.size < segs.length) {
    let found = -1;
    let next: P2 | null = null;
    for (let i = 0; i < segs.length; i++) {
      if (used.has(i)) continue;
      if (near(segs[i].a, end)) {
        found = i;
        next = segs[i].b;
        break;
      }
      if (near(segs[i].b, end)) {
        found = i;
        next = segs[i].a;
        break;
      }
    }
    if (found < 0 || !next) break;
    pts.push({ x: (end.x + (near(segs[found].a, end) ? segs[found].a.x : segs[found].b.x)) / 2, z: (end.z + (near(segs[found].a, end) ? segs[found].a.z : segs[found].b.z)) / 2 });
    used.add(found);
    end = next;
  }
  // Solo se acepta si se han usado todas las paredes y el último extremo vuelve al primero
  if (used.size !== segs.length || !near(end, segs[0].a)) return null;
  pts[0] = { x: (pts[0].x + end.x) / 2, z: (pts[0].z + end.z) / 2 };
  return pts;
}
