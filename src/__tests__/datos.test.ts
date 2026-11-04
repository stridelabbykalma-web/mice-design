import { describe, expect, it } from 'vitest';
import { autoAssign, guestsFromCsv, parseCsv } from '../lib/guests';
import { parseRoomPlan } from '../lib/roomplan';
import { decorForTable, makeTemplate, placeSettingsFor, seatSettings } from '../lib/tables';
import { findDef } from '../catalog';
import { polygonArea } from '../lib/outline';
import { item, project, space } from './helpers';

describe('invitados', () => {
  it('lee CSV con punto y coma, comillas y BOM', () => {
    const rows = parseCsv('﻿Nombre;Empresa\n"García; Ana";"Banco ""Sur"""\nLuis;Hotel');
    expect(rows).toEqual([
      ['Nombre', 'Empresa'],
      ['García; Ana', 'Banco "Sur"'],
      ['Luis', 'Hotel'],
    ]);
  });

  it('reconoce cabeceras y asigna la mesa indicada en el CSV', () => {
    const t1 = item('mesa-redonda-180', 0, 0, { chairs: 10, label: 'Mesa 1' });
    const p = project(space(10, 10), [t1]);
    const r = guestsFromCsv('Nombre,Apellidos,Grupo,Mesa,Alergias\nAna,López,Banco,1,Celíaco\nLuis,Ruiz,Banco,,', p);
    expect(r.guests.map((g) => g.name)).toEqual(['Ana López', 'Luis Ruiz']);
    expect(r.guests[0]).toMatchObject({ group: 'Banco', diet: 'Celíaco', tableId: t1.id });
    expect(r.withTable).toBe(1);
  });

  it('sienta juntos a los grupos y respeta la capacidad', () => {
    const tables = [1, 2, 3].map((n) => item('mesa-redonda-150', n * 3, 0, { chairs: 8, label: `Mesa ${n}` }));
    const p = project(space(12, 6), tables);
    const guests = [
      ...Array.from({ length: 6 }, (_, i) => ({ id: `a${i}`, name: `A${i}`, group: 'A' })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, name: `B${i}`, group: 'B' })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, group: 'C' })),
    ];
    const out = autoAssign(p, guests);
    for (const g of ['A', 'B', 'C']) expect(new Set(out.filter((x) => x.group === g).map((x) => x.tableId)).size).toBe(1);
    const per = new Map<string, number>();
    out.forEach((g) => per.set(g.tableId!, (per.get(g.tableId!) ?? 0) + 1));
    [...per.values()].forEach((n) => expect(n).toBeLessThanOrEqual(8));
  });
});

describe('mesas decoradas', () => {
  it('pone un cubierto por silla', () => {
    const t = item('mesa-redonda-180', 2, 3, { chairs: 10 });
    expect(seatSettings(t, findDef(t.type, []))).toHaveLength(10);
    expect(placeSettingsFor(t, findDef(t.type, []))).toHaveLength(10);
  });

  it('una plantilla conserva la decoración al aplicarla a una mesa girada', () => {
    const t = item('mesa-imperial', 0, 0, { chairs: 6 });
    const centro = item('centro-alto', 0.5, 0);
    const p = project(space(10, 10), [t, centro]);
    const tpl = makeTemplate(p, t);
    expect(tpl.decor).toHaveLength(1);
    const otra = { ...t, id: 'x', x: 4, z: 4, rot: 90 };
    const [d] = decorForTable(tpl, otra);
    expect(d.x).toBeCloseTo(4);
    expect(d.z).toBeCloseTo(3.5); // 0,5 m en X local girado 90° → −0,5 en Z
    expect(d.rot).toBe(90);
  });
});

describe('medición RoomPlan', () => {
  const surf = (x1: number, z1: number, x2: number, z2: number, h: number, cy: number) => {
    const A = (25 * Math.PI) / 180;
    const W = (x: number, z: number) => ({ x: 3 + x * Math.cos(A) - z * Math.sin(A), z: -2 + x * Math.sin(A) + z * Math.cos(A) });
    const a = W(x1, z1);
    const b = W(x2, z2);
    const L = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / L;
    const dz = (b.z - a.z) / L;
    return { dimensions: [L, h, 0], transform: [dx, 0, dz, 0, 0, 1, 0, 0, -dz, 0, dx, 0, (a.x + b.x) / 2, -1.3 + cy, (a.z + b.z) / 2, 1] };
  };
  it('endereza una sala girada y coloca la puerta en su pared', () => {
    const pts = [
      [-6, -4],
      [6, -4],
      [6, 4],
      [-6, 4],
    ];
    const walls = pts.map((p, i) => surf(p[0], p[1], pts[(i + 1) % 4][0], pts[(i + 1) % 4][1], 3.2, 1.6));
    const r = parseRoomPlan({ format: 'mice-roomplan', version: 1, walls, doors: [surf(-0.9, 4, 0.9, 4, 2.3, 1.15)] });
    expect(r.width).toBeCloseTo(12, 1);
    expect(r.depth).toBeCloseTo(8, 1);
    expect(r.height).toBeCloseTo(3.2, 2);
    expect(r.outline).toBeUndefined();
    const door = r.items.find((i) => i.type === 'puerta')!;
    expect(Math.abs(Math.abs(door.z) - 4)).toBeLessThan(0.1);
  });

  it('reconstruye el contorno de una sala en L', () => {
    const pts = [
      [-9, -6],
      [9, -6],
      [9, 1],
      [1, 1],
      [1, 6],
      [-9, 6],
    ];
    const walls = pts.map((p, i) => surf(p[0], p[1], pts[(i + 1) % 6][0], pts[(i + 1) % 6][1], 3, 1.5));
    const r = parseRoomPlan({ format: 'mice-roomplan', version: 1, walls: [walls[2], walls[0], walls[4], walls[1], walls[5], walls[3]] });
    expect(r.outline).toHaveLength(6);
    expect(polygonArea(r.outline!)).toBeCloseTo(176, 0);
  });

  it('rechaza archivos que no son de MICE Capture', () => {
    expect(() => parseRoomPlan({ hola: 1 })).toThrow();
  });
});
