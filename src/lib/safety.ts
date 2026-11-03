// Comprobaciones orientativas de aforo y evacuación inspiradas en el
// Código Técnico de la Edificación, DB-SI (Real Decreto 314/2006):
//  · SI 3, Tabla 2.1: densidades de ocupación.
//  · SI 3, Tabla 3.1: un recinto con una sola salida no puede superar 100 ocupantes
//    ni 25 m de recorrido de evacuación (50 m si dispone de más de una salida).
//  · SI 3, Tabla 4.1: anchura de puertas A ≥ P/200 ≥ 0,80 m, y se supone
//    inutilizada la salida de mayor anchura cuando hay más de una.
// No sustituye a un proyecto técnico ni a la licencia de actividad del hotel.

import type { CatalogDef, Item, LayoutType, Project } from '../types';
import { findDef, footprint, itemCapacity, itemDims } from '../catalog';
import { OBB, insideRoom, obbOverlap, toWorld } from './geometry';

export type Severity = 'ok' | 'aviso' | 'error';

export interface Check {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  itemIds?: string[];
}

export const DENSITY: Record<LayoutType | 'general', { m2: number; label: string }> = {
  teatro: { m2: 0.5, label: 'Espectadores sentados (sin asientos definidos en proyecto): 0,5 m²/persona' },
  escuela: { m2: 1, label: 'Salón de uso múltiple en hotel: 1 m²/persona' },
  u: { m2: 1, label: 'Salón de uso múltiple en hotel: 1 m²/persona' },
  imperial: { m2: 1, label: 'Salón de uso múltiple en hotel: 1 m²/persona' },
  banquete: { m2: 1.5, label: 'Público sentado en restaurantes: 1,5 m²/persona' },
  coctel: { m2: 1, label: 'Público de pie en bares, cafeterías, etc.: 1 m²/persona' },
  general: { m2: 1, label: 'Salón de uso múltiple en hotel: 1 m²/persona' },
};

const fmt = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

/** Elementos que pueden ir encima del escenario sin considerarse un solape. */
const ON_STAGE = new Set(['atril', 'pantalla', 'planta', 'foco', 'uplight', 'silla', 'silla-conferencia', 'butaca', 'sofa']);

const NON_BLOCKING = new Set(['cuadro', 'espejo', 'alfombra', 'pista-baile', 'uplight', 'toma-corriente', 'ventana', 'puerta', 'salida']);

export function obbOf(item: Item, def?: CatalogDef, withChairs = true): OBB {
  const f = withChairs ? footprint(item, def) : itemDims(item, def);
  return { x: item.x, z: item.z, w: f.w, d: f.d, rot: item.rot };
}

export function isExit(type: string) {
  return type === 'salida' || type === 'puerta';
}

/** Zona libre que debe quedar delante de una puerta o salida (1,2 m hacia el interior). */
export function exitClearance(item: Item, def?: CatalogDef, depth = 1.2): OBB {
  const { w, d } = itemDims(item, def);
  const c = toWorld(item.x, item.z, item.rot, 0, d / 2 + depth / 2);
  return { x: c.x, z: c.z, w: w + 0.2, d: depth, rot: item.rot };
}

export function capacitySummary(project: Project) {
  let seated = 0;
  let standing = 0;
  for (const it of project.items) {
    const c = itemCapacity(it, findDef(it.type, project.customCatalog));
    seated += c.seated;
    standing += c.standing;
  }
  return { seated, standing, total: seated + standing };
}

export function analyze(project: Project): { checks: Check[]; area: number; maxOccupancy: number; occupancy: number } {
  const { space, items, customCatalog, event } = project;
  const checks: Check[] = [];
  const area = space.width * space.depth;
  const density = DENSITY[(event.layout || 'general') as LayoutType | 'general'];
  const maxOccupancy = Math.floor(area / density.m2);
  const cap = capacitySummary(project);
  const occupancy = Math.max(cap.total, event.pax || 0);

  // 1. Aforo por densidad
  if (occupancy > maxOccupancy) {
    checks.push({
      id: 'aforo',
      severity: 'error',
      title: `Aforo superado: ${occupancy} personas para ${maxOccupancy} máx.`,
      detail: `${fmt(area, 0)} m² · ${density.label}.`,
    });
  } else {
    checks.push({
      id: 'aforo',
      severity: occupancy > maxOccupancy * 0.9 ? 'aviso' : 'ok',
      title: `Aforo: ${occupancy} / ${maxOccupancy} personas`,
      detail: `${fmt(area, 0)} m² · ${density.label}.`,
    });
  }

  // 2. Salidas
  const exits = items.filter((i) => isExit(i.type));
  const emergency = items.filter((i) => i.type === 'salida');
  if (!exits.length) {
    checks.push({
      id: 'salidas',
      severity: space.outdoor ? 'aviso' : 'error',
      title: space.outdoor ? 'No hay accesos definidos en la zona' : 'No hay puertas ni salidas definidas',
      detail: space.outdoor
        ? 'Marca los accesos y vías de evacuación de la zona exterior (Elementos del espacio → Salida de emergencia).'
        : 'Añade las puertas y salidas de emergencia reales del espacio (Elementos del espacio).',
    });
  } else {
    if (occupancy > 100 && exits.length < 2) {
      checks.push({
        id: 'num-salidas',
        severity: 'error',
        title: 'Se necesitan al menos 2 salidas',
        detail: 'Con más de 100 ocupantes el recinto debe disponer de más de una salida (DB-SI 3, Tabla 3.1).',
      });
    }
    if (!emergency.length && !space.outdoor) {
      checks.push({
        id: 'senal',
        severity: 'aviso',
        title: 'Ninguna salida marcada como de emergencia',
        detail: 'Señaliza al menos una salida de emergencia para que aparezca en la orden de montaje.',
      });
    }
    const widths = exits.map((e) => itemDims(e, findDef(e.type, customCatalog)).w).sort((a, b) => b - a);
    const required = Math.max(0.8, occupancy / 200);
    const available = widths.length > 1 ? widths.slice(1).reduce((a, b) => a + b, 0) : widths[0];
    checks.push({
      id: 'anchura',
      severity: available + 1e-6 >= required ? 'ok' : 'error',
      title: `Anchura de salidas: ${fmt(available)} m disponibles / ${fmt(required)} m necesarios`,
      detail:
        widths.length > 1
          ? 'Calculado suponiendo inutilizada la salida más ancha (A ≥ P/200, DB-SI 3).'
          : 'A ≥ P/200 ≥ 0,80 m (DB-SI 3, Tabla 4.1).',
    });

    // 3. Recorrido de evacuación (aproximado en línea recta)
    const limit = exits.length > 1 ? 50 : 25;
    let worst = 0;
    let worstId = '';
    for (const it of items) {
      const c = itemCapacity(it, findDef(it.type, customCatalog));
      if (!c.seated && !c.standing) continue;
      const dmin = Math.min(...exits.map((e) => Math.hypot(e.x - it.x, e.z - it.z)));
      if (dmin > worst) {
        worst = dmin;
        worstId = it.id;
      }
    }
    if (worst > 0) {
      checks.push({
        id: 'recorrido',
        severity: worst * 1.25 > limit ? (worst > limit ? 'error' : 'aviso') : 'ok',
        title: `Recorrido de evacuación máx. ≈ ${fmt(worst, 1)} m (límite ${limit} m)`,
        detail: 'Distancia en línea recta desde el puesto más alejado hasta la salida más próxima; el recorrido real será mayor.',
        itemIds: worst > limit ? [worstId] : undefined,
      });
    }

    // 4. Salidas obstruidas
    const blocked: string[] = [];
    for (const ex of exits) {
      const zone = exitClearance(ex, findDef(ex.type, customCatalog));
      for (const it of items) {
        if (NON_BLOCKING.has(it.type)) continue;
        if (obbOverlap(zone, obbOf(it, findDef(it.type, customCatalog)))) blocked.push(it.id);
      }
    }
    if (blocked.length) {
      checks.push({
        id: 'obstruidas',
        severity: 'error',
        title: `${blocked.length} elemento(s) obstruyen puertas o salidas`,
        detail: 'Debe quedar libre al menos 1,2 m delante de cada puerta y salida.',
        itemIds: [...new Set(blocked)],
      });
    }
  }

  // 5. Solapes entre muebles
  const solid = items.filter((i) => !NON_BLOCKING.has(i.type));
  const overlapping = new Set<string>();
  for (let a = 0; a < solid.length; a++) {
    const A = solid[a];
    const oa = obbOf(A, findDef(A.type, customCatalog));
    for (let b = a + 1; b < solid.length; b++) {
      const B = solid[b];
      if ((A.type === 'escenario' && ON_STAGE.has(B.type)) || (B.type === 'escenario' && ON_STAGE.has(A.type))) continue;
      if (obbOverlap(oa, obbOf(B, findDef(B.type, customCatalog)), 0.05)) {
        overlapping.add(A.id);
        overlapping.add(B.id);
      }
    }
  }
  checks.push(
    overlapping.size
      ? {
          id: 'solapes',
          severity: 'aviso',
          title: `${overlapping.size} elementos se solapan`,
          detail: 'Revisa la separación entre mesas, sillas y columnas (se marcan en rojo).',
          itemIds: [...overlapping],
        }
      : { id: 'solapes', severity: 'ok', title: 'Sin solapes entre elementos', detail: 'Ningún mueble invade a otro.' },
  );

  // 6. Fuera del recinto
  if (!space.outdoor) {
    const outside = items.filter(
      (i) => !findDef(i.type, customCatalog)?.wallMount && !insideRoom(obbOf(i, findDef(i.type, customCatalog), false), space.width, space.depth),
    );
    if (outside.length) {
      checks.push({
        id: 'fuera',
        severity: 'aviso',
        title: `${outside.length} elemento(s) fuera de los límites del espacio`,
        detail: 'Sobresalen de las paredes del salón.',
        itemIds: outside.map((i) => i.id),
      });
    }
  }

  return { checks, area, maxOccupancy, occupancy };
}

export function problemItemIds(checks: Check[]): Set<string> {
  const s = new Set<string>();
  checks.forEach((c) => c.severity !== 'ok' && c.itemIds?.forEach((id) => s.add(id)));
  return s;
}
