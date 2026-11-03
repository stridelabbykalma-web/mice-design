// Plano de mesas: invitados, importación CSV, asignación automática y exportación.

import type { Guest, Item, Project } from '../types';
import { findDef } from '../catalog';
import { isTableDef } from './tables';
import { uid } from './db';

/** Mesas de la propuesta actual, ordenadas por su número. */
export function seatingTables(project: Project): Item[] {
  const num = (t: Item) => parseInt((t.label ?? '').replace(/\D+/g, '')) || 9999;
  return project.items.filter((i) => isTableDef(findDef(i.type, project.customCatalog))).sort((a, b) => num(a) - num(b));
}

export function tableCapacity(project: Project, t: Item) {
  return t.chairs ?? findDef(t.type, project.customCatalog)?.chairs ?? 0;
}

/** Lee un CSV (separado por ; , o tabulador, con comillas) y devuelve las filas. */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const first = clean.split(/\r?\n/)[0] ?? '';
  const sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (q) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      row.push(cell.trim());
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();

/**
 * Convierte un CSV de invitados. Reconoce cabeceras en español o inglés (nombre, apellidos,
 * grupo/empresa/familia, mesa, dieta/alergias, notas); sin cabecera, la 1.ª columna es el nombre.
 */
export function guestsFromCsv(text: string, project: Project): { guests: Guest[]; withTable: number } {
  const rows = parseCsv(text);
  if (!rows.length) return { guests: [], withTable: 0 };
  const h = rows[0].map(norm);
  const find = (...keys: string[]) => h.findIndex((c) => keys.some((k) => c.includes(k)));
  let iName = find('nombre', 'name', 'invitado', 'guest');
  const iSurname = find('apellido', 'surname', 'last name');
  const iGroup = find('grupo', 'empresa', 'familia', 'group', 'company');
  const iTable = find('mesa', 'table');
  const iDiet = find('dieta', 'alergia', 'diet', 'allerg', 'menu');
  const iNotes = find('nota', 'observ', 'note');
  const hasHeader = [iName, iGroup, iTable, iDiet].some((i) => i >= 0);
  if (iName < 0) iName = 0;
  const data = hasHeader ? rows.slice(1) : rows;
  const tables = seatingTables(project);
  const byName = (v: string) => {
    const n = norm(v);
    if (!n) return undefined;
    const digits = n.replace(/\D+/g, '');
    return tables.find((t) => norm(t.label ?? '') === n || (digits && (t.label ?? '').replace(/\D+/g, '') === digits))?.id;
  };
  let withTable = 0;
  const guests = data
    .map((r) => {
      const name = [r[iName], iSurname >= 0 ? r[iSurname] : ''].filter(Boolean).join(' ').trim();
      if (!name) return null;
      const tableId = iTable >= 0 ? byName(r[iTable] ?? '') : undefined;
      if (tableId) withTable++;
      const g: Guest = { id: uid('g_'), name };
      if (iGroup >= 0 && r[iGroup]) g.group = r[iGroup];
      if (iDiet >= 0 && r[iDiet]) g.diet = r[iDiet];
      if (iNotes >= 0 && r[iNotes]) g.notes = r[iNotes];
      if (tableId) g.tableId = tableId;
      return g;
    })
    .filter((g): g is Guest => !!g);
  return { guests, withTable };
}

/**
 * Asigna mesa a los invitados que no la tienen. Mantiene juntos a los del mismo grupo
 * (los grupos grandes primero) y respeta la capacidad de cada mesa; si un grupo no cabe
 * en una mesa, se reparte en las mesas siguientes.
 */
export function autoAssign(project: Project, guests: Guest[]): Guest[] {
  const tables = seatingTables(project);
  const valid = new Set(tables.map((t) => t.id));
  const free = new Map(tables.map((t) => [t.id, tableCapacity(project, t)]));
  const out = guests.map((g) => (g.tableId && valid.has(g.tableId) ? g : { ...g, tableId: undefined }));
  out.forEach((g) => g.tableId && free.set(g.tableId, (free.get(g.tableId) ?? 0) - 1));
  const pending = out.filter((g) => !g.tableId);
  const groups = new Map<string, Guest[]>();
  pending.forEach((g) => {
    const k = g.group?.trim() || `__${g.id}`;
    groups.set(k, [...(groups.get(k) ?? []), g]);
  });
  const ordered = [...groups.values()].sort((a, b) => b.length - a.length);
  const seat = (g: Guest, tableId: string) => {
    g.tableId = tableId;
    free.set(tableId, (free.get(tableId) ?? 0) - 1);
  };
  for (const grp of ordered) {
    let rest = [...grp];
    // 1. Completar las mesas donde ya se sientan compañeros del mismo grupo
    const key = grp[0].group?.trim();
    if (key) {
      const mates = new Set(out.filter((g) => g.group?.trim() === key && g.tableId).map((g) => g.tableId!));
      for (const tid of [...mates].sort((a, b) => (free.get(b) ?? 0) - (free.get(a) ?? 0)))
        while (rest.length && (free.get(tid) ?? 0) > 0) seat(rest.shift()!, tid);
    }
    if (!rest.length) continue;
    // 2. Una mesa donde quepa el resto del grupo entero (la más ajustada)
    const fit = tables.filter((t) => (free.get(t.id) ?? 0) >= rest.length).sort((a, b) => (free.get(a.id) ?? 0) - (free.get(b.id) ?? 0))[0];
    if (fit) {
      rest.forEach((g) => seat(g, fit.id));
      continue;
    }
    // 3. Repartirlo en el menor número de mesas: primero las más libres
    for (const t of [...tables].sort((a, b) => (free.get(b.id) ?? 0) - (free.get(a.id) ?? 0))) {
      while (rest.length && (free.get(t.id) ?? 0) > 0) seat(rest.shift()!, t.id);
      if (!rest.length) break;
    }
    rest = [];
  }
  return out;
}

/** Resumen de dietas y alergias para cocina. */
export function dietSummary(guests: Guest[]) {
  const m = new Map<string, number>();
  guests.forEach((g) => {
    const d = g.diet?.trim();
    if (d) m.set(d, (m.get(d) ?? 0) + 1);
  });
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export function seatingCsv(project: Project): string {
  const guests = project.guests ?? [];
  const tables = seatingTables(project);
  const label = new Map(tables.map((t) => [t.id, t.label ?? 'Mesa']));
  const esc = (v: string) => `"${(v ?? '').replace(/"/g, '""')}"`;
  const rows = [...guests]
    .sort((a, b) => (label.get(a.tableId ?? '') ?? 'zzz').localeCompare(label.get(b.tableId ?? '') ?? 'zzz', 'es', { numeric: true }) || a.name.localeCompare(b.name, 'es'))
    .map((g) => [label.get(g.tableId ?? '') ?? 'Sin mesa', g.name, g.group ?? '', g.diet ?? '', g.notes ?? ''].map(esc).join(';'));
  return '﻿' + ['Mesa;Nombre;Grupo;Dieta o alergias;Notas', ...rows].join('\n');
}
