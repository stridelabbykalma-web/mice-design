// Importa un escaneo de sala (archivo .mice-room.json o escaneo de la app nativa de las gafas)
// y lo convierte en medidas, forma, puertas, ventanas y obstáculos del proyecto.

import type { Item, ScanPhoto } from '../types';
import { parseRoomPlan, type RoomPlanFile, type RoomPlanResult } from './roomplan';
import { WalkScan, type Obstacle, type WalkGrids } from './walkScan';
import { pointInPolygon } from './outline';
import { cornersToRoomPlan, currentRoomPlanes, planeObstacles, planesToRoomPlan, type ScanPlane } from './xrScan';

/** Un escaneo tal como llega: paredes medidas y, si viene del escaneo caminando, sus rejillas. */
export type ScanFile = RoomPlanFile & { walk?: WalkGrids; scene?: SceneAnchor[]; name?: string; device?: string };

export interface ScanResult extends RoomPlanResult {
  /** Obstáculos fijos (armarios, barras, muebles) en coordenadas de la sala. */
  fixed: Omit<Item, 'id'>[];
  name?: string;
}

/** Lleva los obstáculos de las coordenadas del escaneo a las de la sala del proyecto. */
export function placeObstacles(frame: RoomPlanResult['frame'], obstacles: Obstacle[]): Omit<Item, 'id'>[] {
  const ct = Math.cos(-frame.theta);
  const sn = Math.sin(-frame.theta);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return obstacles.map((o) => {
    const X = o.x - frame.x;
    const Z = o.z - frame.z;
    return { type: 'obstaculo', x: r2(X * ct - Z * sn), z: r2(X * sn + Z * ct), rot: r2(o.rot + (frame.theta * 180) / Math.PI), w: r2(o.w), d: r2(o.d), h: r2(o.h) };
  });
}

/** Un elemento de la sala tal como lo tienen anotado las gafas (escaneo de Meta), en coordenadas de Unity. */
export interface SceneAnchor {
  /** WALL_FACE, FLOOR, CEILING, DOOR_FRAME, WINDOW_FRAME, TABLE, COUCH, STORAGE, BED, SCREEN, LAMP, PLANT, OTHER… */
  label: string;
  room: number;
  pos: number[];
  /** Cuaternión (x, y, z, w). */
  rot: number[];
  /** Planos: rectángulo local [x, y, ancho, alto]. */
  rect?: number[];
  /** Volúmenes: caja local [cx, cy, cz, sx, sy, sz]. */
  vol?: number[];
}

type V = [number, number, number];
/** Gira un vector con un cuaternión. */
function qrot(q: number[], v: V): V {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

const SCENE_LABEL: Record<string, string> = { WALL_FACE: 'wall', INVISIBLE_WALL_FACE: 'wall', INNER_WALL_FACE: 'wall', FLOOR: 'floor', CEILING: 'ceiling', DOOR_FRAME: 'door', WINDOW_FRAME: 'window' };
const SKIP = new Set(['GLOBAL_MESH', 'WALL_ART', 'CEILING_LIGHT']);

/** Convierte los elementos de Meta en planos como los del escaneo por navegador (coordenadas de la web: z cambiada de signo). */
export function sceneToPlanes(anchors: SceneAnchor[], room?: number): ScanPlane[] {
  const out: ScanPlane[] = [];
  for (const a of anchors) {
    if (room !== undefined && a.room !== room) continue;
    // Las etiquetas pueden venir combinadas («TABLE, OTHER»): manda la primera
    const raw = a.label.split(/[,| ]+/).filter(Boolean)[0]?.toUpperCase() ?? 'OTHER';
    if (SKIP.has(raw)) continue;
    const world = (l: V) => {
      const r = qrot(a.rot, l);
      return { x: a.pos[0] + r[0], y: a.pos[1] + r[1], z: -(a.pos[2] + r[2]) };
    };
    const label = SCENE_LABEL[raw];
    if (label && a.rect) {
      const [x, y, w, h] = a.rect;
      out.push({ label, orientation: label === 'floor' || label === 'ceiling' ? 'horizontal' : 'vertical', points: [world([x, y, 0]), world([x + w, y, 0]), world([x + w, y + h, 0]), world([x, y + h, 0])] });
    } else if (!label && a.vol) {
      // Mueble: se manda su cara de arriba (las cuatro esquinas más altas de la caja)
      const [cx, cy, cz, sx, sy, sz] = a.vol;
      const cs: { x: number; y: number; z: number }[] = [];
      for (const dx of [-1, 1]) for (const dy of [-1, 1]) for (const dz of [-1, 1]) cs.push(world([cx + (dx * sx) / 2, cy + (dy * sy) / 2, cz + (dz * sz) / 2]));
      cs.sort((p, q) => q.y - p.y);
      const top = cs.slice(0, 4);
      // Ordenadas alrededor de su centro para formar el rectángulo
      const mx = top.reduce((t, p) => t + p.x, 0) / 4;
      const mz = top.reduce((t, p) => t + p.z, 0) / 4;
      top.sort((p, q) => Math.atan2(p.z - mz, p.x - mx) - Math.atan2(q.z - mz, q.x - mx));
      out.push({ label: raw.toLowerCase(), orientation: 'horizontal', points: top });
    } else if (!label && a.rect) {
      // Mueble anotado solo como plano (una mesa sin volumen)
      const [x, y, w, h] = a.rect;
      const pts = [world([x, y, 0]), world([x + w, y, 0]), world([x + w, y + h, 0]), world([x, y + h, 0])];
      const flat = Math.max(...pts.map((p) => p.y)) - Math.min(...pts.map((p) => p.y)) < 0.2;
      if (flat) out.push({ label: raw.toLowerCase(), orientation: 'horizontal', points: pts });
    }
  }
  return out;
}

/** Mueble del catálogo y nombre para cada etiqueta de Meta. */
const FURNITURE: Record<string, { type: string; label: string; chairs?: number }> = {
  couch: { type: 'sofa', label: 'Sofá' },
  table: { type: 'mesa-imperial', label: 'Mesa', chairs: 0 },
  plant: { type: 'planta', label: 'Planta' },
  storage: { type: 'obstaculo', label: 'Armario o estantería' },
  bed: { type: 'obstaculo', label: 'Cama' },
  screen: { type: 'obstaculo', label: 'Pantalla o televisor' },
  lamp: { type: 'obstaculo', label: 'Lámpara' },
  other: { type: 'obstaculo', label: 'Mueble' },
};

export function importScan(json: unknown, fallbackHeight = 3): ScanResult {
  const f = json as ScanFile;
  if (!f || f.format !== 'mice-roomplan') throw new Error('No es un escaneo de MICE Design.');
  const walk = f.walk ? WalkScan.fromGrids(f.walk) : null;
  const walkOutline = walk?.outline() ?? null;

  // 1. Si las gafas tienen la sala anotada (escaneo de Meta), manda eso: paredes, puertas,
  //    ventanas y muebles con su nombre. Se usa la habitación por la que se ha caminado.
  if (f.scene?.length) {
    const all = sceneToPlanes(f.scene);
    // La habitación es la del suelo por el que más se ha caminado (si se pasa a otra al final, no cuenta)
    const path: { x: number; z: number }[] = [];
    for (let i = 0; f.walk && i + 1 < f.walk.path.length; i += 2) path.push({ x: f.walk.path[i] / 100, z: f.walk.path[i + 1] / 100 });
    let head = path[0] ?? { x: 0, z: 0 };
    let most = 0;
    for (const fl of all.filter((p) => p.label === 'floor')) {
      const poly = fl.points.map((q) => ({ x: q.x, z: q.z }));
      const inside = path.filter((q) => pointInPolygon(q, poly));
      if (inside.length > most) {
        most = inside.length;
        head = inside[0];
      }
    }
    const planes = currentRoomPlanes(all, head);
    if (planes.filter((p) => p.label === 'wall').length >= 3) {
      const r = parseRoomPlan(planesToRoomPlan(planes));
      const metaBoxes = planeObstacles(planes);
      const fixed = placeObstacles(r.frame, metaBoxes).map((it, i) => {
        const m = FURNITURE[metaBoxes[i].label] ?? FURNITURE.other;
        return { ...it, type: m.type, label: m.label, ...(m.chairs !== undefined ? { chairs: m.chairs } : {}) };
      });
      // Lo que ha visto el escaneo caminando y Meta no tiene anotado se añade como obstáculo
      let extra = 0;
      if (walk && walkOutline) {
        const more = walk.obstacles(walkOutline).filter((o) => !metaBoxes.some((b) => Math.hypot(b.x - o.x, b.z - o.z) < Math.max(b.w, b.d) / 2 + Math.max(o.w, o.d) / 2));
        const inRoom = placeObstacles(r.frame, more).filter((it) => Math.abs(it.x) < r.width / 2 && Math.abs(it.z) < r.depth / 2);
        extra = inRoom.length;
        fixed.push(...inRoom.map((it) => ({ ...it, label: 'Sin identificar' })));
      }
      const named = fixed.length - extra;
      return { ...r, fixed, name: f.name, summary: `${r.summary} · ${named} muebles identificados por las gafas${extra ? ` y ${extra} obstáculos más` : ''}.` };
    }
  }
  if (walk) {
    // 2. Solo el escaneo caminando: la planta se reconstruye aquí
    const scan = walk;
    const o = walkOutline;
    if (!o) throw new Error('El escaneo no tiene paredes suficientes para reconstruir la sala. Repítelo caminando por toda la sala y mirando a las paredes.');
    const r = parseRoomPlan(cornersToRoomPlan(o.outline, scan.ceiling ?? fallbackHeight));
    const fixed = placeObstacles(r.frame, scan.obstacles(o));
    return { ...r, fixed, name: f.name, summary: `${r.summary.replace(' Revisa qué puertas son salidas de emergencia.', '')} · ${fixed.length} muebles u obstáculos. Añade las puertas y salidas.` };
  }
  return { ...parseRoomPlan(f), fixed: [], name: f.name };
}

/** Datos de una foto tal como los envía la app de las gafas (coordenadas de Unity). */
export interface PhotoMeta {
  pos: number[];
  rot: number[];
  w?: number;
  h?: number;
}

/**
 * Lleva las fotos a la sala: posición en planta, rumbo y pared a la que miran (la primera que
 * corta el rayo de la mirada, en el contorno de la sala).
 */
export function placePhotos(frame: RoomPlanResult['frame'], outline: { x: number; z: number }[], metas: PhotoMeta[]): Omit<ScanPhoto, 'assetId'>[] {
  const ct = Math.cos(-frame.theta);
  const sn = Math.sin(-frame.theta);
  return metas.map((m) => {
    // Unity → web: z cambia de signo
    const wx = m.pos[0];
    const wz = -m.pos[2];
    const f = qrot(m.rot, [0, 0, 1]);
    const fx = f[0];
    const fz = -f[2];
    const X = wx - frame.x;
    const Z = wz - frame.z;
    const x = X * ct - Z * sn;
    const z = X * sn + Z * ct;
    let dx = fx * ct - fz * sn;
    let dz = fx * sn + fz * ct;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l;
    dz /= l;
    // Rumbo: 0 = frente (−z), 90 = derecha (+x)
    const heading = Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360);
    let wall: number | undefined;
    let best = Infinity;
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((a.x - x) * ez - (a.z - z) * ex) / den;
      const u = ((a.x - x) * dz - (a.z - z) * dx) / den;
      if (t > 0.05 && u >= 0 && u <= 1 && t < best) {
        best = t;
        wall = i;
      }
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    return { x: r2(x), z: r2(z), heading, wall };
  });
}
