// Utilidades geométricas en planta (plano XZ). Rotación en grados alrededor de Y,
// con el mismo convenio que three.js: x' = x·cosθ + z·sinθ ; z' = −x·sinθ + z·cosθ.

export interface OBB {
  x: number;
  z: number;
  w: number;
  d: number;
  rot: number;
}

export const DEG = Math.PI / 180;

export function toWorld(cx: number, cz: number, rotDeg: number, lx: number, lz: number) {
  const t = rotDeg * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: cx + lx * c + lz * s, z: cz - lx * s + lz * c };
}

export function corners(b: OBB) {
  const hw = b.w / 2;
  const hd = b.d / 2;
  return [
    toWorld(b.x, b.z, b.rot, -hw, -hd),
    toWorld(b.x, b.z, b.rot, hw, -hd),
    toWorld(b.x, b.z, b.rot, hw, hd),
    toWorld(b.x, b.z, b.rot, -hw, hd),
  ];
}

function axes(b: OBB) {
  const t = b.rot * DEG;
  return [
    { x: Math.cos(t), z: -Math.sin(t) },
    { x: Math.sin(t), z: Math.cos(t) },
  ];
}

/** Intersección de dos rectángulos orientados (teorema del eje separador). */
export function obbOverlap(a: OBB, b: OBB, tolerance = 0.02): boolean {
  const ra = Math.hypot(a.w, a.d) / 2;
  const rb = Math.hypot(b.w, b.d) / 2;
  if (Math.hypot(a.x - b.x, a.z - b.z) > ra + rb) return false;
  const ca = corners(a);
  const cb = corners(b);
  for (const ax of [...axes(a), ...axes(b)]) {
    const pa = ca.map((p) => p.x * ax.x + p.z * ax.z);
    const pb = cb.map((p) => p.x * ax.x + p.z * ax.z);
    if (Math.max(...pa) - tolerance <= Math.min(...pb) || Math.max(...pb) - tolerance <= Math.min(...pa)) return false;
  }
  return true;
}

/** ¿Está el rectángulo completamente dentro del recinto (centrado en el origen)? */
export function insideRoom(b: OBB, width: number, depth: number, margin = 0) {
  return corners(b).every(
    (p) => Math.abs(p.x) <= width / 2 - margin + 1e-6 && Math.abs(p.z) <= depth / 2 - margin + 1e-6,
  );
}

/** Ancla un elemento a la pared más cercana y devuelve posición y rotación. */
export function snapToWall(x: number, z: number, width: number, depth: number, itemDepth: number) {
  const dN = Math.abs(z + depth / 2);
  const dS = Math.abs(z - depth / 2);
  const dW = Math.abs(x + width / 2);
  const dE = Math.abs(x - width / 2);
  const m = Math.min(dN, dS, dW, dE);
  const half = itemDepth / 2;
  const clampX = Math.max(-width / 2, Math.min(width / 2, x));
  const clampZ = Math.max(-depth / 2, Math.min(depth / 2, z));
  if (m === dN) return { x: clampX, z: -depth / 2 + half, rot: 0 };
  if (m === dS) return { x: clampX, z: depth / 2 - half, rot: 180 };
  if (m === dW) return { x: -width / 2 + half, z: clampZ, rot: 90 };
  return { x: width / 2 - half, z: clampZ, rot: -90 };
}

export function snapValue(v: number, step: number) {
  return Math.round(v / step) * step;
}

export function round2(v: number) {
  return Math.round(v * 100) / 100;
}
