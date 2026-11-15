import { describe, expect, it } from 'vitest';
import { cornersToRoomPlan, currentRoomPlanes, planeObstacles, fitModelToWalls, planesToRoomPlan, wallSegments, type ScanPlane } from '../lib/xrScan';
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

  it('con varias salas guardadas en las gafas, usa solo aquella en la que se está', () => {
    // Sala contigua de 6 × 5 m pegada a la pared este de la sala principal (12 × 8 m)
    const c2 = [
      [6.2, -2.5],
      [12.2, -2.5],
      [12.2, 2.5],
      [6.2, 2.5],
    ].map(([x, z]) => toWorld(x, z));
    const second: ScanPlane[] = [
      ...c2.map((a, i) => wall(a, c2[(i + 1) % 4])),
      { label: 'floor', orientation: 'horizontal', points: c2.map((c) => ({ ...c, y: 0 })) },
      { label: 'ceiling', orientation: 'horizontal', points: c2.map((c) => ({ ...c, y: 2.6 })) },
    ];
    const all = [...planes, ...second];
    // Mezcladas dan una sala que no existe
    expect(parseRoomPlan(planesToRoomPlan(all)).width).toBeGreaterThan(15);
    // Estando en la principal
    const a = parseRoomPlan(planesToRoomPlan(currentRoomPlanes(all, toWorld(1, 1))));
    expect([a.width, a.depth]).toEqual([12, 8]);
    expect(a.height).toBeCloseTo(3.2, 1);
    expect(a.items.filter((i) => i.type === 'puerta')).toHaveLength(1);
    // Estando en la contigua
    const b = parseRoomPlan(planesToRoomPlan(currentRoomPlanes(all, toWorld(9, 0))));
    expect([b.width, b.depth]).toEqual([6, 5]);
    expect(b.height).toBeCloseTo(2.6, 1);
    // Sin planos de suelo: las paredes que se ven desde donde se está
    const noFloor = all.filter((p) => p.label !== 'floor');
    const c = parseRoomPlan(planesToRoomPlan(currentRoomPlanes(noFloor, toWorld(9, 0))));
    expect([c.width, c.depth]).toEqual([6, 5]);
  });

  it('caso real (Quest 3S): dos habitaciones separadas por un tabique de 15 cm', () => {
    // Medidas tomadas de un escaneo real: la app las unía en una «sala» de 10,2 × 5,2 m
    const A = [
      { x: -0.6, z: -2.6 },
      { x: -5.09, z: -2.59 },
      { x: -5.1, z: 2.5 },
      { x: -0.6, z: 2.57 },
    ];
    const B = [
      { x: -0.45, z: -0.09 },
      { x: 5.1, z: -0.09 },
      { x: 5.09, z: 2.59 },
      { x: -0.45, z: 2.57 },
    ];
    const roomPlanes = (c: { x: number; z: number }[], h: number): ScanPlane[] => [
      ...c.map((a, i) => wall(a, c[(i + 1) % c.length], 'wall', 0, h)),
      { label: 'floor', orientation: 'horizontal', points: c.map((q) => ({ ...q, y: 0 })) },
      { label: 'ceiling', orientation: 'horizontal', points: c.map((q) => ({ ...q, y: h })) },
    ];
    const door = wall({ x: -0.6, z: -1.67 }, { x: -0.6, z: -0.81 }, 'door', 0, 2.15);
    const doorB = wall({ x: -0.58, z: -1.68 }, { x: -0.58, z: -0.8 }, 'door', 0, 2.15);
    const window = wall({ x: 5.1, z: 1.56 }, { x: 5.1, z: 2.16 }, 'window', 1, 2.05);
    const all = [...roomPlanes(A, 2.52), ...roomPlanes(B, 2.52), door, doorB, window];
    for (const withFloor of [true, false]) {
      const src = withFloor ? all : all.filter((p) => p.label !== 'floor');
      const b = parseRoomPlan(planesToRoomPlan(currentRoomPlanes(src, { x: 2, z: 1.2 })));
      expect([b.width, b.depth].map((v) => Math.round(v * 10) / 10), `B ${withFloor}`).toEqual([5.6, 2.7]);
      expect(b.outline, `B ${withFloor}`).toBeUndefined();
      expect(b.items.filter((i) => i.type === 'ventana'), `B ${withFloor}`).toHaveLength(1);
      expect(b.items.filter((i) => i.type === 'puerta' || i.type === 'tabique'), `B ${withFloor}`).toHaveLength(0);
      const a = parseRoomPlan(planesToRoomPlan(currentRoomPlanes(src, { x: -3, z: 0.3 })));
      expect([a.width, a.depth].map((v) => Math.round(v * 10) / 10).sort(), `A ${withFloor}`).toEqual([4.5, 5.2]);
      expect(a.items.filter((i) => i.type === 'puerta'), `A ${withFloor}`).toHaveLength(1);
      expect(a.items.filter((i) => i.type === 'ventana' || i.type === 'tabique'), `A ${withFloor}`).toHaveLength(0);
    }
  });

  it('los muebles anotados por las gafas (mesa, sofá) pasan a ser obstáculos', () => {
    // Mesa de 1,6 × 0,8 m a 0,75 m de altura, girada 30°; el techo y el suelo no cuentan
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const top = [
      [-0.8, -0.4],
      [0.8, -0.4],
      [0.8, 0.4],
      [-0.8, 0.4],
    ].map(([x, z]) => ({ x: 2 + x * c - z * s, y: 0.75, z: 1 + x * s + z * c }));
    const obs = planeObstacles([...planes, { label: 'table', orientation: 'horizontal', points: top }]);
    expect(obs).toHaveLength(1);
    expect(obs[0].x).toBeCloseTo(2, 2);
    expect(obs[0].z).toBeCloseTo(1, 2);
    expect([obs[0].w, obs[0].d].map((v) => Math.round(v * 10) / 10)).toEqual([1.6, 0.8]);
    expect(obs[0].h).toBeCloseTo(0.75, 2);
    expect(Math.abs(obs[0].rot)).toBeCloseTo(30, 0);
  });

  it('app nativa: la sala anotada por las gafas (Meta) da paredes, puerta y muebles con nombre', async () => {
    const { importScan } = await import('../lib/scanImport');
    // Sala de 6 × 4 m y 2,5 m de alto en coordenadas de Unity (y arriba). Cuaternión de giro sobre Y.
    const qy = (deg: number) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
    const wallA = (x: number, z: number, deg: number, w: number) => ({ label: 'WALL_FACE', room: 0, pos: [x, 1.25, z], rot: qy(deg), rect: [-w / 2, -1.25, w, 2.5] });
    // Planos horizontales: girados −90° sobre X (su normal local +Z mira hacia arriba)
    const up = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    const scene = [
      wallA(0, 2, 180, 6),
      wallA(0, -2, 0, 6),
      wallA(3, 0, 270, 4),
      wallA(-3, 0, 90, 4),
      { label: 'FLOOR', room: 0, pos: [0, 0, 0], rot: up, rect: [-3, -2, 6, 4] },
      { label: 'CEILING', room: 0, pos: [0, 2.5, 0], rot: up, rect: [-3, -2, 6, 4] },
      { label: 'DOOR_FRAME', room: 0, pos: [1, 1.05, -2], rot: qy(0), rect: [-0.45, -1.05, 0.9, 2.1] },
      // Sofá de 2 × 0,9 m y 0,8 m de alto; mesa de 1,2 × 0,6 m a 0,45 m
      { label: 'COUCH', room: 0, pos: [-1.5, 0.8, 1.2], rot: up, vol: [0, 0, -0.4, 2, 0.9, 0.8] },
      { label: 'TABLE', room: 0, pos: [-1.5, 0.45, 0], rot: up, vol: [0, 0, -0.225, 1.2, 0.6, 0.45] },
      // Otra habitación anotada en las gafas: no debe entrar
      { label: 'FLOOR', room: 1, pos: [10, 0, 0], rot: up, rect: [-2, -2, 4, 4] },
      { label: 'WALL_FACE', room: 1, pos: [10, 1.25, 2], rot: qy(180), rect: [-2, -1.25, 4, 2.5] },
      { label: 'COUCH', room: 1, pos: [10, 0.8, 0], rot: up, vol: [0, 0, -0.4, 2, 0.9, 0.8] },
    ];
    const walk = { cell: 0.1, free: [], wall: [], obj: [], path: [0, 0, 50, 0, 100, 0, 100, 50] };
    const r = importScan({ format: 'mice-roomplan', version: 2, walls: [], walk, scene });
    expect([r.width, r.depth]).toEqual([6, 4]);
    expect(r.height).toBeCloseTo(2.5, 1);
    expect(r.items.filter((i) => i.type === 'puerta')).toHaveLength(1);
    const sofa = r.fixed.filter((i) => i.type === 'sofa');
    expect(sofa).toHaveLength(1);
    expect([sofa[0].w, sofa[0].d].sort()).toEqual([0.9, 2]);
    expect(sofa[0].h).toBeCloseTo(0.8, 1);
    expect(sofa[0].label).toBe('Sofá');
    const mesa = r.fixed.find((i) => i.label === 'Mesa')!;
    expect(mesa.chairs).toBe(0);
    expect(mesa.h).toBeCloseTo(0.45, 1);
    expect(r.fixed).toHaveLength(2);
  });

  it('app nativa: sala en L anotada por Meta (el suelo llega como rectángulo envolvente): entran todas sus paredes', async () => {
    const { importScan } = await import('../lib/scanImport');
    const qy = (deg: number) => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
    const wallA = (x: number, z: number, deg: number, w: number) => ({ label: 'WALL_FACE', room: 0, pos: [x, 1.25, z], rot: qy(deg), rect: [-w / 2, -1.25, w, 2.5] });
    const up = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
    // L de 8 × 6 m sin la esquina x 4..8, z 3..6 (caso real: un salón de 17 lados perdía 10 paredes)
    const scene = [
      wallA(4, 0, 0, 8),
      wallA(8, 1.5, 270, 3),
      wallA(6, 3, 180, 4),
      wallA(4, 4.5, 270, 3),
      wallA(2, 6, 180, 4),
      wallA(0, 3, 90, 6),
      { label: 'FLOOR', room: 0, pos: [4, 0, 3], rot: up, rect: [-4, -3, 8, 6] },
      { label: 'DOOR_FRAME', room: 0, pos: [4, 1.05, 4.5], rot: qy(270), rect: [-0.45, -1.05, 0.9, 2.1] },
    ];
    const walk = { cell: 0.1, free: [], wall: [], obj: [], path: [100, -100, 200, -100, 100, -400] };
    const r = importScan({ format: 'mice-roomplan', version: 2, walls: [], walk, scene });
    expect([r.width, r.depth]).toEqual([8, 6]);
    expect(r.outline).toHaveLength(6);
    expect(r.items.filter((i) => i.type === 'puerta')).toHaveLength(1);
  });

  it('fotos del escaneo: posición en la sala y pared a la que miran', async () => {
    const { placePhotos } = await import('../lib/scanImport');
    const { rectOutline } = await import('../lib/outline');
    const outline = rectOutline(6, 4);
    const frame = { theta: 0, x: 0, z: 0 };
    // Unity: mirando a +Z de Unity = −z en la web = pared del frente (índice 0)
    const fwd = [0, 0, 0, 1];
    // Girada 90° sobre Y en Unity: mira a +X = pared derecha (índice 1)
    const right = [0, Math.SQRT1_2, 0, Math.SQRT1_2];
    const r = placePhotos(frame, outline, [
      { pos: [1, 1.6, -0.5], rot: fwd },
      { pos: [0, 1.6, 0], rot: right },
    ]);
    expect(r[0]).toMatchObject({ x: 1, z: 0.5, wall: 0, heading: 0 });
    expect(r[1]).toMatchObject({ wall: 1, heading: 90 });
  });
});
