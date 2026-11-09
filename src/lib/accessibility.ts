// Accesibilidad para personas en silla de ruedas (orientativo, CTE DB-SUA 9 «itinerario
// accesible»): desde la entrada debe existir un recorrido de al menos 1,20 m de ancho hasta
// cada mesa, y un espacio libre de 1,50 m delante de la puerta para girar.
//
// Método: la sala se divide en celdas de 10 cm; se bloquean las celdas a menos de 0,60 m
// (medio pasillo) de cualquier mueble o pared y se busca el camino desde la puerta.

import type { Item, Project } from '../types';
import { findDef, footprint, footprintOffset, isRoundTable } from '../catalog';
import { corners, toWorld } from './geometry';
import { pointInPolygon, roomOutline, distToOutline } from './outline';
import { isDecorDef, isTableDef } from './tables';

export const ROUTE_WIDTH = 1.2;
export const TURN_SPACE = 1.5;
const CELL = 0.1;
const NON_OBSTACLE = new Set(['alfombra', 'pista-baile', 'uplight', 'toma-corriente', 'ventana', 'puerta', 'salida', 'cuadro', 'espejo']);

interface Shape {
  item: Item;
  round: boolean;
  r: number; // círculo: radio
  poly: { x: number; z: number }[]; // rectángulo girado (huella con sillas)
}

function shapeOf(it: Item, project: Project): Shape | null {
  const def = findDef(it.type, project.customCatalog);
  if (!def || NON_OBSTACLE.has(it.type) || isDecorDef(def)) return null;
  const f = footprint(it, def);
  const round = isRoundTable(it.type) || (!!def.modelAssetId && def.w === def.d && def.chairs !== undefined);
  const c = toWorld(it.x, it.z, it.rot, 0, footprintOffset(it, def));
  return { item: it, round, r: f.w / 2, poly: corners({ x: c.x, z: c.z, w: f.w, d: f.d, rot: it.rot }) };
}

/** Distancia de un punto a la huella (0 si está dentro). */
function distTo(s: Shape, x: number, z: number) {
  if (s.round) return Math.max(0, Math.hypot(x - s.item.x, z - s.item.z) - s.r);
  if (pointInPolygon({ x, z }, s.poly)) return 0;
  return distToOutline({ x, z }, s.poly);
}

export interface AccessResult {
  /** Mesas sin recorrido accesible desde la entrada. */
  unreachable: string[];
  tables: number;
  /** Elementos que invaden el espacio de giro delante de la puerta principal. */
  doorBlockers: string[];
  hasDoor: boolean;
}

export function checkAccessibility(project: Project): AccessResult {
  const { space } = project;
  const door = project.items.find((i) => i.type === 'puerta') ?? project.items.find((i) => i.type === 'salida');
  const shapes = project.items.map((it) => shapeOf(it, project)).filter((s): s is Shape => !!s);
  // Las mesas que están sobre el escenario (presidencia) no necesitan recorrido accesible propio
  const stages = shapes.filter((s) => s.item.type === 'escenario');
  const tables = shapes.filter((s) => isTableDef(findDef(s.item.type, project.customCatalog)) && !stages.some((st) => pointInPolygon({ x: s.item.x, z: s.item.z }, st.poly)));
  if (!door || space.outdoor) return { unreachable: [], tables: tables.length, doorBlockers: [], hasDoor: !!door };
  const noTables = tables.length === 0;

  // Punto de entrada: 1 m hacia dentro desde la puerta (su +Z local apunta al interior)
  const t = (door.rot * Math.PI) / 180;
  const inX = Math.sin(t);
  const inZ = Math.cos(t);
  const entry = { x: door.x + inX * 1.0, z: door.z + inZ * 1.0 };

  // Espacio de giro de 1,50 m delante de la puerta
  const turn = { x: door.x + inX * (TURN_SPACE / 2 + 0.05), z: door.z + inZ * (TURN_SPACE / 2 + 0.05) };
  const doorBlockers = shapes.filter((s) => s.item.id !== door.id && distTo(s, turn.x, turn.z) < TURN_SPACE / 2).map((s) => s.item.id);

  // Sin mesas no hace falta buscar recorridos
  if (noTables) return { unreachable: [], tables: 0, doorBlockers, hasDoor: true };

  // Rejilla: libre si está dentro de la sala, a ≥ 0,6 m de las paredes y de todo mueble
  const pts = roomOutline(space);
  const minX = Math.min(...pts.map((p) => p.x));
  const minZ = Math.min(...pts.map((p) => p.z));
  const nx = Math.ceil((Math.max(...pts.map((p) => p.x)) - minX) / CELL);
  const nz = Math.ceil((Math.max(...pts.map((p) => p.z)) - minZ) / CELL);
  const half = ROUTE_WIDTH / 2;
  const free = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++)
    for (let i = 0; i < nx; i++) {
      const p = { x: minX + (i + 0.5) * CELL, z: minZ + (j + 0.5) * CELL };
      // Junto a la puerta se permite pasar pegado a la pared (es por donde se entra)
      const nearDoor = Math.hypot(p.x - door.x, p.z - door.z) < 1.2;
      free[j * nx + i] = pointInPolygon(p, pts) && (nearDoor || distToOutline(p, pts) >= half) ? 1 : 0;
    }
  for (const s of shapes) {
    const xs = s.round ? [s.item.x - s.r, s.item.x + s.r] : s.poly.map((p) => p.x);
    const zs = s.round ? [s.item.z - s.r, s.item.z + s.r] : s.poly.map((p) => p.z);
    const i0 = Math.max(0, Math.floor((Math.min(...xs) - half - minX) / CELL));
    const i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + half - minX) / CELL));
    const j0 = Math.max(0, Math.floor((Math.min(...zs) - half - minZ) / CELL));
    const j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) + half - minZ) / CELL));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) if (free[j * nx + i] && distTo(s, minX + (i + 0.5) * CELL, minZ + (j + 0.5) * CELL) < half) free[j * nx + i] = 0;
  }

  // Búsqueda en anchura desde la entrada
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  const ei = Math.floor((entry.x - minX) / CELL);
  const ej = Math.floor((entry.z - minZ) / CELL);
  // Si la celda de entrada está ocupada, se toma la libre más cercana en un radio de 0,5 m
  let start = -1;
  for (let r = 0; r <= 5 && start < 0; r++)
    for (let dj = -r; dj <= r && start < 0; dj++)
      for (let di = -r; di <= r && start < 0; di++) {
        const i = ei + di;
        const j = ej + dj;
        if (i >= 0 && j >= 0 && i < nx && j < nz && free[j * nx + i]) start = j * nx + i;
      }
  if (start >= 0) {
    seen[start] = 1;
    queue.push(start);
  }
  for (let q = 0; q < queue.length; q++) {
    const c = queue[q];
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const k = b * nx + a;
      if (free[k] && !seen[k]) {
        seen[k] = 1;
        queue.push(k);
      }
    }
  }

  // Una mesa es accesible si el recorrido llega junto a su huella (a ≤ 0,75 m)
  const unreachable = tables
    .filter((s) => {
      const xs = s.round ? [s.item.x - s.r, s.item.x + s.r] : s.poly.map((p) => p.x);
      const zs = s.round ? [s.item.z - s.r, s.item.z + s.r] : s.poly.map((p) => p.z);
      const reach = half + 0.15;
      const i0 = Math.max(0, Math.floor((Math.min(...xs) - reach - minX) / CELL));
      const i1 = Math.min(nx - 1, Math.ceil((Math.max(...xs) + reach - minX) / CELL));
      const j0 = Math.max(0, Math.floor((Math.min(...zs) - reach - minZ) / CELL));
      const j1 = Math.min(nz - 1, Math.ceil((Math.max(...zs) + reach - minZ) / CELL));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) if (seen[j * nx + i] && distTo(s, minX + (i + 0.5) * CELL, minZ + (j + 0.5) * CELL) <= reach) return false;
      return true;
    })
    .map((s) => s.item.id);

  return { unreachable, tables: tables.length, doorBlockers, hasDoor: true };
}
