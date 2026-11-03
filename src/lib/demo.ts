import type { Project, Space, SpaceMethod } from '../types';
import { newProject } from '../store';
import { generateLayout, defaultOptions } from './layouts';
import { uid } from './db';

export function blankSpace(method: SpaceMethod, name: string, width: number, depth: number, height: number): Space {
  const outdoor = method === 'satelite';
  return {
    method,
    name,
    width,
    depth,
    height,
    outdoor,
    showWalls: !outdoor,
    floorColor: outdoor ? '#9bb37e' : '#c8b49a',
    wallColor: '#efe9df',
  };
}

/** Proyecto de ejemplo: salón de 24 × 16 m con columnas, salidas y montaje de banquete. */
export function demoProject(): Project {
  const space = blankSpace('plano', 'Salón Mediterráneo', 24, 16, 3.6);
  const p = newProject(space, 'Cena de gala – Congreso Andaluz de Cardiología', 'Hotel de ejemplo');
  p.items = [
    { id: uid('i_'), type: 'columna', x: -6, z: -2.5, rot: 0 },
    { id: uid('i_'), type: 'columna', x: 6, z: -2.5, rot: 0 },
    { id: uid('i_'), type: 'columna', x: -6, z: 3.5, rot: 0 },
    { id: uid('i_'), type: 'columna', x: 6, z: 3.5, rot: 0 },
    { id: uid('i_'), type: 'puerta', x: 0, z: 8 - 0.06, rot: 180 },
    { id: uid('i_'), type: 'salida', x: -12 + 0.06, z: 4, rot: 90 },
    { id: uid('i_'), type: 'salida', x: 12 - 0.06, z: -4, rot: -90 },
    { id: uid('i_'), type: 'ventana', x: -6, z: -8 + 0.04, rot: 0, w: 3 },
    { id: uid('i_'), type: 'ventana', x: 6, z: -8 + 0.04, rot: 0, w: 3 },
  ];
  p.event = {
    name: 'Cena de gala',
    client: 'Congreso Andaluz de Cardiología',
    date: '',
    time: '21:00 – 01:00',
    pax: 150,
    layout: 'banquete',
    notes: 'Mantelería blanca hasta el suelo. Centro floral bajo. Pista de baile frente a la mesa presidencial.',
    pricePerPax: 75,
    roomPrice: 1200,
  };
  p.lighting = 'noche';
  const layout = generateLayout(p, { ...defaultOptions('banquete'), pax: 150 });
  let n = 0;
  p.items.push(
    ...layout.items.map((it) => ({ ...it, id: uid('i_'), label: it.type.startsWith('mesa') ? `Mesa ${++n}` : undefined })),
    { id: uid('i_'), type: 'uplight', x: -11.5, z: -7.5, rot: 0, color: '#ff9e3d' },
    { id: uid('i_'), type: 'uplight', x: 11.5, z: -7.5, rot: 0, color: '#ff9e3d' },
    { id: uid('i_'), type: 'uplight', x: -11.5, z: 7.5, rot: 0, color: '#7b61ff' },
    { id: uid('i_'), type: 'uplight', x: 11.5, z: 7.5, rot: 0, color: '#7b61ff' },
    { id: uid('i_'), type: 'atril-bienvenida', x: 1.6, z: 6.8, rot: 180, label: 'Bienvenidos\nCena de gala' },
  );
  return p;
}
