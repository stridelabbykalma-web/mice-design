// Medir la sala con las gafas (Meta Quest 3 / 3S, WebXR).
//  · Escaneo: las gafas guardan el escaneo de la sala («Configuración del espacio») como planos
//    con etiqueta: suelo, techo, paredes, puertas, ventanas. Aquí se convierten al mismo
//    formato que la medición del iPhone (RoomPlan) y se reutiliza su importador.
//  · Trazado a mano: para salones grandes que el escaneo de las gafas no cubre entero, se
//    marcan las esquinas en el suelo con el mando.
//  · Encaje automático: al volver a entrar en realidad mixta, las paredes detectadas se encajan
//    con el contorno de la sala del proyecto (venga del escaneo, del plano o del iPhone).

import type { Space } from '../types';
import type { RoomPlanFile } from './roomplan';
import { roomOutline } from './outline';

export type V3 = { x: number; y: number; z: number };

/** Un plano detectado por las gafas, ya en coordenadas de la sesión (metros). */
export interface ScanPlane {
  /** 'wall', 'floor', 'ceiling', 'door', 'window'… (semanticLabel de WebXR). */
  label: string;
  orientation: 'horizontal' | 'vertical';
  /** Vértices del contorno del plano en el mundo. */
  points: V3[];
  /** Cuándo cambió por última vez (ms del reloj de la página). */
  changed?: number;
}

/** Superficie vertical → [ancho, alto] y matriz 4×4 (por columnas) al estilo de RoomPlan. */
function verticalSurface(points: V3[]) {
  // Dirección horizontal del plano: la del par de vértices más separados en planta.
  let best = 0;
  let dir = { x: 1, z: 0 };
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      const dz = points[j].z - points[i].z;
      const d = Math.hypot(dx, dz);
      if (d > best) {
        best = d;
        dir = { x: dx / d, z: dz / d };
      }
    }
  const t = points.map((p) => p.x * dir.x + p.z * dir.z);
  const minT = Math.min(...t);
  const maxT = Math.max(...t);
  const minY = Math.min(...points.map((p) => p.y));
  const maxY = Math.max(...points.map((p) => p.y));
  // Punto del plano en planta (media) proyectado sobre su eje
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const mz = points.reduce((s, p) => s + p.z, 0) / points.length;
  const off = mx * dir.x + mz * dir.z;
  const mid = (minT + maxT) / 2;
  const cx = mx + dir.x * (mid - off);
  const cz = mz + dir.z * (mid - off);
  const transform = [dir.x, 0, dir.z, 0, 0, 1, 0, 0, -dir.z, 0, dir.x, 0, cx, (minY + maxY) / 2, cz, 1];
  return { dimensions: [maxT - minT, maxY - minY, 0], transform };
}

/** Convierte los planos de las gafas en una medición como la del iPhone. */
export function planesToRoomPlan(planes: ScanPlane[]): RoomPlanFile {
  const vert = (l: string) => planes.filter((p) => p.orientation === 'vertical' && p.label === l && p.points.length >= 3);
  const walls = vert('wall')
    .map((p) => verticalSurface(p.points))
    .filter((w) => w.dimensions[0] > 0.3);
  if (!walls.length) throw new Error('Las gafas no tienen paredes escaneadas en esta sala.');
  // La altura de las paredes: hasta el techo si lo hay
  const floor = planes.find((p) => p.label === 'floor');
  const ceiling = planes.find((p) => p.label === 'ceiling');
  if (ceiling) {
    // Sin plano de suelo, el suelo es y = 0 (la sesión usa el suelo como referencia)
    const fy = floor ? floor.points.reduce((s, p) => s + p.y, 0) / floor.points.length : 0;
    const cy = ceiling.points.reduce((s, p) => s + p.y, 0) / ceiling.points.length;
    for (const w of walls) {
      w.dimensions[1] = cy - fy;
      w.transform[13] = (fy + cy) / 2;
    }
  }
  return {
    format: 'mice-roomplan',
    version: 1,
    walls,
    doors: vert('door').map((p) => verticalSurface(p.points)),
    windows: vert('window').map((p) => verticalSurface(p.points)),
  };
}

/** Sala a partir de las esquinas marcadas en el suelo con el mando (en orden). */
export function cornersToRoomPlan(corners: { x: number; z: number }[], height: number): RoomPlanFile {
  if (corners.length < 3) throw new Error('Marca al menos tres esquinas.');
  const walls = corners.map((a, i) => {
    const b = corners[(i + 1) % corners.length];
    return verticalSurface([
      { x: a.x, y: 0, z: a.z },
      { x: b.x, y: 0, z: b.z },
      { x: b.x, y: height, z: b.z },
      { x: a.x, y: height, z: a.z },
    ]);
  });
  return { format: 'mice-roomplan', version: 1, walls };
}

/** Segmentos de pared en planta (mundo) de los planos detectados. */
export function wallSegments(planes: ScanPlane[]) {
  return planes
    .filter((p) => p.orientation === 'vertical' && p.label === 'wall' && p.points.length >= 3)
    .map((p) => {
      const s = verticalSurface(p.points);
      const h = s.dimensions[0] / 2;
      const [dx, , dz] = s.transform;
      const cx = s.transform[12];
      const cz = s.transform[14];
      return { a: { x: cx - dx * h, z: cz - dz * h }, b: { x: cx + dx * h, z: cz + dz * h } };
    })
    .filter((g) => Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z) > 0.3);
}

type P = { x: number; z: number };
type Seg = { a: P; b: P };

function distToSeg(p: P, s: Seg) {
  const vx = s.b.x - s.a.x;
  const vz = s.b.z - s.a.z;
  const l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - s.a.x) * vx + (p.z - s.a.z) * vz) / l2));
  return Math.hypot(p.x - s.a.x - t * vx, p.z - s.a.z - t * vz);
}

/**
 * Coloca el modelo de la sala sobre las paredes reales detectadas. Devuelve el giro y el
 * desplazamiento (misma convención que alignFromCorners) y el error medio en metros.
 * Prueba los cuatro giros posibles respecto a la pared más larga y se queda con el que mejor
 * encaja; así funciona aunque la sala del proyecto venga del plano o del iPhone.
 */
export function fitModelToWalls(space: Space, segs: Seg[], doors?: { model: P[]; world: P[] }) {
  if (!segs.length) return null;
  const outline = roomOutline(space);
  const edges: Seg[] = outline.map((a, i) => ({ a, b: outline[(i + 1) % outline.length] }));
  // Puntos de muestra de las paredes reales (cada 25 cm)
  const samples: P[] = [];
  for (const g of segs) {
    const len = Math.hypot(g.b.x - g.a.x, g.b.z - g.a.z);
    const n = Math.max(2, Math.ceil(len / 0.25));
    for (let i = 0; i <= n; i++) samples.push({ x: g.a.x + ((g.b.x - g.a.x) * i) / n, z: g.a.z + ((g.b.z - g.a.z) * i) / n });
  }
  const longest = [...segs].sort((p, q) => Math.hypot(q.b.x - q.a.x, q.b.z - q.a.z) - Math.hypot(p.b.x - p.a.x, p.b.z - p.a.z))[0];
  const angW = Math.atan2(longest.b.z - longest.a.z, longest.b.x - longest.a.x);
  // Centro de las paredes reales
  const xs = samples.map((p) => p.x);
  const zs = samples.map((p) => p.z);
  const candidates: { rot: number; x: number; z: number; error: number; score: number }[] = [];
  // Direcciones de los lados del modelo: la pared real más larga corresponde a alguno de ellos
  const modelAngles = new Set<number>();
  for (const e of edges) {
    const a = Math.atan2(e.b.z - e.a.z, e.b.x - e.a.x);
    for (const k of [0, Math.PI]) modelAngles.add(Math.round(((a + k) % (2 * Math.PI)) * 1000) / 1000);
  }
  for (const angM of modelAngles) {
    // rot lleva direcciones del modelo al mundo: ángulo_mundo = ángulo_modelo − rot
    const rot = angM - angW;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    // Del mundo al modelo (inverso del giro de three.js sobre Y): x = X·c − Z·s ; z = X·s + Z·c
    const toModel = (p: P, tx: number, tz: number) => {
      const X = p.x - tx;
      const Z = p.z - tz;
      return { x: X * c - Z * s, z: X * s + Z * c };
    };
    // Desplazamiento inicial: centro de las paredes reales sobre el centro del modelo, y
    // unas iteraciones para afinar (cada muestra hacia el lado más cercano).
    let tx = (Math.min(...xs) + Math.max(...xs)) / 2;
    let tz = (Math.min(...zs) + Math.max(...zs)) / 2;
    for (let it = 0; it < 15; it++) {
      let sx = 0;
      let sz = 0;
      for (const p of samples) {
        const m = toModel(p, tx, tz);
        let bd = Infinity;
        let q = m;
        for (const e of edges) {
          const d = distToSeg(m, e);
          if (d < bd) {
            bd = d;
            const vx = e.b.x - e.a.x;
            const vz = e.b.z - e.a.z;
            const t = Math.max(0, Math.min(1, ((m.x - e.a.x) * vx + (m.z - e.a.z) * vz) / (vx * vx + vz * vz || 1)));
            q = { x: e.a.x + t * vx, z: e.a.z + t * vz };
          }
        }
        sx += m.x - q.x;
        sz += m.z - q.z;
      }
      // Corrección media en el modelo, devuelta al mundo (giro directo)
      const dx = sx / samples.length;
      const dz = sz / samples.length;
      tx += dx * c + dz * s;
      tz += -dx * s + dz * c;
      if (Math.hypot(dx, dz) < 0.001) break;
    }
    const error = samples.reduce((acc, p) => acc + Math.min(...edges.map((e) => distToSeg(toModel(p, tx, tz), e))), 0) / samples.length;
    // En salas simétricas (un rectángulo encaja igual girado 180°) deciden las puertas.
    let doorError = 0;
    if (doors?.model.length && doors.world.length)
      doorError =
        doors.world.reduce((acc, w) => {
          const m = toModel(w, tx, tz);
          return acc + Math.min(...doors.model.map((d) => Math.hypot(d.x - m.x, d.z - m.z)));
        }, 0) / doors.world.length;
    candidates.push({ rot, x: tx, z: tz, error, score: error + 0.2 * doorError });
  }
  candidates.sort((p, q) => p.score - q.score);
  const best = candidates[0];
  // Ambiguo: otra posición distinta encaja casi igual de bien (sala simétrica sin puertas).
  const ambiguous = candidates.some((c) => c !== best && Math.abs(c.score - best.score) < 0.05 && Math.hypot(c.x - best.x, c.z - best.z) + Math.abs(Math.sin((c.rot - best.rot) / 2)) > 0.3);
  return { rot: best.rot, x: best.x, z: best.z, error: best.error, ambiguous };
}

function pointInPoly(p: P, poly: P[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}
const distToPoly = (p: P, poly: P[]) => Math.min(...poly.map((a, i) => distToSeg(p, { a, b: poly[(i + 1) % poly.length] })));

/** ¿Se cruzan los segmentos ab y cd? */
function cross(a: P, b: P, c: P, d: P) {
  const o = (p: P, q: P, r: P) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/**
 * Las gafas guardan varias salas (también las contiguas) y las devuelven todas juntas. Se
 * dejan solo los planos de la sala en la que está la persona:
 *  · si hay planos de suelo, la sala es el suelo que tiene debajo (o el más cercano) y sus
 *    paredes, puertas y ventanas son las que están en el borde de ese suelo;
 *  · si no, las paredes que se ven desde donde está sin otra pared por medio.
 */
export function currentRoomPlanes(planes: ScanPlane[], head: P): ScanPlane[] {
  const flat = (pl: ScanPlane) => pl.points.map((q) => ({ x: q.x, z: q.z }));
  const mid = (pl: ScanPlane) => ({ x: pl.points.reduce((s, q) => s + q.x, 0) / pl.points.length, z: pl.points.reduce((s, q) => s + q.z, 0) / pl.points.length });
  const floors = planes.filter((p) => p.label === 'floor' && p.points.length >= 3);
  if (floors.length) {
    const floor = floors.find((f) => pointInPoly(head, flat(f))) ?? [...floors].sort((a, b) => distToPoly(head, flat(a)) - distToPoly(head, flat(b)))[0];
    const poly = flat(floor);
    const near = (p: P, tol: number) => pointInPoly(p, poly) || distToPoly(p, poly) < tol;
    return planes.filter((pl) => {
      if (pl === floor) return true;
      if (pl.label === 'floor') return false;
      const m = mid(pl);
      // Verticales (paredes, puertas, ventanas): justo en el borde de este suelo (la pared de la
      // sala contigua queda al otro lado del tabique, a más de 12 cm). El resto, encima de él.
      return pl.orientation === 'vertical' ? distToPoly(m, poly) < 0.12 : near(m, 0.3);
    });
  }
  const walls = planes.filter((p) => p.orientation === 'vertical' && p.label === 'wall' && p.points.length >= 3);
  if (walls.length <= 4) return planes;
  const segs = wallSegments(walls);
  const visible = (m: P) => !segs.some((g) => cross(head, m, g.a, g.b));
  const keep = planes.filter((pl) => pl.orientation !== 'vertical' || visible({ x: head.x + (mid(pl).x - head.x) * 0.97, z: head.z + (mid(pl).z - head.z) * 0.97 }));
  // Si el filtro deja menos de tres paredes, mejor no filtrar
  return keep.filter((p) => p.label === 'wall').length >= 3 ? keep : planes;
}
