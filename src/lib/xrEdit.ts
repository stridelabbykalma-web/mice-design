// Editar el montaje desde las gafas: lógica sin 3D (paleta, a qué mueble se apunta).
import type { CatalogDef } from '../types';
import { findDef, itemDims } from '../catalog';
import type { Item } from '../types';

/** Lo que se puede añadir desde la paleta de las gafas. */
export const XR_PALETTE: { type: string; label: string }[] = [
  { type: 'mesa-redonda-180', label: 'Mesa Ø180' },
  { type: 'mesa-redonda-150', label: 'Mesa Ø150' },
  { type: 'mesa-imperial', label: 'Mesa rect.' },
  { type: 'mesa-coctel', label: 'Cóctel' },
  { type: 'silla', label: 'Silla' },
  { type: 'escenario', label: 'Escenario' },
  { type: 'atril', label: 'Atril' },
  { type: 'barra', label: 'Barra' },
  { type: 'buffet', label: 'Buffet' },
  { type: 'planta', label: 'Planta' },
];

export const XR_ACTIONS = [
  { id: 'deshacer', label: '↶ Deshacer' },
  { id: 'recolocar', label: 'Recolocar sala' },
  { id: 'cerrar', label: 'Cerrar' },
] as const;
export type XrAction = (typeof XR_ACTIONS)[number]['id'];

export const MENU_COLS = 5;
export const MENU_ROWS = 3; // 2 de muebles + 1 de acciones

/** Casilla de la paleta en la posición (u, v) de la imagen (0..1, v = 0 abajo como en three.js). */
export function menuTile(u: number, v: number): { kind: 'item'; index: number } | { kind: 'action'; id: XrAction } | null {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const row = Math.min(MENU_ROWS - 1, Math.floor((1 - v) * MENU_ROWS));
  if (row < 2) {
    const col = Math.min(MENU_COLS - 1, Math.floor(u * MENU_COLS));
    const index = row * MENU_COLS + col;
    return index < XR_PALETTE.length ? { kind: 'item', index } : null;
  }
  const a = Math.min(XR_ACTIONS.length - 1, Math.floor(u * XR_ACTIONS.length));
  return { kind: 'action', id: XR_ACTIONS[a].id };
}

/** Lo que no se mueve desde las gafas: la arquitectura, lo escaneado y lo que va encima de las mesas. */
const FIXED = new Set(['puerta', 'salida', 'ventana', 'tabique', 'columna', 'obstaculo', 'toma-corriente', 'cuadro', 'espejo']);
const DECOR = new Set(['cubierto', 'bajoplato', 'copa', 'vela', 'candelabro', 'centro-alto', 'centro-bajo', 'numero-mesa', 'menu-carta', 'camino-mesa']);

/** Mueble que hay en el punto (x, z) de la sala (si se solapan, aquel a cuyo centro se apunta). */
export function itemAt(items: Item[], custom: CatalogDef[], x: number, z: number): Item | null {
  let best: Item | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (FIXED.has(it.type) || DECOR.has(it.type)) continue;
    const def = findDef(it.type, custom);
    const d = itemDims(it, def);
    // Las mesas con sillas ocupan más: se puede coger también por las sillas
    const extra = def?.chairs && (it.chairs ?? def.chairs) > 0 ? 0.55 : 0.1;
    const r = (-it.rot * Math.PI) / 180;
    const dx = x - it.x;
    const dz = z - it.z;
    const lx = dx * Math.cos(r) + dz * Math.sin(r);
    const lz = -dx * Math.sin(r) + dz * Math.cos(r);
    if (Math.abs(lx) <= d.w / 2 + extra && Math.abs(lz) <= d.d / 2 + extra) {
      // Si se solapan, el que tiene el centro más cerca (en proporción a su tamaño)
      const score = Math.hypot(dx, dz) / Math.max(0.3, Math.max(d.w, d.d));
      if (score < bestScore) {
        best = it;
        bestScore = score;
      }
    }
  }
  return best;
}
