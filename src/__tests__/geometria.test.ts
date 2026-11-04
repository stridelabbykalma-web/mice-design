import { describe, expect, it } from 'vitest';
import { obbOverlap, snapToWall, toWorld } from '../lib/geometry';
import { insideSpace, pointInPolygon, polygonArea, presetOutline, roomArea, snapToRoomWall } from '../lib/outline';
import { homography, planeMeter } from '../lib/perspective';
import { space } from './helpers';

describe('geometría en planta', () => {
  it('detecta solapes entre rectángulos girados', () => {
    expect(obbOverlap({ x: 0, z: 0, w: 2, d: 1, rot: 0 }, { x: 1.5, z: 0, w: 2, d: 1, rot: 0 })).toBe(true);
    expect(obbOverlap({ x: 0, z: 0, w: 2, d: 1, rot: 0 }, { x: 2.5, z: 0, w: 2, d: 1, rot: 0 })).toBe(false);
    // Girado 90°, el rectángulo largo deja de tocar al vecino
    expect(obbOverlap({ x: 0, z: 0, w: 4, d: 0.5, rot: 90 }, { x: 1.5, z: 0, w: 1, d: 1, rot: 0 })).toBe(false);
  });

  it('usa el mismo convenio de giro que three.js', () => {
    const p = toWorld(0, 0, 90, 0, 1); // +Z local girado 90° → +X
    expect(p.x).toBeCloseTo(1);
    expect(p.z).toBeCloseTo(0);
  });

  it('ancla puertas a la pared más cercana mirando al interior', () => {
    expect(snapToWall(0, -4.9, 10, 10, 0.12)).toEqual({ x: 0, z: -5 + 0.06, rot: 0 });
    expect(snapToWall(4.8, 0, 10, 10, 0.12).rot).toBe(-90);
  });
});

describe('salas con forma', () => {
  const L = presetOutline('L', 18, 12);
  const sp = space(18, 12, { outline: L });

  it('calcula la superficie real de una sala en L', () => {
    expect(polygonArea(L)).toBeCloseTo(18 * 12 - 9 * 6);
    expect(roomArea(sp)).toBeCloseTo(162);
    expect(roomArea(space(10, 5))).toBe(50);
  });

  it('sabe qué está dentro y qué cae en el hueco de la L', () => {
    expect(pointInPolygon({ x: -5, z: 3 }, L)).toBe(true);
    expect(pointInPolygon({ x: 5, z: 3 }, L)).toBe(false);
    expect(insideSpace({ x: -5, z: -3, w: 2, d: 2, rot: 0 }, sp)).toBe(true);
    expect(insideSpace({ x: 0.5, z: 0.5, w: 2, d: 2, rot: 0 }, sp)).toBe(false); // envuelve la esquina interior
    expect(insideSpace({ x: -8.5, z: -3, w: 2, d: 2, rot: 0 }, sp, 1)).toBe(false); // demasiado cerca de la pared
  });

  it('ancla a una pared diagonal mirando hacia dentro', () => {
    const tri = [
      { x: -5, z: -5 },
      { x: 5, z: -5 },
      { x: 5, z: 5 },
    ];
    const s = snapToRoomWall(0, 0.5, space(10, 10, { outline: tri }), 0.1);
    // Normal hacia dentro de la diagonal (5,5)→(-5,-5): hacia +X,−Z
    const nx = Math.sin((s.rot * Math.PI) / 180);
    const nz = Math.cos((s.rot * Math.PI) / 180);
    expect(nx).toBeGreaterThan(0.6);
    expect(nz).toBeLessThan(-0.6);
  });
});

describe('medición con foto (metrología plana)', () => {
  const wallToImg = homography(
    [
      { x: 0, y: 0 },
      { x: 16, y: 0 },
      { x: 16, y: 3.6 },
      { x: 0, y: 3.6 },
    ],
    [
      { x: 180, y: 140 },
      { x: 1450, y: 260 },
      { x: 1400, y: 820 },
      { x: 220, y: 930 },
    ],
  );
  it('mide una pared de 16 × 3,6 m a partir de un tramo de 4 m', () => {
    const ref = [
      [6, 0],
      [10, 0],
      [10, 3.6],
      [6, 3.6],
    ].map(([x, y]) => wallToImg(x, y));
    const d = planeMeter(ref, 4, 3.6);
    const c = [
      [0, 0],
      [16, 0],
      [16, 3.6],
      [0, 3.6],
    ].map(([x, y]) => wallToImg(x, y));
    expect(d(c[0], c[1])).toBeCloseTo(16, 3);
    expect(d(c[0], c[3])).toBeCloseTo(3.6, 3);
  });
});
