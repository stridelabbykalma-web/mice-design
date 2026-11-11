import { describe, expect, it } from 'vitest';
import { WalkScan, type P2, type P3 } from '../lib/walkScan';
import { polygonArea } from '../lib/outline';

/** Rayos de una cámara en una sala (polígono extruido) con suelo y techo: devuelve los puntos vistos. */
type Box = { x0: number; x1: number; z0: number; z1: number; h: number };
let BOXES: Box[] = [];
export function castView(room: P2[], H: number, head: P3, yawDeg: number, noise = 0.02, cols = 24, rows = 18, pitchDeg = 0): P3[] {
  const pts: P3[] = [];
  const yaw = (yawDeg * Math.PI) / 180;
  const pitch = (pitchDeg * Math.PI) / 180;
  let seed = Math.round(head.x * 131 + head.z * 17 + yawDeg);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff - 0.5) * 2 * noise;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const a = yaw + ((c / (cols - 1) - 0.5) * 90 * Math.PI) / 180;
      const e = pitch + ((r / (rows - 1) - 0.5) * 80 * Math.PI) / 180;
      const d = { x: Math.sin(a) * Math.cos(e), y: Math.sin(e), z: -Math.cos(a) * Math.cos(e) };
      let t = Infinity;
      if (d.y < 0) t = Math.min(t, -head.y / d.y);
      if (d.y > 0) t = Math.min(t, (H - head.y) / d.y);
      for (let i = 0; i < room.length; i++) {
        const p = room[i];
        const q = room[(i + 1) % room.length];
        const ex = q.x - p.x;
        const ez = q.z - p.z;
        const den = d.x * ez - d.z * ex;
        if (Math.abs(den) < 1e-9) continue;
        const tt = ((p.x - head.x) * ez - (p.z - head.z) * ex) / den;
        const s = ((p.x - head.x) * d.z - (p.z - head.z) * d.x) / den;
        if (tt > 0.01 && s >= 0 && s <= 1) t = Math.min(t, tt);
      }
      for (const b of BOXES) {
        // Intersección rayo-caja por planos (caja apoyada en el suelo)
        let tn = 0;
        let tf = Infinity;
        for (const [o, dd, lo, hi] of [
          [head.x, d.x, b.x0, b.x1],
          [head.y, d.y, 0, b.h],
          [head.z, d.z, b.z0, b.z1],
        ]) {
          if (Math.abs(dd) < 1e-9) {
            if (o < lo || o > hi) tn = Infinity;
            continue;
          }
          const a1 = (lo - o) / dd;
          const a2 = (hi - o) / dd;
          tn = Math.max(tn, Math.min(a1, a2));
          tf = Math.min(tf, Math.max(a1, a2));
        }
        if (tn < tf && tn > 0.01) t = Math.min(t, tn);
      }
      if (!Number.isFinite(t)) continue;
      t += rnd();
      pts.push({ x: head.x + d.x * t, y: head.y + d.y * t, z: head.z + d.z * t });
    }
  return pts;
}

const rot = (pts: P2[], deg: number, ox: number, oz: number) => {
  const c = Math.cos((deg * Math.PI) / 180);
  const s = Math.sin((deg * Math.PI) / 180);
  return pts.map((p) => ({ x: p.x * c - p.z * s + ox, z: p.x * s + p.z * c + oz }));
};

function walk(room: P2[], H: number, path: P2[], step = 0.6) {
  const scan = new WalkScan();
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i];
    const b = path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(b.x - a.x, b.z - a.z) / step));
    for (let k = 0; k <= n; k++) {
      const head = { x: a.x + ((b.x - a.x) * k) / n, y: 1.6, z: a.z + ((b.z - a.z) * k) / n };
      // Se mira alrededor mientras se camina, y de vez en cuando al techo
      for (let yaw = 0; yaw < 360; yaw += 45) scan.addFrame(head, castView(room, H, head, yaw + k * 7));
      if (k % 3 === 0) scan.addFrame(head, castView(room, H, head, k * 40, 0.02, 24, 18, 45));
    }
  }
  return scan;
}

describe('escaneo caminando (profundidad de las gafas)', () => {
  it('reconstruye un salón rectangular de 14 × 9 m girado, andando por el centro y cerca de las paredes', () => {
    const local = [
      { x: -7, z: -4.5 },
      { x: 7, z: -4.5 },
      { x: 7, z: 4.5 },
      { x: -7, z: 4.5 },
    ];
    const room = rot(local, 25, 3, -2);
    const path = rot(
      [
        { x: -5, z: -2.5 },
        { x: 5, z: -2.5 },
        { x: 5, z: 2.5 },
        { x: -5, z: 2.5 },
        { x: -5, z: -2.5 },
      ],
      25,
      3,
      -2,
    );
    const scan = walk(room, 3.4, path);
    const r = scan.outline()!;
    expect(r).not.toBeNull();
    expect(r.outline).toHaveLength(4);
    expect(Math.abs(r.area - 126)).toBeLessThan(126 * 0.05);
    expect(polygonArea(r.outline)).toBeCloseTo(r.area, 1);
    // Cada esquina reconstruida cae a menos de 20 cm de una real
    for (const p of r.outline) expect(Math.min(...room.map((q) => Math.hypot(p.x - q.x, p.z - q.z)))).toBeLessThan(0.2);
    expect(scan.ceiling).toBeCloseTo(3.4, 1);
    expect(Math.abs(scan.floorError!)).toBeLessThan(0.05);
  });

  it('reconstruye una sala en L', () => {
    const local = [
      { x: -6, z: -4.5 },
      { x: 6, z: -4.5 },
      { x: 6, z: 0 },
      { x: 0, z: 0 },
      { x: 0, z: 4.5 },
      { x: -6, z: 4.5 },
    ];
    const room = rot(local, -15, 0, 0);
    const path = rot(
      [
        { x: 4, z: -2.5 },
        { x: -4, z: -2.5 },
        { x: -3, z: 3 },
        { x: -3, z: -1 },
      ],
      -15,
      0,
      0,
    );
    const r = walk(room, 3, path).outline()!;
    expect(r.outline).toHaveLength(6);
    expect(Math.abs(r.area - 81)).toBeLessThan(81 * 0.06);
    for (const p of r.outline) expect(Math.min(...room.map((q) => Math.hypot(p.x - q.x, p.z - q.z)))).toBeLessThan(0.25);
  });

  it('un salón grande solo sale entero si se recorre entero', () => {
    const room = [
      { x: -15, z: -8 },
      { x: 15, z: -8 },
      { x: 15, z: 8 },
      { x: -15, z: 8 },
    ];
    // Solo se camina por un extremo: lo visto llega a unos 5 m alrededor
    const half = walk(room, 4, [
      { x: -11, z: -4 },
      { x: -11, z: 4 },
    ]).outline();
    expect(half === null || half.area < 300).toBe(true);
    // Recorrido completo en zigzag
    const full = walk(room, 4, [
      { x: -12, z: -5 },
      { x: 12, z: -5 },
      { x: 12, z: 0 },
      { x: -12, z: 0 },
      { x: -12, z: 5 },
      { x: 12, z: 5 },
    ]).outline()!;
    expect(Math.abs(full.area - 480)).toBeLessThan(480 * 0.05);
    expect(full.outline).toHaveLength(4);
  });

  it('sin datos suficientes no inventa una sala', () => {
    expect(new WalkScan().outline()).toBeNull();
  });

  it('una puerta abierta no añade la sala de al lado', () => {
    // Sala A de 8 × 6 m y sala B de 6 × 6 m, separadas por un tabique de 20 cm con una puerta de 1,5 m
    const room = [
      { x: -4, z: -3 },
      { x: 4, z: -3 },
      { x: 4, z: -0.75 },
      { x: 4.2, z: -0.75 },
      { x: 4.2, z: -3 },
      { x: 10.2, z: -3 },
      { x: 10.2, z: 3 },
      { x: 4.2, z: 3 },
      { x: 4.2, z: 0.75 },
      { x: 4, z: 0.75 },
      { x: 4, z: 3 },
      { x: -4, z: 3 },
    ];
    // Se camina solo por la sala A, pasando por delante de la puerta
    const r = walk(room, 3, [
      { x: -2.5, z: -1.5 },
      { x: 2.8, z: -1.5 },
      { x: 2.8, z: 1.5 },
      { x: -2.5, z: 1.5 },
      { x: -2.5, z: -1.5 },
    ]).outline()!;
    expect(Math.abs(r.area - 48)).toBeLessThan(48 * 0.08);
    expect(Math.max(...r.outline.map((p) => p.x))).toBeLessThan(4.4);
  });

  it('detecta un armario pegado a la pared y una mesa en medio de la sala', () => {
    const room = [
      { x: -4, z: -3 },
      { x: 4, z: -3 },
      { x: 4, z: 3 },
      { x: -4, z: 3 },
    ];
    // Armario de 2 × 0,6 m y 2,1 m de alto en la pared del fondo; mesa de 1,6 × 0,8 m
    BOXES = [
      { x0: -1, x1: 1, z0: -3, z1: -2.4, h: 2.1 },
      { x0: 0.2, x1: 1.8, z0: 0.6, z1: 1.4, h: 0.75 },
    ];
    try {
      const scan = walk(room, 2.8, [
        { x: -2.8, z: -1.2 },
        { x: 2.8, z: -1.2 },
        { x: 2.8, z: 2.2 },
        { x: -2.8, z: 2.2 },
        { x: -2.8, z: -1.2 },
      ]);
      const r = scan.outline()!;
      expect(Math.abs(r.area - 48)).toBeLessThan(48 * 0.08);
      const obs = scan.obstacles(r);
      const near = (x: number, z: number) => obs.find((o) => Math.hypot(o.x - x, o.z - z) < 0.5);
      const armario = near(0, -2.7)!;
      expect(armario).toBeTruthy();
      expect(Math.max(armario.w, armario.d)).toBeGreaterThan(1.7);
      expect(Math.max(armario.w, armario.d)).toBeLessThan(2.4);
      expect(armario.h).toBeGreaterThan(1.8);
      const mesa = near(1, 1)!;
      expect(mesa).toBeTruthy();
      expect(mesa.h).toBeLessThan(1);
      expect(Math.max(mesa.w, mesa.d)).toBeGreaterThan(1.3);
      // Nada más: ni las manos ni el recorrido crean muebles
      expect(obs.length).toBe(2);
    } finally {
      BOXES = [];
    }
  });

  it('el escaneo de la app nativa (rejillas) da la misma sala que el escaneo directo', async () => {
    const { importScan } = await import('../lib/scanImport');
    const room = [
      { x: -4, z: -3 },
      { x: 4, z: -3 },
      { x: 4, z: 3 },
      { x: -4, z: 3 },
    ];
    BOXES = [{ x0: -1, x1: 1, z0: -3, z1: -2.4, h: 2.1 }];
    try {
      const scan = walk(room, 2.8, [
        { x: -2.8, z: -1.2 },
        { x: 2.8, z: -1.2 },
        { x: 2.8, z: 2.2 },
        { x: -2.8, z: 2.2 },
        { x: -2.8, z: -1.2 },
      ]);
      const file = JSON.parse(JSON.stringify({ format: 'mice-roomplan', version: 2, walls: [], name: 'Salón de prueba', walk: scan.toGrids() }));
      expect(JSON.stringify(file).length).toBeLessThan(60000);
      const r = importScan(file);
      const dims = [r.width, r.depth].sort();
      expect(Math.abs(dims[0] - 6)).toBeLessThan(0.2);
      expect(Math.abs(dims[1] - 8)).toBeLessThan(0.2);
      expect(r.height).toBeCloseTo(2.8, 1);
      expect(r.fixed).toHaveLength(1);
      expect(r.fixed[0].type).toBe('obstaculo');
      expect(Math.max(r.fixed[0].w!, r.fixed[0].d!)).toBeGreaterThan(1.7);
      expect(r.name).toBe('Salón de prueba');
    } finally {
      BOXES = [];
    }
  });
});
