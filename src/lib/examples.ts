// Salas de ejemplo: espacios típicos de un hotel con su arquitectura (puertas, salidas,
// ventanas, columnas) y un evento ya montado con su programa por fases. Sirven para probar
// la app sin tener todavía los planos del hotel y como casos de prueba automáticos.

import type { Item, Project, Space } from '../types';
import { newProject } from '../store';
import { findDef } from '../catalog';
import { snapToRoomWall, presetOutline, type P2 } from './outline';
import { EVENT_KINDS, buildProgram, type EventKind } from './program';
import { uid } from './db';

export interface ExampleRoom {
  id: string;
  name: string;
  description: string;
  /** Evento que se monta al abrir el ejemplo. */
  kind: EventKind;
  pax: number;
  /** Sala vacía: espacio y elementos fijos. */
  room(): { space: Space; items: Item[] };
}

const base = (name: string, width: number, depth: number, height: number, extra: Partial<Space> = {}): Space => ({
  method: 'plano',
  name,
  width,
  depth,
  height,
  outdoor: false,
  showWalls: true,
  floorColor: '#c8b49a',
  wallColor: '#efe9df',
  ...extra,
});

/** Elemento de pared (puerta, salida, ventana) anclado a la pared más cercana al punto. */
function onWall(space: Space, type: 'puerta' | 'salida' | 'ventana', x: number, z: number, w?: number): Item {
  const d = findDef(type, [])!;
  const s = snapToRoomWall(x, z, space, d.d);
  return { id: uid('i_'), type, x: s.x, z: s.z, rot: s.rot, ...(w ? { w } : {}) };
}
const column = (x: number, z: number, size = 0.5): Item => ({ id: uid('i_'), type: 'columna', x, z, rot: 0, w: size, d: size });

/** Rectángulo con las cuatro esquinas en chaflán (salones ochavados). */
function chamfered(w: number, d: number, c: number): P2[] {
  const a = w / 2;
  const b = d / 2;
  return [
    { x: -a + c, z: -b },
    { x: a - c, z: -b },
    { x: a, z: -b + c },
    { x: a, z: b - c },
    { x: a - c, z: b },
    { x: -a + c, z: b },
    { x: -a, z: b - c },
    { x: -a, z: -b + c },
  ];
}

export const EXAMPLE_ROOMS: ExampleRoom[] = [
  {
    id: 'consejo',
    name: 'Sala de consejo',
    description: '9 × 6 m. Reunión de 14 personas en U con pantalla.',
    kind: 'reunion',
    pax: 14,
    room() {
      const space = base('Sala Consejo', 9, 6, 2.8, { floorColor: '#8c7a66' });
      return {
        space,
        items: [onWall(space, 'salida', 3.4, 3, 1.0), onWall(space, 'ventana', -4.5, 0, 3), onWall(space, 'ventana', 4.5, -1, 2)],
      };
    },
  },
  {
    id: 'auditorio',
    name: 'Salón de congresos',
    description: '30 × 14 m, alargado y sin columnas. Congreso de 200 personas con cena de gala.',
    kind: 'congreso',
    pax: 200,
    room() {
      const space = base('Salón Alhambra', 30, 14, 4.5);
      return {
        space,
        items: [
          onWall(space, 'puerta', -8, 7, 1.8),
          onWall(space, 'puerta', 8, 7, 1.8),
          onWall(space, 'salida', -15, -3, 1.6),
          onWall(space, 'salida', 15, -3, 1.6),
          onWall(space, 'salida', 15, 4, 1.6),
          onWall(space, 'ventana', -15, 3, 4),
        ],
      };
    },
  },
  {
    id: 'ele',
    name: 'Salón en L',
    description: '22 × 15 m con forma de L. Convención de empresa de 80 personas.',
    kind: 'convencion',
    pax: 80,
    room() {
      const space = base('Salón Generalife', 22, 15, 3.4, { outline: presetOutline('L', 22, 15) });
      return {
        space,
        items: [
          onWall(space, 'puerta', -5.5, 7.5, 1.8),
          onWall(space, 'salida', -11, -3, 1.4),
          onWall(space, 'salida', 11, -4, 1.4),
          onWall(space, 'salida', 6, 0, 1.2),
          onWall(space, 'ventana', 2, -7.5, 5),
        ],
      };
    },
  },
  {
    id: 'gran',
    name: 'Gran salón con columnas',
    description: '36 × 20 m con ocho columnas. Cena de gala de 300 personas.',
    kind: 'gala',
    pax: 300,
    room() {
      const space = base('Gran Salón Sierra Nevada', 36, 20, 5);
      const cols: Item[] = [];
      for (const x of [-13.5, -4.5, 4.5, 13.5]) for (const z of [-4, 5]) cols.push(column(x, z, 0.6));
      return {
        space,
        items: [
          ...cols,
          onWall(space, 'puerta', -6, 10, 2),
          onWall(space, 'puerta', 6, 10, 2),
          onWall(space, 'salida', -18, -5, 1.8),
          onWall(space, 'salida', -18, 5, 1.8),
          onWall(space, 'salida', 18, -5, 1.8),
          onWall(space, 'salida', 18, 5, 1.8),
        ],
      };
    },
  },
  {
    id: 'ochavado',
    name: 'Salón ochavado',
    description: '18 × 16 m con las esquinas en chaflán. Boda de 100 invitados.',
    kind: 'boda',
    pax: 100,
    room() {
      const space = base('Salón Albaicín', 18, 16, 4, { outline: chamfered(18, 16, 2.5) });
      return {
        space,
        items: [
          onWall(space, 'puerta', 0, 8, 2),
          onWall(space, 'salida', -9, 0, 1.4),
          onWall(space, 'salida', 9, 0, 1.4),
          onWall(space, 'ventana', -3.5, -8, 3),
          onWall(space, 'ventana', 3.5, -8, 3),
        ],
      };
    },
  },
  {
    id: 'terraza',
    name: 'Terraza exterior',
    description: '20 × 12 m al aire libre. Presentación de producto para 90 personas.',
    kind: 'presentacion',
    pax: 90,
    room() {
      const space = base('Terraza Mirador', 20, 12, 3, { outdoor: true, showWalls: false, floorColor: '#b9ad9a' });
      return { space, items: [onWall(space, 'puerta', -4, 6, 1.8), onWall(space, 'puerta', 4, 6, 1.8)] };
    },
  },
];

/** Proyecto completo de un ejemplo: la sala y su evento montado por fases. */
export function exampleProject(id: string): Project {
  const ex = EXAMPLE_ROOMS.find((e) => e.id === id) ?? EXAMPLE_ROOMS[0];
  const { space, items } = ex.room();
  const kind = EVENT_KINDS[ex.kind];
  const p = newProject(space, `${kind.name} – ${ex.pax} personas`, 'Hotel de ejemplo');
  p.items = items;
  p.event = { ...p.event, name: kind.name, pax: ex.pax };
  const { program, variants } = buildProgram(p, ex.kind, ex.pax);
  const first = variants[0];
  if (first) {
    p.program = program;
    p.variants = variants;
    p.activeVariant = first.id;
    p.items = first.items;
    p.lighting = first.lighting;
    p.event.layout = first.layout;
  }
  return p;
}
