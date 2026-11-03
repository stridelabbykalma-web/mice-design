// Mesas y su decoración: qué piezas están apoyadas en cada mesa, dónde se sienta cada
// comensal, y cómo guardar y aplicar una «mesa decorada» como plantilla.

import type { CatalogDef, Item, Project, TableTemplate, TemplateDecor } from '../types';
import { findDef, isRoundTable, itemDims, rectChairLayout } from '../catalog';
import { DEG, toWorld } from './geometry';
import { uid } from './db';

export const isTableDef = (d?: CatalogDef) => !!d && d.chairs !== undefined && (d.category === 'mesas' || d.category === 'hotel');
export const isDecorDef = (d?: CatalogDef) => !!d && (d.category === 'mesa-deco' || !!d.onTable);

function isRound(item: Item, def?: CatalogDef) {
  if (isRoundTable(item.type)) return true;
  const { w, d } = itemDims(item, def);
  return !!def?.modelAssetId && Math.abs(w - d) < 0.01;
}

/** Coordenadas locales de un punto respecto a un elemento (sin giro). */
export function toLocal(item: Item, x: number, z: number) {
  const t = -item.rot * DEG;
  const dx = x - item.x;
  const dz = z - item.z;
  return { x: dx * Math.cos(t) + dz * Math.sin(t), z: -dx * Math.sin(t) + dz * Math.cos(t) };
}

/** ¿Está el punto (x, z) sobre el tablero de la mesa? */
export function onTableTop(table: Item, def: CatalogDef | undefined, x: number, z: number) {
  const { w, d } = itemDims(table, def);
  const l = toLocal(table, x, z);
  if (isRound(table, def)) return Math.hypot(l.x, l.z) <= w / 2;
  return Math.abs(l.x) <= w / 2 && Math.abs(l.z) <= d / 2;
}

/** Mesa sobre la que cae un punto, si la hay. */
export function tableAt(project: Project, x: number, z: number): Item | undefined {
  for (const it of project.items) {
    const def = findDef(it.type, project.customCatalog);
    if (isTableDef(def) && onTableTop(it, def, x, z)) return it;
  }
  return undefined;
}

/** Piezas de decoración apoyadas en una mesa. */
export function attachedDecor(project: Project, table: Item): Item[] {
  const tdef = findDef(table.type, project.customCatalog);
  return project.items.filter((it) => it.id !== table.id && isDecorDef(findDef(it.type, project.customCatalog)) && onTableTop(table, tdef, it.x, it.z));
}

/**
 * Posición de cada comensal sobre el tablero (donde va su cubierto), en coordenadas locales
 * de la mesa. rot orienta la pieza con el comensal en +Z local. Coincide con el reparto de
 * sillas con el que se dibuja la mesa.
 */
export function seatSettings(table: Item, def?: CatalogDef): { x: number; z: number; rot: number }[] {
  const { w, d } = itemDims(table, def);
  const chairs = table.chairs ?? def?.chairs ?? 0;
  if (!chairs) return [];
  if (isRound(table, def)) {
    const r = w / 2 - 0.2;
    return Array.from({ length: chairs }, (_, i) => {
      const a = (i / chairs) * Math.PI * 2;
      return { x: Math.sin(a) * r, z: Math.cos(a) * r, rot: (a * 180) / Math.PI };
    });
  }
  const lay = rectChairLayout(table.type, w, d, chairs);
  const out: { x: number; z: number; rot: number }[] = [];
  const row = (n: number, z: number, rot: number) => {
    for (let i = 0; i < n; i++) out.push({ x: -w / 2 + (w / n) * (i + 0.5), z, rot });
  };
  row(lay.back, d / 2 - 0.17, 0);
  row(lay.front, -d / 2 + 0.17, 180);
  if (lay.ends >= 1) out.push({ x: -w / 2 + 0.2, z: 0, rot: -90 });
  if (lay.ends >= 2) out.push({ x: w / 2 - 0.2, z: 0, rot: 90 });
  return out;
}

/** Cubiertos para todos los comensales de una mesa (en coordenadas del salón). */
export function placeSettingsFor(table: Item, def?: CatalogDef): Omit<Item, 'id'>[] {
  return seatSettings(table, def).map((s) => {
    const p = toWorld(table.x, table.z, table.rot, s.x, s.z);
    return { type: 'cubierto', x: round(p.x), z: round(p.z), rot: round(table.rot + s.rot) };
  });
}

const round = (v: number) => Math.round(v * 1000) / 1000;

/** Guarda una mesa con su decoración como plantilla reutilizable. */
export function makeTemplate(project: Project, table: Item): TableTemplate {
  const { id: _i, x: _x, z: _z, rot: _r, label: _l, ...base } = table;
  const decor: TemplateDecor[] = attachedDecor(project, table).map((it) => {
    const l = toLocal(table, it.x, it.z);
    const { id: _id, x: _ix, z: _iz, rot, ...rest } = it;
    return { ...rest, dx: round(l.x), dz: round(l.z), drot: round(rot - table.rot) };
  });
  const used = new Set([table.type, table.chairType ?? '', ...decor.map((d) => d.type)]);
  const defs = project.customCatalog.filter((c) => used.has(c.type));
  return { base, decor, defs };
}

/** Piezas de decoración de una plantilla colocadas sobre una mesa concreta. */
export function decorForTable(tpl: TableTemplate, table: Item): Item[] {
  return tpl.decor.map(({ dx, dz, drot, ...rest }) => {
    const p = toWorld(table.x, table.z, table.rot, dx, dz);
    return { ...rest, id: uid('i_'), x: round(p.x), z: round(p.z), rot: round(table.rot + drot) };
  });
}
