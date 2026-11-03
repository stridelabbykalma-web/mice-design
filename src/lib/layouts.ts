// Generadores automáticos de montajes estándar (teatro, escuela, banquete, cóctel, U, imperial).
// Colocan el mobiliario dentro del espacio respetando márgenes, pasillos, columnas,
// tabiques y la zona libre delante de puertas y salidas.

import type { Item, LayoutType, Project } from '../types';
import { findDef, footprint, itemDims } from '../catalog';
import { OBB, insideRoom, obbOverlap } from './geometry';
import { exitClearance, isExit } from './safety';

export interface LayoutOptions {
  type: LayoutType;
  /** Personas objetivo; 0 = el máximo que quepa. */
  pax: number;
  margin: number;
  aisle: number;
  stage: boolean;
  screen: boolean;
  tableType: string;
  chairType: string;
  /** Banquete: filas al tresbolillo. */
  staggered: boolean;
}

export const LAYOUT_INFO: Record<LayoutType, { name: string; description: string }> = {
  teatro: { name: 'Teatro', description: 'Filas de sillas orientadas al escenario. Máxima capacidad para ponencias.' },
  escuela: { name: 'Escuela', description: 'Mesas y sillas en filas, para formaciones y talleres.' },
  banquete: { name: 'Banquete', description: 'Mesas redondas para comidas, cenas de gala y bodas.' },
  coctel: { name: 'Cóctel', description: 'Mesas altas sin asientos, público de pie.' },
  u: { name: 'En U', description: 'Mesas en forma de U abierta hacia la pantalla, para reuniones de trabajo.' },
  imperial: { name: 'Imperial', description: 'Gran mesa rectangular con sillas alrededor, para comités y cenas de dirección.' },
};

export function defaultOptions(type: LayoutType): LayoutOptions {
  return {
    type,
    pax: 0,
    margin: 1.2,
    aisle: 1.2,
    stage: type === 'teatro',
    screen: type === 'teatro' || type === 'escuela' || type === 'u',
    tableType:
      type === 'banquete' ? 'mesa-redonda-180' : type === 'escuela' || type === 'u' ? 'mesa-escuela' : type === 'imperial' ? 'mesa-imperial' : 'mesa-coctel',
    chairType: type === 'banquete' || type === 'imperial' ? 'silla' : 'silla-conferencia',
    staggered: true,
  };
}

type NewItem = Omit<Item, 'id'>;

/** Tipos que el generador sustituye al aplicar un montaje nuevo. */
export function generatedTypes(project: Project): string[] {
  const types = new Set<string>();
  [...project.items].forEach((i) => {
    const def = findDef(i.type, project.customCatalog);
    if (def && def.category !== 'arquitectura') types.add(i.type);
  });
  return [...types];
}

export function generateLayout(project: Project, o: LayoutOptions): { items: NewItem[]; pax: number; warning?: string } {
  const { space, customCatalog } = project;
  const W = space.width;
  const D = space.depth;
  const def = (t: string) => findDef(t, customCatalog);

  // Obstáculos fijos: columnas, tabiques y la zona libre delante de las salidas.
  const obstacles: OBB[] = [];
  for (const it of project.items) {
    const d = def(it.type);
    if (!d || d.category !== 'arquitectura') continue;
    if (isExit(it.type)) obstacles.push(exitClearance(it, d, 1.5));
    else if (it.type === 'columna' || it.type === 'tabique') {
      const dims = itemDims(it, d);
      obstacles.push({ x: it.x, z: it.z, w: dims.w + 0.3, d: dims.d + 0.3, rot: it.rot });
    }
  }

  const out: NewItem[] = [];
  let front = -D / 2 + o.margin; // borde delantero útil (z)

  // Escenario / pantalla en el frente (pared norte, z negativa)
  if (o.type !== 'banquete' && o.type !== 'coctel' && o.type !== 'imperial') {
    if (o.stage) {
      const sw = Math.min(8, Math.max(3, W * 0.4));
      const sd = D > 14 ? 3 : 2.4;
      const st: NewItem = { type: 'escenario', x: 0, z: -D / 2 + 0.45 + sd / 2, rot: 0, w: sw, d: sd, h: 0.4 };
      out.push(st);
      obstacles.push({ x: st.x, z: st.z, w: sw, d: sd, rot: 0 });
      out.push({ type: 'atril', x: sw / 2 - 0.8, z: st.z + sd / 2 - 0.5, rot: 0 });
      front = -D / 2 + 0.45 + sd + 1.8;
      if (o.screen) out.push({ type: 'pantalla', x: 0, z: -D / 2 + 0.2, rot: 0, w: Math.min(6, sw * 0.7), h: Math.min(space.height - 0.3, 3) });
    } else if (o.screen) {
      out.push({ type: 'pantalla', x: 0, z: -D / 2 + 0.4, rot: 0, w: Math.min(4, W * 0.4), h: Math.min(space.height - 0.3, 2.6) });
      front = -D / 2 + 0.4 + 2.5;
    }
  }

  const fits = (b: OBB) => insideRoom(b, W, D, o.margin * 0.5) && !obstacles.some((ob) => obbOverlap(ob, b));
  const back = D / 2 - o.margin;
  const left = -W / 2 + o.margin;
  const right = W / 2 - o.margin;
  const target = o.pax > 0 ? o.pax : Infinity;
  let pax = 0;

  /** Coloca filas de N asientos por bloque con pasillos entre bloques. */
  const rows = (cellW: number, cellD: number, pitchZ: number, make: (x: number, z: number) => { item: NewItem; seats: number }) => {
    const usable = right - left;
    const maxPerBlock = o.type === 'teatro' ? 14 : 4; // asientos (o mesas) por bloque entre pasillos
    let blocks = 2;
    while (true) {
      const perBlock = Math.floor((usable - (blocks - 1) * o.aisle) / blocks / cellW);
      if (perBlock <= maxPerBlock || blocks > 8) break;
      blocks++;
    }
    const perBlock = Math.max(1, Math.floor((usable - (blocks - 1) * o.aisle) / blocks / cellW));
    const blockW = perBlock * cellW;
    const totalW = blocks * blockW + (blocks - 1) * o.aisle;
    const startX = -totalW / 2;
    for (let z = front + cellD / 2; z + cellD / 2 <= back + 1e-6 && pax < target; z += pitchZ) {
      for (let b = 0; b < blocks && pax < target; b++) {
        for (let k = 0; k < perBlock && pax < target; k++) {
          const x = startX + b * (blockW + o.aisle) + cellW * (k + 0.5);
          const { item, seats } = make(x, z);
          const fp = footprint(item as Item, def(item.type));
          if (!fits({ x, z, w: fp.w, d: fp.d, rot: item.rot })) continue;
          out.push(item);
          pax += seats;
        }
      }
    }
  };

  switch (o.type) {
    case 'teatro': {
      const cd = def(o.chairType);
      const cw = (cd?.w ?? 0.5) + 0.07;
      rows(cw, cd?.d ?? 0.5, Math.max(0.9, (cd?.d ?? 0.5) + 0.45), (x, z) => ({ item: { type: o.chairType, x, z, rot: 0 }, seats: 1 }));
      break;
    }
    case 'escuela': {
      const td = def(o.tableType);
      const tw = td?.w ?? 1.8;
      const tdp = td?.d ?? 0.5;
      const chairs = td?.chairs ?? Math.max(1, Math.floor(tw / 0.6));
      rows(tw + 0.05, tdp + 0.5, tdp + 0.5 + 0.7, (x, z) => ({
        item: { type: o.tableType, x, z: z - 0.25, rot: 0, chairs, chairType: o.chairType },
        seats: chairs,
      }));
      break;
    }
    case 'banquete': {
      const td = def(o.tableType);
      const chairs = td?.chairs ?? 10;
      const size = (td?.w ?? 1.8) + 1.0; // mesa + sillas
      const pitch = size + 0.9; // pasillo de servicio entre sillas
      const pitchZ = o.staggered ? pitch * 0.87 : pitch;
      const cand: { x: number; z: number }[] = [];
      let row = 0;
      for (let z = front + size / 2; z + size / 2 <= back + 1e-6; z += pitchZ, row++) {
        const shift = o.staggered && row % 2 ? pitch / 2 : 0;
        const n = Math.floor((right - left - size) / pitch) + 1;
        const total = (n - 1) * pitch;
        for (let k = 0; k < n; k++) {
          const x = -total / 2 + k * pitch + shift;
          if (x + size / 2 > right + 1e-6) continue;
          cand.push({ x, z });
        }
      }
      // Rellenamos de delante hacia atrás y del centro hacia los lados
      cand.sort((a, b) => a.z - b.z || Math.abs(a.x) - Math.abs(b.x));
      for (const c of cand) {
        if (pax >= target) break;
        if (!fits({ x: c.x, z: c.z, w: size, d: size, rot: 0 })) continue;
        out.push({ type: o.tableType, x: c.x, z: c.z, rot: 0, chairs, chairType: o.chairType, centerpiece: true });
        pax += chairs;
      }
      break;
    }
    case 'coctel': {
      const td = def(o.tableType);
      const per = td?.standing ?? 5;
      const pitch = 2.6;
      // Barra o buffet al fondo (se coloca primero para que las mesas lo respeten)
      const bar: NewItem = { type: 'buffet', x: 0, z: back - 0.4, rot: 180 };
      const barBox = { x: 0, z: bar.z, w: 2.4 + 2, d: 0.75 + 2, rot: 0 };
      if (fits({ ...barBox, w: 2.4, d: 0.75 })) {
        out.push(bar);
        obstacles.push(barBox);
      }
      const cand: { x: number; z: number }[] = [];
      for (let z = front + 0.8; z <= back - 0.3; z += pitch)
        for (let x = left + 0.8; x <= right - 0.3; x += pitch) cand.push({ x, z });
      for (const c of cand) {
        if (pax >= target) break;
        if (!fits({ x: c.x, z: c.z, w: 1.2, d: 1.2, rot: 0 })) continue;
        out.push({ type: o.tableType, x: c.x, z: c.z, rot: 0 });
        pax += per;
      }
      break;
    }
    case 'u': {
      const td = def(o.tableType);
      const tw = td?.w ?? 1.8;
      const tdp = td?.d ?? 0.5;
      const per = td?.chairs ?? 3;
      const maxBase = Math.max(1, Math.floor((right - left - 1.0) / tw));
      const maxArm = Math.max(1, Math.floor((back - front - 0.6) / tw));
      let nb = maxBase;
      let na = maxArm;
      if (Number.isFinite(target)) {
        // Proporción aproximada 1 (base) : 1,3 (brazos)
        const tables = Math.ceil(target / per);
        nb = Math.min(maxBase, Math.max(1, Math.round(tables / 3.6)));
        na = Math.min(maxArm, Math.max(1, Math.ceil((tables - nb) / 2)));
      }
      const baseW = nb * tw;
      const zBase = front + na * tw + tdp / 2;
      const xs = -baseW / 2 - tdp / 2;
      const tryPush = (it: NewItem) => {
        const fp = footprint(it as Item, def(it.type));
        if (!fits({ x: it.x, z: it.z, w: fp.w, d: fp.d, rot: it.rot })) return;
        out.push(it);
        pax += per;
      };
      for (let k = 0; k < nb; k++) tryPush({ type: o.tableType, x: -baseW / 2 + tw * (k + 0.5), z: zBase, rot: 0, chairs: per, chairType: o.chairType });
      for (let k = 0; k < na; k++) {
        const z = zBase - tdp / 2 - tw * (k + 0.5);
        tryPush({ type: o.tableType, x: xs, z, rot: -90, chairs: per, chairType: o.chairType });
        tryPush({ type: o.tableType, x: -xs, z, rot: 90, chairs: per, chairType: o.chairType });
      }
      break;
    }
    case 'imperial': {
      const td = def(o.tableType);
      const tw = td?.w ?? 1.8;
      const tdp = td?.d ?? 0.75;
      const per = td?.chairs ?? 6;
      const maxN = Math.max(1, Math.floor((right - left - 1.2) / tw));
      const lineGap = tdp + 1.0 + 1.6;
      const maxLines = Math.max(1, Math.floor((back - front) / lineGap));
      let n = maxN;
      let lines = maxLines;
      if (Number.isFinite(target)) {
        const tablesNeeded = Math.ceil(Math.max(0, target - 2) / per);
        lines = Math.min(maxLines, Math.max(1, Math.ceil(tablesNeeded / maxN)));
        n = Math.min(maxN, Math.max(1, Math.ceil(tablesNeeded / lines)));
      }
      const totalD = (lines - 1) * lineGap;
      for (let l = 0; l < lines; l++) {
        const z = (front + back) / 2 - totalD / 2 + l * lineGap;
        const len = n * tw;
        for (let k = 0; k < n; k++) {
          const it: NewItem = { type: o.tableType, x: -len / 2 + tw * (k + 0.5), z, rot: 0, chairs: per, chairType: o.chairType };
          const fp = footprint(it as Item, def(it.type));
          if (!fits({ x: it.x, z: it.z, w: fp.w - 0.1, d: fp.d, rot: 0 })) continue;
          out.push(it);
          pax += per;
        }
        // Presidencias en las cabeceras
        for (const [x, rot] of [
          [-len / 2 - 0.35, -90],
          [len / 2 + 0.35, 90],
        ]) {
          if (!fits({ x, z, w: 0.5, d: 0.5, rot: 0 })) continue;
          out.push({ type: o.chairType, x, z, rot });
          pax += 1;
        }
      }
      break;
    }
  }

  // Numeración natural de mesas: de delante hacia atrás y de izquierda a derecha.
  const tables = out.filter((i) => i.chairs !== undefined).sort((a, b) => (Math.abs(a.z - b.z) > 0.5 ? a.z - b.z : a.x - b.x));
  const rest = out.filter((i) => i.chairs === undefined);
  out.length = 0;
  out.push(...rest, ...tables);

  let warning: string | undefined;
  if (Number.isFinite(target) && pax < target) warning = `Solo caben ${pax} personas con este montaje y estos márgenes.`;
  return { items: out, pax, warning };
}
