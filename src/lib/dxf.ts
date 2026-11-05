// Plano del montaje en DXF (AutoCAD R12, texto): el formato que usan técnicos de montaje,
// proveedores de mobiliario y estudios de arquitectura. Unidades en metros; el frente de la
// sala (escenario) queda arriba, como en la vista en planta (y = −z).

import type { Item, Project } from '../types';
import { findDef, itemDims } from '../catalog';
import { corners, toWorld } from './geometry';
import { roomOutline } from './outline';
import { tableChairPoses } from '../components/ChairInstances';
import { isDecorDef, isTableDef } from './tables';

type P = { x: number; z: number };

const LAYERS: [string, number][] = [
  ['SALA', 7], // blanco/negro
  ['ARQUITECTURA', 8], // gris
  ['MESAS', 5], // azul
  ['SILLAS', 3], // verde
  ['MOBILIARIO', 30], // naranja
  ['TEXTOS', 1], // rojo
];

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function projectToDxf(project: Project): string {
  const out: string[] = [];
  const add = (...pairs: (string | number)[]) => out.push(...pairs.map(String));
  // Cada punto del plano: x igual, y = −z (frente arriba)
  const poly = (layer: string, pts: P[], closed = true) => {
    add(0, 'POLYLINE', 8, layer, 66, 1, 70, closed ? 1 : 0, 10, 0, 20, 0, 30, 0);
    pts.forEach((p) => add(0, 'VERTEX', 8, layer, 10, n(p.x), 20, n(-p.z), 30, 0));
    add(0, 'SEQEND', 8, layer);
  };
  const circle = (layer: string, c: P, r: number) => add(0, 'CIRCLE', 8, layer, 10, n(c.x), 20, n(-c.z), 30, 0, 40, n(r));
  const text = (layer: string, c: P, h: number, s: string) =>
    add(0, 'TEXT', 8, layer, 10, n(c.x), 20, n(-c.z), 30, 0, 40, n(h), 1, s.replace(/\n/g, ' '), 72, 1, 73, 2, 11, n(c.x), 21, n(-c.z), 31, 0);
  const rect = (layer: string, cx: number, cz: number, w: number, d: number, rotDeg: number) => poly(layer, corners({ x: cx, z: cz, w, d, rot: rotDeg }));

  // Cabecera: unidades en metros ($INSUNITS = 6)
  add(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1009', 9, '$INSUNITS', 70, 6, 0, 'ENDSEC');
  add(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, LAYERS.length);
  LAYERS.forEach(([name, color]) => add(0, 'LAYER', 2, name, 70, 0, 62, color, 6, 'CONTINUOUS'));
  add(0, 'ENDTAB', 0, 'ENDSEC');
  add(0, 'SECTION', 2, 'ENTITIES');

  // Sala: contorno y cotas
  const outline = roomOutline(project.space);
  poly('SALA', outline);
  outline.forEach((a, i) => {
    const b = outline[(i + 1) % outline.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    text('TEXTOS', { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 }, 0.25, `${len.toFixed(2).replace('.', ',')} m`);
  });
  const minZ = Math.min(...outline.map((p) => p.z));
  text('TEXTOS', { x: 0, z: minZ - 0.8 }, 0.35, `FRENTE / ESCENARIO · ${project.space.name}`);

  for (const it of project.items) {
    const def = findDef(it.type, project.customCatalog);
    if (!def || isDecorDef(def)) continue; // cubiertos, velas… no van al plano técnico
    const { w, d } = itemDims(it, def);
    if (def.category === 'arquitectura') {
      rect('ARQUITECTURA', it.x, it.z, w, Math.max(d, 0.1), it.rot);
      if (it.type === 'salida') text('TEXTOS', { x: it.x, z: it.z }, 0.2, 'SALIDA');
      continue;
    }
    if (isTableDef(def)) {
      if (it.type.startsWith('mesa-redonda') || (def.modelAssetId && def.w === def.d)) circle('MESAS', it, w / 2);
      else rect('MESAS', it.x, it.z, w, d, it.rot);
      if (it.label) text('TEXTOS', it, 0.22, it.label);
      chairsOf(it, project).forEach((c) => rect('SILLAS', c.x, c.z, 0.45, 0.45, c.rot));
      continue;
    }
    rect(def.seats ? 'SILLAS' : 'MOBILIARIO', it.x, it.z, w, d, it.rot);
  }
  add(0, 'ENDSEC', 0, 'EOF');
  return out.join('\n') + '\n';
}

/** Sillas de una mesa en coordenadas de la sala. */
function chairsOf(table: Item, project: Project) {
  return tableChairPoses(table, findDef(table.type, project.customCatalog)).map((p) => {
    const w = toWorld(table.x, table.z, table.rot, p.x, p.z);
    return { x: w.x, z: w.z, rot: table.rot + (p.rot * 180) / Math.PI };
  });
}
