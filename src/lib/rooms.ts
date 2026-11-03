// Salas del hotel: espacio y elementos fijos (arquitectura y decoración de pared o techo).
import type { Project, RoomTemplate } from '../types';
import { findDef } from '../catalog';
import { newProject } from '../store';
import { uid } from './db';

export function roomTemplateOf(project: Project): RoomTemplate {
  const items = project.items.filter((i) => {
    const d = findDef(i.type, project.customCatalog);
    return !!d && (d.category === 'arquitectura' || !!d.wallMount || d.mountY !== undefined);
  });
  const used = new Set(items.map((i) => i.type));
  return {
    space: structuredClone(project.space),
    items: structuredClone(items),
    defs: project.customCatalog.filter((c) => used.has(c.type)),
  };
}

export function projectFromRoom(room: RoomTemplate, eventName: string, hotel: string): Project {
  const p = newProject(structuredClone(room.space), eventName, hotel);
  p.items = room.items.map((i) => ({ ...i, id: uid('i_') }));
  p.customCatalog = structuredClone(room.defs);
  return p;
}
