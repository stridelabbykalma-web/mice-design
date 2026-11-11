// Importa un escaneo de sala (archivo .mice-room.json o escaneo de la app nativa de las gafas)
// y lo convierte en medidas, forma, puertas, ventanas y obstáculos del proyecto.

import type { Item } from '../types';
import { parseRoomPlan, type RoomPlanFile, type RoomPlanResult } from './roomplan';
import { WalkScan, type Obstacle, type WalkGrids } from './walkScan';
import { cornersToRoomPlan } from './xrScan';

/** Un escaneo tal como llega: paredes medidas y, si viene del escaneo caminando, sus rejillas. */
export type ScanFile = RoomPlanFile & { walk?: WalkGrids; name?: string; device?: string };

export interface ScanResult extends RoomPlanResult {
  /** Obstáculos fijos (armarios, barras, muebles) en coordenadas de la sala. */
  fixed: Omit<Item, 'id'>[];
  name?: string;
}

/** Lleva los obstáculos de las coordenadas del escaneo a las de la sala del proyecto. */
export function placeObstacles(frame: RoomPlanResult['frame'], obstacles: Obstacle[]): Omit<Item, 'id'>[] {
  const ct = Math.cos(-frame.theta);
  const sn = Math.sin(-frame.theta);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return obstacles.map((o) => {
    const X = o.x - frame.x;
    const Z = o.z - frame.z;
    return { type: 'obstaculo', x: r2(X * ct - Z * sn), z: r2(X * sn + Z * ct), rot: r2(o.rot + (frame.theta * 180) / Math.PI), w: r2(o.w), d: r2(o.d), h: r2(o.h) };
  });
}

export function importScan(json: unknown, fallbackHeight = 3): ScanResult {
  const f = json as ScanFile;
  if (!f || f.format !== 'mice-roomplan') throw new Error('No es un escaneo de MICE Design.');
  if (f.walk) {
    // Escaneo caminando de la app de las gafas: la planta se reconstruye aquí
    const scan = WalkScan.fromGrids(f.walk);
    const o = scan.outline();
    if (!o) throw new Error('El escaneo no tiene paredes suficientes para reconstruir la sala. Repítelo caminando por toda la sala y mirando a las paredes.');
    const r = parseRoomPlan(cornersToRoomPlan(o.outline, scan.ceiling ?? fallbackHeight));
    const fixed = placeObstacles(r.frame, scan.obstacles(o));
    return { ...r, fixed, name: f.name, summary: `${r.summary.replace(' Revisa qué puertas son salidas de emergencia.', '')} · ${fixed.length} muebles u obstáculos. Añade las puertas y salidas.` };
  }
  return { ...parseRoomPlan(f), fixed: [], name: f.name };
}
