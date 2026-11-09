import { describe, expect, it } from 'vitest';
import { cornersToRoomPlan, fitModelToWalls, planesToRoomPlan, wallSegments, type ScanPlane } from '../lib/xrScan';
import { parseRoomPlan } from '../lib/roomplan';
import type { Space } from '../types';

// Sala real de 12 × 8 m, girada 30° y desplazada, como la detectarían las gafas.
const ANG = (30 * Math.PI) / 180;
const OFF = { x: 3, z: -5 };
const toWorld = (x: number, z: number) => ({ x: x * Math.cos(ANG) - z * Math.sin(ANG) + OFF.x, z: x * Math.sin(ANG) + z * Math.cos(ANG) + OFF.z });
const corners = [
  [-6, -4],
  [6, -4],
  [6, 4],
  [-6, 4],
].map(([x, z]) => toWorld(x, z));
const wall = (a: { x: number; z: number }, b: { x: number; z: number }, label = 'wall', y0 = 0, y1 = 3.5): ScanPlane => ({
  label,
  orientation: 'vertical',
  points: [
    { x: a.x, y: y0, z: a.z },
    { x: b.x, y: y0, z: b.z },
    { x: b.x, y: y1, z: b.z },
    { x: a.x, y: y1, z: a.z },
  ],
});
const planes: ScanPlane[] = [
  ...corners.map((a, i) => wall(a, corners[(i + 1) % 4])),
  { label: 'floor', orientation: 'horizontal', points: corners.map((c) => ({ ...c, y: 0 })) },
  { label: 'ceiling', orientation: 'horizontal', points: corners.map((c) => ({ ...c, y: 3.2 })) },
  // Puerta en la pared del fondo (z = +4 en la sala), a 3 m del centro
  wall(toWorld(2.5, 4), toWorld(3.5, 4), 'door', 0, 2.1),
];

const space = (w: number, d: number): Space =>
  ({ method: 'plano', name: '', width: w, depth: d, height: 3, outdoor: false, showWalls: true, floorColor: '', wallColor: '' }) as Space;

describe('medir la sala con las gafas', () => {
  it('convierte el escaneo en una sala con sus medidas, altura y puerta', () => {
    const r = parseRoomPlan(planesToRoomPlan(planes));
    expect(r.width).toBeCloseTo(12, 1);
    expect(r.depth).toBeCloseTo(8, 1);
    expect(r.height).toBeCloseTo(3.2, 1);
    expect(r.outline).toBeUndefined();
    expect(r.items.filter((i) => i.type === 'puerta')).toHaveLength(1);
  });

  it('el modelo queda justo encima de la sala real (frame)', () => {
    const r = parseRoomPlan(planesToRoomPlan(planes));
    // Una esquina del modelo llevada al mundo debe caer en una esquina real
    const rot = -r.frame.theta;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const m = { x: r.width / 2, z: r.depth / 2 };
    const w = { x: m.x * c + m.z * s + r.frame.x, z: -m.x * s + m.z * c + r.frame.z };
    const nearest = Math.min(...corners.map((k) => Math.hypot(k.x - w.x, k.z - w.z)));
    expect(nearest).toBeLessThan(0.02);
  });

  it('esquinas marcadas a mano: sala en L', () => {
    const L = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 4 },
      { x: 5, z: 4 },
      { x: 5, z: 8 },
      { x: 0, z: 8 },
    ];
    const r = parseRoomPlan(cornersToRoomPlan(L, 3));
    expect(r.width).toBeCloseTo(10, 1);
    expect(r.depth).toBeCloseTo(8, 1);
    expect(r.outline?.length).toBe(6);
  });

  it('encaja la sala del proyecto con las paredes detectadas, y las puertas deshacen la simetría', () => {
    const segs = wallSegments(planes);
    // Sin puertas, un rectángulo encaja igual girado 180°: ambiguo
    expect(fitModelToWalls(space(12, 8), segs)!.ambiguous).toBe(true);
    const fit = fitModelToWalls(space(12, 8), segs, { model: [{ x: 3, z: 4 }], world: [toWorld(3, 4)] })!;
    expect(fit.ambiguous).toBe(false);
    expect(fit.error).toBeLessThan(0.02);
    // La puerta del modelo cae en la real
    const c = Math.cos(fit.rot);
    const s = Math.sin(fit.rot);
    const w = { x: 3 * c + 4 * s + fit.x, z: -3 * s + 4 * c + fit.z };
    const real = toWorld(3, 4);
    expect(Math.hypot(w.x - real.x, w.z - real.z)).toBeLessThan(0.05);
  });

  it('una sala del plano que no coincide da error grande', () => {
    const fit = fitModelToWalls(space(20, 15), wallSegments(planes))!;
    expect(fit.error).toBeGreaterThan(0.25);
  });
});
