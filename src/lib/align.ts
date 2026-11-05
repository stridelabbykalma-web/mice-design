// Encajar un escaneo (splat) con el plano: se marcan dos puntos del escaneo y los dos puntos
// del plano a los que corresponden (por ejemplo, dos esquinas). Con eso se calcula la escala,
// el giro y el desplazamiento, de modo que la geometría exacta sale del plano y el aspecto
// real, del escaneo del iPhone.

import type { SplatScene } from '../types';

export interface P2 {
  x: number;
  z: number;
}

/** Ángulo con el mismo sentido que un giro alrededor de Y en three.js. */
const angle = (v: P2) => Math.atan2(-v.z, v.x);
const rotY = (p: P2, r: number): P2 => ({ x: p.x * Math.cos(r) + p.z * Math.sin(r), z: -p.x * Math.sin(r) + p.z * Math.cos(r) });

/** Semejanza (escala, giro y traslación) que lleva a→A y b→B. */
export function similarity(a: P2, b: P2, A: P2, B: P2) {
  const v = { x: b.x - a.x, z: b.z - a.z };
  const V = { x: B.x - A.x, z: B.z - A.z };
  const lv = Math.hypot(v.x, v.z);
  if (lv < 0.05) throw new Error('Los dos puntos del escaneo están demasiado juntos.');
  const s = Math.hypot(V.x, V.z) / lv;
  const r = angle(V) - angle(v);
  const ra = rotY(a, r);
  return { s, r, tx: A.x - s * ra.x, tz: A.z - s * ra.z };
}

export function applySim(p: P2, m: ReturnType<typeof similarity>): P2 {
  const q = rotY(p, m.r);
  return { x: m.s * q.x + m.tx, z: m.s * q.z + m.tz };
}

const DEG = Math.PI / 180;

/** Aplica la corrección al splat (encima de su colocación actual). */
export function alignSplat(sp: SplatScene, a: P2, b: P2, A: P2, B: P2): SplatScene {
  const m = similarity(a, b, A, B);
  const off = applySim({ x: sp.offsetX, z: sp.offsetZ }, m);
  let rot = sp.rotation + m.r / DEG;
  rot = ((((rot + 180) % 360) + 360) % 360) - 180;
  return {
    ...sp,
    scale: sp.scale * m.s,
    rotation: rot,
    offsetX: off.x,
    offsetZ: off.z,
    offsetY: sp.offsetY * m.s,
  };
}

/** Lleva el punto a la esquina del plano más cercana si está a menos de `max` metros. */
export function snapToCorner(p: P2, corners: P2[], max = 0.6): P2 {
  let best: P2 | null = null;
  let d = max;
  for (const c of corners) {
    const dd = Math.hypot(c.x - p.x, c.z - p.z);
    if (dd < d) {
      d = dd;
      best = c;
    }
  }
  return best ? { ...best } : p;
}
