import type { Item, Project, Space } from '../types';

export function space(w: number, d: number, extra: Partial<Space> = {}): Space {
  return { method: 'plano', name: 'Sala', width: w, depth: d, height: 3.5, outdoor: false, showWalls: true, floorColor: '#ccc', wallColor: '#eee', ...extra };
}

let n = 0;
export const item = (type: string, x: number, z: number, extra: Partial<Item> = {}): Item => ({ id: `t${++n}`, type, x, z, rot: 0, ...extra });

export function project(sp: Space, items: Item[] = [], extra: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'Prueba',
    hotel: '',
    createdAt: 0,
    updatedAt: 0,
    space: sp,
    items,
    customCatalog: [],
    event: { name: '', client: '', date: '', time: '', pax: 0, layout: '', notes: '', pricePerPax: 0, roomPrice: 0 },
    lighting: 'dia',
    ...extra,
  };
}
