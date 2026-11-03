import type { Project, Space, SpaceMethod } from '../types';
import { newProject } from '../store';
import { generateLayout, defaultOptions } from './layouts';
import { addAsset, uid } from './db';
import salonUrl from '../assets/salon-escaneado.glb?url';

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

/**
 * Proyecto de ejemplo sobre un gemelo digital: sala con papel pintado, zócalo, cuadros,
 * espejo, apliques y lámparas (escaneo simulado), vaciada de los muebles que había al
 * escanearla y montada para una cena de 80 personas.
 */
export async function demoScanProject(): Promise<Project> {
  let blob: Blob;
  if (salonUrl.startsWith('data:')) {
    // Versión de un solo archivo: el modelo va incrustado en base64.
    const bin = atob(salonUrl.slice(salonUrl.indexOf(',') + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    blob = new Blob([bytes], { type: 'model/gltf-binary' });
  } else blob = await (await fetch(salonUrl)).blob();
  const assetId = await addAsset(new File([blob], 'salon-escaneado.glb', { type: 'model/gltf-binary' }), 'salon-escaneado.glb');
  const space = blankSpace('fotogrametria', 'Salón Real (gemelo digital)', 16, 11, 3.6);
  space.showWalls = false;
  space.model = {
    assetId,
    name: 'salon-escaneado.glb (escaneo simulado de ejemplo)',
    scale: 1,
    rotation: 0,
    offsetX: 0,
    offsetY: 0,
    offsetZ: 0,
    realColors: true,
    brightness: 1,
    emptyInterior: true,
    keepBand: 0.4,
    keepCeiling: 1,
  };
  const p = newProject(space, 'Cena de bienvenida – Gemelo digital', 'Hotel de ejemplo');
  p.items = [
    { id: uid('i_'), type: 'puerta', x: 0, z: 5.5 - 0.06, rot: 180, w: 1.8 },
    { id: uid('i_'), type: 'salida', x: 8 - 0.06, z: -3, rot: -90 },
  ];
  p.event = {
    name: 'Cena de bienvenida',
    client: 'Convención anual',
    date: '',
    time: '20:30 – 23:30',
    pax: 80,
    layout: 'banquete',
    notes: 'Mantelería en el tono del zócalo, a juego con la sala. Se conservan los cuadros y las lámparas de araña del salón.',
    pricePerPax: 65,
    roomPrice: 900,
  };
  const layout = generateLayout(p, { ...defaultOptions('banquete'), tableType: 'mesa-redonda-150', pax: 80, margin: 1.0 });
  p.event.pax = layout.pax;
  let n = 0;
  p.items.push(...layout.items.map((it) => ({ ...it, id: uid('i_'), color: it.chairs ? '#efe4cf' : undefined, label: it.chairs ? `Mesa ${++n}` : undefined })));
  return p;
}
