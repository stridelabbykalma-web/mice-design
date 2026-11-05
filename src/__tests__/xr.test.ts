import { describe, expect, it } from 'vitest';
import { alignFromCorners, frontCorners } from '../lib/xr';
import { presetOutline } from '../lib/outline';
import { space } from './helpers';

/** Aplica la transformación (convención de three.js) a un punto del modelo. */
const apply = (t: { rot: number; x: number; z: number }, p: { x: number; z: number }) => ({
  x: p.x * Math.cos(t.rot) + p.z * Math.sin(t.rot) + t.x,
  z: -p.x * Math.sin(t.rot) + p.z * Math.cos(t.rot) + t.z,
});

describe('alineación del montaje con la sala real (gafas)', () => {
  it('elige las dos esquinas del frente, de izquierda a derecha', () => {
    expect(frontCorners(space(16, 11))).toEqual([
      { x: -8, z: -5.5 },
      { x: 8, z: -5.5 },
    ]);
    const [l, r] = frontCorners(space(18, 12, { outline: presetOutline('L', 18, 12) }));
    expect(l.x).toBeLessThan(r.x);
    expect(l.z).toBeCloseTo(-6);
  });

  it('recupera el giro y la posición a partir de dos esquinas marcadas', () => {
    const [a, b] = frontCorners(space(16, 11));
    const truth = { rot: 0.7, x: 2.3, z: -1.1 };
    const A = apply(truth, a);
    const B = apply(truth, b);
    const t = alignFromCorners(a, b, A, B);
    expect(t.mismatch).toBeCloseTo(0);
    // Cualquier punto del modelo cae donde debe en la sala real
    const p = { x: 3, z: 4 };
    expect(apply(t, p).x).toBeCloseTo(apply(truth, p).x);
    expect(apply(t, p).z).toBeCloseTo(apply(truth, p).z);
  });

  it('avisa si la sala real no mide lo mismo que el modelo', () => {
    const t = alignFromCorners({ x: -8, z: 0 }, { x: 8, z: 0 }, { x: 0, z: 0 }, { x: 15.8, z: 0 });
    expect(t.mismatch).toBeCloseTo(-0.2);
  });
});
