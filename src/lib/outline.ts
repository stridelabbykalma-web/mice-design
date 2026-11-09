// Salas con cualquier forma: contorno poligonal en planta (metros, centrado en el origen).
// Si la sala no tiene contorno se usa el rectángulo ancho × fondo de siempre.

import type { Space } from '../types';
import { OBB, corners, insideRoom, snapToWall } from './geometry';

export type P2 = { x: number; z: number };

export function rectOutline(w: number, d: number): P2[] {
  return [
    { x: -w / 2, z: -d / 2 },
    { x: w / 2, z: -d / 2 },
    { x: w / 2, z: d / 2 },
    { x: -w / 2, z: d / 2 },
  ];
}

/** Contorno efectivo de la sala (el polígono o el rectángulo). */
export function roomOutline(space: Space): P2[] {
  return space.outline && space.outline.length >= 3 ? space.outline : rectOutline(space.width, space.depth);
}

export function polygonArea(pts: P2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return Math.abs(a) / 2;
}

/** Superficie útil de la sala en m². */
export const roomArea = (space: Space) => (space.outline && space.outline.length >= 3 ? polygonArea(space.outline) : space.width * space.depth);

export function pointInPolygon(p: P2, pts: P2[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

function closestOnSegment(p: P2, a: P2, b: P2) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2));
  const c = { x: a.x + t * dx, z: a.z + t * dz };
  return { c, t, d: Math.hypot(p.x - c.x, p.z - c.z) };
}

export function distToOutline(p: P2, pts: P2[]) {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) m = Math.min(m, closestOnSegment(p, pts[i], pts[(i + 1) % pts.length]).d);
  return m;
}

/** ¿Se cruzan los segmentos ab y cd (cruce propio, sin contar extremos que se tocan)? */
function segmentsCross(a: P2, b: P2, c: P2, d: P2) {
  const o = (p: P2, q: P2, r: P2) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const e = 1e-9;
  const d1 = o(a, b, c);
  const d2 = o(a, b, d);
  const d3 = o(c, d, a);
  const d4 = o(c, d, b);
  return ((d1 > e && d2 < -e) || (d1 < -e && d2 > e)) && ((d3 > e && d4 < -e) || (d3 < -e && d4 > e));
}

/** ¿Está el rectángulo dentro de la sala, a una distancia mínima de las paredes? */
export function insideSpace(b: OBB, space: Space, margin = 0) {
  if (!space.outline || space.outline.length < 3) return insideRoom(b, space.width, space.depth, margin);
  const pts = space.outline;
  const cs = corners(b);
  if (!cs.every((c) => pointInPolygon(c, pts))) return false;
  // Ninguna esquina de la sala puede quedar dentro del rectángulo (salas en L, entrantes)
  if (pts.some((v) => pointInPolygon(v, cs))) return false;
  // Ni una pared puede atravesarlo (entrantes estrechos, salas en U)
  for (let i = 0; i < cs.length; i++)
    for (let j = 0; j < pts.length; j++) if (segmentsCross(cs[i], cs[(i + 1) % cs.length], pts[j], pts[(j + 1) % pts.length])) return false;
  return margin <= 0 || cs.every((c) => distToOutline(c, pts) >= margin - 1e-6);
}

/** Interior hacia la izquierda o la derecha de cada arista según el sentido del polígono. */
function signedArea(pts: P2[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.z - q.x * p.z;
  }
  return a / 2;
}

/** Normal hacia el interior de la arista i. */
export function inwardNormal(pts: P2[], i: number): P2 {
  const a = pts[i];
  const b = pts[(i + 1) % pts.length];
  const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
  const s = signedArea(pts) > 0 ? 1 : -1;
  return { x: (-(b.z - a.z) / L) * s, z: ((b.x - a.x) / L) * s };
}

/** Ancla un elemento a la pared más cercana de la sala, mirando hacia el interior. */
export function snapToRoomWall(x: number, z: number, space: Space, itemDepth: number) {
  if (!space.outline || space.outline.length < 3) return snapToWall(x, z, space.width, space.depth, itemDepth);
  const pts = space.outline;
  let best = { i: 0, c: pts[0], d: Infinity };
  for (let i = 0; i < pts.length; i++) {
    const r = closestOnSegment({ x, z }, pts[i], pts[(i + 1) % pts.length]);
    if (r.d < best.d) best = { i, c: r.c, d: r.d };
  }
  const n = inwardNormal(pts, best.i);
  // Giro tal que el +Z local del elemento apunte hacia el interior: (sin θ, cos θ) = n
  const rot = (Math.atan2(n.x, n.z) * 180) / Math.PI;
  return { x: best.c.x + n.x * (itemDepth / 2), z: best.c.z + n.z * (itemDepth / 2), rot: Math.round(rot * 100) / 100 };
}

/** Centra el contorno en el origen y devuelve también sus medidas. */
export function normalizeOutline(pts: P2[]) {
  const xs = pts.map((p) => p.x);
  const zs = pts.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  return {
    outline: pts.map((p) => ({ x: r(p.x - cx), z: r(p.z - cz) })),
    width: r(Math.max(...xs) - Math.min(...xs)),
    depth: r(Math.max(...zs) - Math.min(...zs)),
  };
}

/** Formas habituales: en L, en U y en T, a partir del ancho y el fondo totales. */
export function presetOutline(kind: 'L' | 'U' | 'T', w: number, d: number): P2[] {
  const a = w / 2;
  const b = d / 2;
  if (kind === 'L')
    return [
      { x: -a, z: -b },
      { x: a, z: -b },
      { x: a, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: b },
      { x: -a, z: b },
    ];
  if (kind === 'U')
    return [
      { x: -a, z: -b },
      { x: a, z: -b },
      { x: a, z: b },
      { x: a / 3, z: b },
      { x: a / 3, z: 0 },
      { x: -a / 3, z: 0 },
      { x: -a / 3, z: b },
      { x: -a, z: b },
    ];
  return [
    { x: -a, z: -b },
    { x: a, z: -b },
    { x: a, z: -b / 3 },
    { x: a / 3, z: -b / 3 },
    { x: a / 3, z: b },
    { x: -a / 3, z: b },
    { x: -a / 3, z: -b / 3 },
    { x: -a, z: -b / 3 },
  ];
}
