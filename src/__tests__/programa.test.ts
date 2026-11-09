import { describe, expect, it } from 'vitest';
import { buildProgram, changeovers, phaseWarnings, EVENT_KINDS } from '../lib/program';
import { item, project, space } from './helpers';

const sala = () => project(space(24, 16), [item('puerta', 0, 8, { rot: Math.PI }), item('salida', 11, 8, { rot: Math.PI })]);

describe('programa del evento por fases', () => {
  it('crea las fases del congreso con su montaje y la arquitectura en cada una', () => {
    const p = sala();
    const { program, variants } = buildProgram(p, 'congreso', 150, '09:00');
    expect(program.phases.length).toBe(EVENT_KINDS.congreso.steps.length);
    expect(program.phases[0].start).toBe('09:00');
    expect(program.phases[1].start).toBe('09:45');
    const inaug = variants[0];
    expect(inaug.layout).toBe('teatro');
    expect(inaug.items.some((i) => i.type === 'mesa-escuela' && i.rot === 180)).toBe(true); // presidencia
    expect(inaug.items.filter((i) => i.type === 'puerta').length).toBe(1);
    // Plenaria: se retira la presidencia y se mantiene el resto
    const plen = variants[1];
    expect(plen.items.some((i) => i.type === 'mesa-escuela')).toBe(false);
    expect(plen.items.filter((i) => i.type.startsWith('silla')).length).toBe(inaug.items.filter((i) => i.type.startsWith('silla')).length);
    // Cena de gala en banquete con escenario
    const gala = variants[variants.length - 1];
    expect(gala.layout).toBe('banquete');
    expect(gala.items.some((i) => i.type === 'escenario')).toBe(true);
  });

  it('calcula el cambio de montaje y avisa si no da tiempo', () => {
    const p = sala();
    const { program, variants } = buildProgram(p, 'congreso', 150, '09:00', 6);
    const proj = { ...p, program, variants, activeVariant: variants[0].id, items: variants[0].items, event: { ...p.event, pax: 150 } };
    const cos = changeovers(proj);
    // Inauguración → plenaria: retirar la presidencia, cambio pequeño en 0 min disponibles
    const first = cos[0];
    expect(first.removed.some((r) => r.type === 'mesa-escuela')).toBe(true);
    expect(first.added.length).toBe(0);
    // Clausura (teatro) → cena de gala (banquete): cambio grande, con los asistentes fuera
    const last = cos[cos.length - 1];
    expect(last.guestsOut).toBe(true);
    expect(last.added.some((r) => r.type.startsWith('mesa-redonda'))).toBe(true);
    expect(last.minutes).toBeGreaterThan(20);
    // Con 1 persona de personal no da tiempo
    const slow = changeovers({ ...proj, program: { ...program, staff: 1 } });
    expect(slow[slow.length - 1].ok).toBe(false);
    expect(phaseWarnings(proj).length).toBe(0);
  });

  it('avisa si una fase no tiene asientos para todos', () => {
    const p = { ...project(space(8, 6)), event: { ...sala().event, pax: 500 } };
    const { program, variants } = buildProgram(p, 'gala', 500);
    const proj = { ...p, program, variants, activeVariant: variants[0].id, items: variants[0].items };
    expect(phaseWarnings(proj).length).toBeGreaterThan(0);
  });
});
