import { describe, expect, it } from 'vitest';
import { defaultOptions, generateLayout } from '../lib/layouts';
import { analyze } from '../lib/safety';
import { findDef, footprint } from '../catalog';
import { obbOverlap } from '../lib/geometry';
import { insideSpace, presetOutline } from '../lib/outline';
import type { Item } from '../types';
import { item, project, space } from './helpers';

const asItems = (xs: Omit<Item, 'id'>[]): Item[] => xs.map((x, i) => ({ ...x, id: `g${i}` }));

describe('montajes automáticos', () => {
  it('banquete en 24 × 16 m: más de 200 personas, sin solapes y dentro de la sala', () => {
    const p = project(space(24, 16));
    const r = generateLayout(p, { ...defaultOptions('banquete'), pax: 0 });
    expect(r.pax).toBeGreaterThanOrEqual(200);
    const tables = asItems(r.items).filter((i) => i.type.startsWith('mesa'));
    const boxes = tables.map((t) => {
      const f = footprint(t, findDef(t.type, []));
      return { x: t.x, z: t.z, w: f.w, d: f.d, rot: 0 };
    });
    boxes.forEach((b) => expect(insideSpace(b, p.space)).toBe(true));
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) expect(obbOverlap(boxes[a], boxes[b])).toBe(false);
  });

  it('respeta el número de personas pedido en teatro', () => {
    const r = generateLayout(project(space(20, 14)), { ...defaultOptions('teatro'), pax: 120 });
    expect(r.pax).toBe(120);
    expect(r.items.filter((i) => i.type === 'silla-conferencia')).toHaveLength(120);
    expect(r.items.some((i) => i.type === 'escenario')).toBe(true);
  });

  it('no coloca mesas en el hueco de una sala en L', () => {
    const sp = space(18, 12, { outline: presetOutline('L', 18, 12) });
    const r = generateLayout(project(sp), { ...defaultOptions('banquete'), pax: 0 });
    expect(r.pax).toBeGreaterThan(0);
    asItems(r.items)
      .filter((i) => i.type.startsWith('mesa'))
      .forEach((t) => {
        const f = footprint(t, findDef(t.type, []));
        expect(insideSpace({ x: t.x, z: t.z, w: f.w, d: f.d, rot: 0 }, sp)).toBe(true);
      });
  });

  it('esquiva las columnas', () => {
    const col = item('columna', 0, 0);
    const p = project(space(16, 12), [col]);
    const r = generateLayout(p, { ...defaultOptions('banquete'), pax: 0 });
    asItems(r.items)
      .filter((i) => i.type.startsWith('mesa'))
      .forEach((t) => expect(Math.hypot(t.x, t.z)).toBeGreaterThan(1.4));
  });
});

describe('aforo y seguridad (CTE DB-SI)', () => {
  it('avisa si se supera el aforo por densidad', () => {
    const p = project(space(10, 10), [], { event: { name: '', client: '', date: '', time: '', pax: 120, layout: 'banquete', notes: '', pricePerPax: 0, roomPrice: 0 } });
    const r = analyze(p);
    expect(r.maxOccupancy).toBe(66); // 100 m² / 1,5 m² por persona
    expect(r.checks.find((c) => c.id === 'aforo')?.severity).toBe('error');
  });

  it('exige dos salidas con más de 100 ocupantes y anchura P/200', () => {
    const p = project(space(30, 20), [item('salida', 0, -9.94)], { event: { name: '', client: '', date: '', time: '', pax: 300, layout: 'teatro', notes: '', pricePerPax: 0, roomPrice: 0 } });
    const r = analyze(p);
    expect(r.checks.find((c) => c.id === 'num-salidas')?.severity).toBe('error');
    expect(r.checks.find((c) => c.id === 'anchura')?.severity).toBe('error'); // 1,2 m < 300/200
  });

  it('detecta muebles que obstruyen una salida', () => {
    const exit = item('salida', 0, -4.94);
    const table = item('mesa-redonda-180', 0, -4, { chairs: 10 });
    const r = analyze(project(space(10, 10), [exit, table]));
    const c = r.checks.find((x) => x.id === 'obstruidas');
    expect(c?.severity).toBe('error');
    expect(c?.itemIds).toContain(table.id);
  });
});
