import { describe, expect, it } from 'vitest';
import { checkAccessibility } from '../lib/accessibility';
import { analyze } from '../lib/safety';
import { item, project, space } from './helpers';

// Sala de 12 × 8 m con la puerta en el centro de la pared del fondo (z = +4), mirando al interior
const door = () => item('puerta', 0, 4 - 0.06, { rot: 180 });

describe('accesibilidad (silla de ruedas)', () => {
  it('con mesas separadas, todas tienen recorrido de 1,20 m', () => {
    const p = project(space(12, 8), [door(), item('mesa-redonda-180', -3, -1, { chairs: 10 }), item('mesa-redonda-180', 3, -1, { chairs: 10 })]);
    const r = checkAccessibility(p);
    expect(r.tables).toBe(2);
    expect(r.unreachable).toEqual([]);
    expect(analyze(p).checks.find((c) => c.id === 'accesible')?.severity).toBe('ok');
  });

  it('detecta la mesa del fondo cuando una fila de mesas corta el paso', () => {
    // Fila de mesas imperiales de pared a pared a z = 0 (con sillas a ambos lados)
    const row = [-5.1, -3.3, -1.5, 0.3, 2.1, 3.9, 5.1].map((x) => item('mesa-imperial', x, 0, { chairs: 6 }));
    const fondo = item('mesa-redonda-150', 0, -2.6, { chairs: 8 });
    const p = project(space(12, 8), [door(), ...row, fondo]);
    const r = checkAccessibility(p);
    expect(r.unreachable).toContain(fondo.id);
    const c = analyze(p).checks.find((x) => x.id === 'accesible');
    expect(c?.severity).toBe('aviso');
    expect(c?.itemIds).toContain(fondo.id);
  });

  it('avisa si una mesa ocupa el espacio de giro delante de la puerta', () => {
    const t = item('mesa-redonda-150', 0, 2.6, { chairs: 8 });
    const r = checkAccessibility(project(space(12, 8), [door(), t]));
    expect(r.doorBlockers).toContain(t.id);
  });

  it('sin puertas definidas no se comprueba', () => {
    expect(checkAccessibility(project(space(12, 8), [item('mesa-redonda-180', 0, 0, { chairs: 10 })])).hasDoor).toBe(false);
  });
});
