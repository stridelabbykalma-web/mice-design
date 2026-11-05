// Gafas de realidad mixta / virtual (WebXR, p. ej. Meta Quest 3): estado compartido.
import { create } from 'zustand';
import type { Space } from '../types';
import { roomOutline } from './outline';

export type XrMode = 'ar' | 'vr';

interface XrState {
  /** El navegador puede abrir realidad mixta (passthrough) o virtual. */
  supportsAR: boolean;
  supportsVR: boolean;
  mode: XrMode | null;
  /** Realidad mixta: 0 = marcar esquina izquierda, 1 = derecha, 2 = alineado. */
  step: 0 | 1 | 2;
  /** Mensaje que se muestra dentro de las gafas. */
  message: string;
}

export const useXR = create<XrState>(() => ({ supportsAR: false, supportsVR: false, mode: null, step: 0, message: '' }));

/** Comprueba qué modos admite este navegador (solo navegadores con WebXR, como el de Quest). */
export async function detectXR() {
  const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
  if (!xr) return;
  const [ar, vr] = await Promise.all([xr.isSessionSupported('immersive-ar').catch(() => false), xr.isSessionSupported('immersive-vr').catch(() => false)]);
  useXR.setState({ supportsAR: ar, supportsVR: vr });
}

/**
 * Las dos esquinas del frente de la sala (lado del escenario, z negativa), de izquierda a
 * derecha mirando al frente. Son las que se marcan con el mando para alinear el montaje.
 */
export function frontCorners(space: Space) {
  const pts = roomOutline(space);
  const minZ = Math.min(...pts.map((p) => p.z));
  const front = pts.filter((p) => p.z - minZ < 0.3).sort((a, b) => a.x - b.x);
  const left = front[0];
  const right = front[front.length - 1];
  if (front.length >= 2 && right.x - left.x > 0.5) return [left, right];
  // Sala sin un frente recto: las dos esquinas más adelantadas
  const two = [...pts].sort((a, b) => a.z - b.z).slice(0, 2).sort((a, b) => a.x - b.x);
  return [two[0], two[1]];
}

/**
 * Transformación que lleva las esquinas del modelo (a, b) a los puntos marcados en la sala
 * real (A, B), en planta. Devuelve el giro (convención de three.js) y el desplazamiento, y
 * la diferencia entre la distancia medida y la del modelo (para avisar si no encaja).
 */
export function alignFromCorners(a: { x: number; z: number }, b: { x: number; z: number }, A: { x: number; z: number }, B: { x: number; z: number }) {
  const angM = Math.atan2(b.z - a.z, b.x - a.x);
  const angW = Math.atan2(B.z - A.z, B.x - A.x);
  const rot = angM - angW;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  // Punto a girado (x' = x·cos + z·sin ; z' = −x·sin + z·cos) y llevado a A
  const ax = a.x * c + a.z * s;
  const az = -a.x * s + a.z * c;
  const mismatch = Math.hypot(B.x - A.x, B.z - A.z) - Math.hypot(b.x - a.x, b.z - a.z);
  return { rot, x: A.x - ax, z: A.z - az, mismatch };
}
