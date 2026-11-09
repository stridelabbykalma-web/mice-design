// Las salas de ejemplo como banco de pruebas: todos los montajes y todos los tipos de evento
// en salas pequeñas, alargadas, en L, con columnas, ochavadas y exteriores.
import { describe, expect, it } from 'vitest';
import { EXAMPLE_ROOMS, exampleProject } from '../lib/examples';
import { defaultOptions, generateLayout } from '../lib/layouts';
import { analyze, obbOf } from '../lib/safety';
import { findDef, itemCapacity } from '../catalog';
import { insideSpace } from '../lib/outline';
import { EVENT_KINDS, buildProgram, changeovers, phaseWarnings, type EventKind } from '../lib/program';
import { guestsFromCsv } from '../lib/guests';
import { newProject } from '../store';
import type { Item, LayoutType, Project } from '../types';

const TYPES: LayoutType[] = ['teatro', 'escuela', 'banquete', 'coctel', 'u', 'imperial'];
const WALL = new Set(['puerta', 'salida', 'ventana']);
const errors = (p: Project) => analyze(p).checks.filter((c) => c.severity === 'error').map((c) => c.title);
const outside = (p: Project, items: Item[]) =>
  items.filter((i) => !WALL.has(i.type) && !insideSpace(obbOf(i, findDef(i.type, [])), p.space, 0)).map((i) => i.type);

describe.each(EXAMPLE_ROOMS)('sala de ejemplo: $name', (ex) => {
  const { space, items } = ex.room();
  const base: Project = { ...newProject(space, 'x', ''), items };

  it('todos los montajes caben en la sala, sin errores de seguridad', () => {
    for (const t of TYPES)
      for (const pax of [0, 10, 60, 200])
        for (const stage of [false, true]) {
          const tag = `${t} · ${pax} personas · ${stage ? 'con' : 'sin'} escenario`;
          const r = generateLayout(base, { ...defaultOptions(t), pax, stage, screen: true });
          const gen = r.items.map((i, k) => ({ ...i, id: 'g' + k }) as Item);
          expect(gen.every((i) => Number.isFinite(i.x) && Number.isFinite(i.z)), tag).toBe(true);
          expect(r.pax, tag).toBeGreaterThan(0);
          const cap = gen.reduce((a, i) => a + itemCapacity(i, findDef(i.type, [])).seated + itemCapacity(i, findDef(i.type, [])).standing, 0);
          expect(cap, tag).toBe(r.pax);
          if (pax && r.pax < pax) expect(r.warning, tag).toBeTruthy();
          expect(outside(base, gen), tag).toEqual([]);
          expect(errors({ ...base, items: [...items, ...gen], event: { ...base.event, pax: r.pax, layout: t } }), tag).toEqual([]);
        }
  });

  it('todos los tipos de evento generan un programa válido', () => {
    for (const kind of Object.keys(EVENT_KINDS) as EventKind[]) {
      const { program, variants } = buildProgram(base, kind, ex.pax);
      expect(program.phases.length, kind).toBeGreaterThanOrEqual(3);
      // Las horas van en orden (ninguna fase empieza antes de que acabe la anterior)
      let t = -1;
      for (const ph of program.phases) {
        const [h, m] = ph.start.split(':').map(Number);
        let start = h * 60 + m;
        if (start < t - 720) start += 1440;
        expect(start, `${kind} · ${ph.name}`).toBeGreaterThanOrEqual(t);
        t = start + ph.minutes;
      }
      for (const v of variants) {
        expect(outside(base, v.items), `${kind} · ${v.name}`).toEqual([]);
        expect(errors({ ...base, items: v.items, event: { ...base.event, pax: ex.pax, layout: v.layout } }), `${kind} · ${v.name}`).toEqual([]);
      }
    }
  });

  it('el ejemplo se abre sin avisos en el programa', () => {
    const p = exampleProject(ex.id);
    expect(phaseWarnings(p).map((w) => w.text)).toEqual([]);
    expect(changeovers(p).filter((c) => !c.ok)).toEqual([]);
    for (const v of p.variants!) expect(analyze({ ...p, items: v.items, event: { ...p.event, layout: v.layout } }).checks.filter((c) => c.severity === 'error')).toEqual([]);
  });
});

describe('correcciones de la revisión', () => {
  it('la mesa de presidencia mira al público (girada 180°) y no cuenta como solape con el escenario', () => {
    const p = exampleProject('auditorio');
    const inaug = p.variants![0];
    const pres = inaug.items.filter((i) => i.type === 'mesa-escuela');
    expect(pres.length).toBeGreaterThan(0);
    expect(pres.every((i) => i.rot === 180)).toBe(true);
    expect(analyze({ ...p, items: inaug.items }).checks.find((c) => c.id === 'solapes')?.severity).toBe('ok');
  });

  it('un programa que pasa de medianoche no da tiempos negativos', () => {
    const ex = EXAMPLE_ROOMS.find((e) => e.id === 'ochavado')!;
    const { space, items } = ex.room();
    const base: Project = { ...newProject(space, 'x', ''), items, event: { ...newProject(space, 'x', '').event, pax: 80 } };
    const { program, variants } = buildProgram(base, 'boda', 80, '20:00');
    const cos = changeovers({ ...base, program, variants, activeVariant: variants[0].id, items: variants[0].items });
    expect(cos.every((c) => c.available > -60)).toBe(true);
  });

  it('una pared que atraviesa el mueble cuenta como fuera de la sala (sala en U)', async () => {
    const { presetOutline } = await import('../lib/outline');
    const sp = { ...EXAMPLE_ROOMS[0].room().space, width: 12, depth: 10, outline: presetOutline('U', 12, 10) };
    expect(insideSpace({ x: 0, z: 2.5, w: 6, d: 1, rot: 0 }, sp)).toBe(false);
    expect(insideSpace({ x: 0, z: -2.5, w: 6, d: 1, rot: 0 }, sp)).toBe(true);
  });

  it('CSV de invitados: «Surname, Name» y listas sin cabecera', () => {
    const p = exampleProject('ochavado');
    const a = guestsFromCsv('Surname,Name\nSmith,John', p).guests;
    expect(a.map((g) => g.name)).toEqual(['John Smith']);
    const b = guestsFromCsv('Ana Mesa\nLuis Pérez\nEva Ruiz', p).guests;
    expect(b.map((g) => g.name)).toEqual(['Ana Mesa', 'Luis Pérez', 'Eva Ruiz']);
  });

  it('una mesa rectangular no cuenta más sillas de las que caben', () => {
    const def = findDef('mesa-imperial', []);
    const cap = itemCapacity({ id: 'm', type: 'mesa-imperial', x: 0, z: 0, rot: 0, chairs: 12 }, def);
    expect(cap.seated).toBe(8);
  });
});
