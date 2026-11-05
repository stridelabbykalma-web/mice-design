import { describe, expect, it } from 'vitest';
import { projectToDxf } from '../lib/dxf';
import { item, project, space } from './helpers';

const count = (dxf: string, entity: string, layer: string) => {
  const lines = dxf.split('\n');
  let c = 0;
  for (let i = 0; i < lines.length - 2; i++) if (lines[i] === '0' && lines[i + 1] === entity && lines[i + 2] === '8' && lines[i + 3] === layer) c++;
  return c;
};

describe('plano DXF', () => {
  const p = project(space(20, 14), [
    item('mesa-redonda-180', 0, 0, { chairs: 10, label: 'Mesa 1' }),
    item('mesa-imperial', 5, 3, { chairs: 6, rot: 90 }),
    item('silla', -5, 4),
    item('salida', 9.94, 0, { rot: -90 }),
    item('cubierto', 0, 0.6),
  ]);
  const dxf = projectToDxf(p);

  it('es un DXF R12 completo', () => {
    expect(dxf.startsWith('0\nSECTION\n2\nHEADER')).toBe(true);
    expect(dxf.trimEnd().endsWith('0\nEOF')).toBe(true);
    expect(dxf).toContain('AC1009');
  });

  it('dibuja sala, mesas, sillas y salidas en sus capas', () => {
    expect(count(dxf, 'POLYLINE', 'SALA')).toBe(1);
    expect(count(dxf, 'CIRCLE', 'MESAS')).toBe(1);
    expect(count(dxf, 'POLYLINE', 'MESAS')).toBe(1);
    expect(count(dxf, 'POLYLINE', 'SILLAS')).toBe(10 + 6 + 1);
    expect(count(dxf, 'POLYLINE', 'ARQUITECTURA')).toBe(1);
    expect(dxf).toContain('Mesa 1');
    expect(dxf).toContain('SALIDA');
  });

  it('deja fuera la decoración de mesa y pone el frente arriba (y = −z)', () => {
    expect(dxf).not.toContain('cubierto');
    // La primera esquina del contorno (−10, −7) se escribe con y = 7
    expect(dxf).toMatch(/VERTEX\n8\nSALA\n10\n-10\n20\n7\n/);
  });
});
