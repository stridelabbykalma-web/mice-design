// Editar el montaje desde las gafas: lógica sin 3D (paleta, a qué mueble se apunta).
import type { CatalogDef } from '../types';
import { findDef, itemDims } from '../catalog';
import type { Item } from '../types';

/**
 * Panel de muebles de las gafas: pestañas por tipo, una cuadrícula de 4 × 2 muebles y una fila
 * de acciones. Se arrastra un mueble del panel a la sala para ponerlo.
 */
export const XR_TABS: { id: string; label: string; types: string[] }[] = [
  { id: 'mesas', label: 'Mesas', types: ['mesa-redonda-180', 'mesa-redonda-150', 'mesa-imperial', 'mesa-escuela', 'mesa-coctel', 'buffet', 'barra'] },
  { id: 'asientos', label: 'Asientos', types: ['silla', 'silla-conferencia', 'sofa', 'butaca'] },
  { id: 'escenario', label: 'Escenario', types: ['escenario', 'atril', 'pantalla', 'pista-baile'] },
  { id: 'deco', label: 'Decoración', types: ['planta', 'photocall', 'alfombra', 'uplight', 'foco', 'totem', 'atril-bienvenida'] },
];

/** Pestañas del panel; la del hotel solo si tiene muebles propios (escaneados o importados). */
export function xrTabs(custom: CatalogDef[]) {
  const own = custom.filter((d) => d.category !== 'mesa-deco' && d.category !== 'arquitectura').slice(0, PANEL_COLS * PANEL_ROWS);
  return own.length ? [...XR_TABS, { id: 'hotel', label: 'Del hotel', types: own.map((d) => d.type) }] : XR_TABS;
}

export const XR_ACTIONS = [
  { id: 'deshacer', label: '↶ Deshacer' },
  { id: 'recolocar', label: 'Recolocar sala' },
  { id: 'cerrar', label: 'Cerrar panel' },
] as const;
export type XrAction = (typeof XR_ACTIONS)[number]['id'];

export const PANEL_COLS = 4;
export const PANEL_ROWS = 2;
/** Alto relativo de cada banda del panel: pestañas, cuadrícula y acciones. */
export const PANEL_BANDS = { tabs: 0.14, grid: 0.7, actions: 0.16 };

export type PanelHit = { kind: 'tab'; index: number } | { kind: 'item'; type: string } | { kind: 'action'; id: XrAction } | null;

/** Qué hay en el punto (u, v) del panel (0..1, v = 0 abajo como en three.js). */
export function panelHit(u: number, v: number, tabs: { types: string[] }[], tab: number): PanelHit {
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const y = 1 - v;
  if (y < PANEL_BANDS.tabs) return { kind: 'tab', index: Math.min(tabs.length - 1, Math.floor(u * tabs.length)) };
  if (y < PANEL_BANDS.tabs + PANEL_BANDS.grid) {
    const row = Math.min(PANEL_ROWS - 1, Math.floor(((y - PANEL_BANDS.tabs) / PANEL_BANDS.grid) * PANEL_ROWS));
    const col = Math.min(PANEL_COLS - 1, Math.floor(u * PANEL_COLS));
    const type = tabs[tab]?.types[row * PANEL_COLS + col];
    return type ? { kind: 'item', type } : null;
  }
  return { kind: 'action', id: XR_ACTIONS[Math.min(XR_ACTIONS.length - 1, Math.floor(u * XR_ACTIONS.length))].id };
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
