// Programa del evento por fases: cada tipo de evento MICE sigue una secuencia típica
// (ver docs/estructura-eventos-mice.md). Cada fase en la sala es una propuesta (montaje)
// propia; entre fases se calcula el cambio de montaje: qué se retira, qué se monta, cuánto
// personal y tiempo hace falta y si el tiempo disponible alcanza.

import type { Item, LayoutType, Project, Variant } from '../types';
import { findDef } from '../catalog';
import { defaultOptions, generateLayout, generatedTypes, LAYOUT_INFO } from './layouts';
import { capacitySummary } from './safety';
import { uid } from './db';

export type EventKind = 'reunion' | 'jornada' | 'congreso' | 'convencion' | 'presentacion' | 'prensa' | 'gala' | 'feria' | 'incentivo' | 'boda';

export interface Phase {
  id: string;
  name: string;
  /** Hora de inicio «HH:MM». */
  start: string;
  minutes: number;
  /** Montaje de la sala en esta fase (una propuesta). Sin él, la fase es fuera de la sala. */
  variantId?: string;
  /** Dónde están los asistentes si la fase es fuera de la sala (vestíbulo, jardín…). */
  place?: string;
  note?: string;
}

export interface Program {
  kind: EventKind;
  phases: Phase[];
  /** Personas del hotel para los cambios de montaje. */
  staff: number;
}

type RoomStep = { layout: LayoutType; stage?: boolean; screen?: boolean; presidencia?: number; pista?: boolean };
type Step = { name: string; minutes: number; note?: string } & (
  | { room: RoomStep }
  | { fromPrev: { remove?: string[]; addPresidencia?: number; pista?: boolean } }
  | { outside: string }
);

export const EVENT_KINDS: Record<EventKind, { name: string; description: string; start: string; steps: Step[] }> = {
  reunion: {
    name: 'Reunión de empresa o consejo',
    description: 'Café de bienvenida, reunión de trabajo y comida en otra sala.',
    start: '09:30',
    steps: [
      { name: 'Café de bienvenida', minutes: 30, outside: 'Vestíbulo' },
      { name: 'Reunión', minutes: 150, room: { layout: 'u', screen: true }, note: 'Agua y blocs en mesa' },
      { name: 'Comida', minutes: 75, outside: 'Restaurante' },
    ],
  },
  jornada: {
    name: 'Jornada, seminario o formación',
    description: 'Acreditación, sesiones, pausa café y talleres de tarde.',
    start: '09:00',
    steps: [
      { name: 'Acreditación', minutes: 30, outside: 'Vestíbulo' },
      { name: 'Sesiones de mañana', minutes: 120, room: { layout: 'escuela', stage: true, screen: true } },
      { name: 'Pausa café', minutes: 30, outside: 'Vestíbulo' },
      { name: 'Sesiones (continuación)', minutes: 90, fromPrev: {} },
      { name: 'Comida', minutes: 60, outside: 'Restaurante' },
      { name: 'Talleres de tarde', minutes: 120, room: { layout: 'u', screen: true } },
    ],
  },
  congreso: {
    name: 'Congreso o simposio',
    description: 'Inauguración con presidencia, plenaria, pausas, comida y cena de gala.',
    start: '09:00',
    steps: [
      { name: 'Acreditación', minutes: 45, outside: 'Vestíbulo (mostradores)' },
      { name: 'Inauguración oficial', minutes: 30, room: { layout: 'teatro', stage: true, screen: true, presidencia: 5 }, note: 'Presidencia según el RD 2099/1983: el anfitrión en el centro' },
      { name: 'Conferencia plenaria', minutes: 60, fromPrev: { remove: ['mesa-escuela'] }, note: 'Se retira la mesa de presidencia; queda el atril' },
      { name: 'Pausa café y pósteres', minutes: 30, outside: 'Zona de exposición' },
      { name: 'Comunicaciones', minutes: 120, fromPrev: {} },
      { name: 'Comida de trabajo', minutes: 75, outside: 'Otra sala o terraza (cóctel)' },
      { name: 'Clausura y premios', minutes: 45, fromPrev: { addPresidencia: 5 } },
      { name: 'Cóctel previo a la cena', minutes: 75, outside: 'Vestíbulo o jardín' },
      { name: 'Cena de gala', minutes: 120, room: { layout: 'banquete', stage: true } },
    ],
  },
  convencion: {
    name: 'Convención de empresa',
    description: 'Plenaria de dirección, grupos de trabajo y cena de clausura con premios.',
    start: '09:30',
    steps: [
      { name: 'Bienvenida', minutes: 30, outside: 'Vestíbulo' },
      { name: 'Plenaria de dirección', minutes: 120, room: { layout: 'teatro', stage: true, screen: true } },
      { name: 'Comida', minutes: 75, outside: 'Restaurante' },
      { name: 'Grupos de trabajo', minutes: 120, outside: 'Salas pequeñas' },
      { name: 'Cóctel', minutes: 60, outside: 'Vestíbulo o terraza' },
      { name: 'Cena de clausura y premios', minutes: 150, room: { layout: 'banquete', stage: true } },
      { name: 'Fiesta', minutes: 120, fromPrev: { pista: true }, note: 'Se retiran mesas de una zona para la pista' },
    ],
  },
  presentacion: {
    name: 'Presentación de producto',
    description: 'Recepción con demostraciones, presentación con desvelado y networking.',
    start: '19:00',
    steps: [
      { name: 'Recepción', minutes: 45, outside: 'Vestíbulo (photocall y teaser)' },
      { name: 'Presentación y desvelado', minutes: 45, room: { layout: 'teatro', stage: true, screen: true }, note: 'Producto tapado en el escenario' },
      { name: 'Demostraciones y networking', minutes: 90, room: { layout: 'coctel' } },
    ],
  },
  prensa: {
    name: 'Rueda de prensa',
    description: 'Presidencia en tarima con atril, prensa en teatro y entrevistas.',
    start: '11:00',
    steps: [
      { name: 'Llegada de medios', minutes: 20, outside: 'Acreditación de prensa' },
      { name: 'Comparecencia y preguntas', minutes: 45, room: { layout: 'teatro', stage: true, screen: true, presidencia: 3 }, note: 'Fondo con logotipo; tarima de cámaras al fondo, centrada' },
      { name: 'Entrevistas individuales', minutes: 30, fromPrev: {} },
    ],
  },
  gala: {
    name: 'Cena de gala o entrega de premios',
    description: 'Cóctel de bienvenida, cena con discursos y premios y baile.',
    start: '20:00',
    steps: [
      { name: 'Cóctel de bienvenida', minutes: 60, outside: 'Vestíbulo o jardín' },
      { name: 'Cena', minutes: 105, room: { layout: 'banquete', stage: true } },
      { name: 'Discursos y premios', minutes: 45, fromPrev: {}, note: 'Discursos de aceptación cortos' },
      { name: 'Baile y barra libre', minutes: 120, fromPrev: { pista: true } },
    ],
  },
  feria: {
    name: 'Workshop B2B o exposición',
    description: 'Mesas de reunión con agenda de citas y zona de café.',
    start: '10:00',
    steps: [
      { name: 'Acreditación', minutes: 30, outside: 'Vestíbulo' },
      { name: 'Reuniones B2B', minutes: 180, room: { layout: 'banquete' }, note: 'Mesas numeradas y agenda de citas' },
      { name: 'Comida', minutes: 60, outside: 'Restaurante' },
    ],
  },
  incentivo: {
    name: 'Viaje de incentivo (en el hotel)',
    description: 'Reunión corta y cena temática; el resto de actividades, fuera.',
    start: '18:00',
    steps: [
      { name: 'Reunión de bienvenida', minutes: 45, room: { layout: 'teatro', screen: true } },
      { name: 'Cóctel', minutes: 60, outside: 'Terraza' },
      { name: 'Cena temática', minutes: 120, room: { layout: 'banquete' } },
    ],
  },
  boda: {
    name: 'Boda o celebración',
    description: 'Ceremonia, cóctel, banquete y baile.',
    start: '18:00',
    steps: [
      { name: 'Ceremonia', minutes: 45, room: { layout: 'teatro' }, note: 'Pasillo central para la entrada' },
      { name: 'Cóctel', minutes: 90, outside: 'Jardín o vestíbulo' },
      { name: 'Banquete', minutes: 150, room: { layout: 'banquete' } },
      { name: 'Baile', minutes: 180, fromPrev: { pista: true } },
    ],
  },
};

const toMin = (t: string) => {
  const m = t.match(/(\d{1,2}):(\d{2})/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};
export const fmtTime = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
export const phaseEnd = (p: Phase) => fmtTime(toMin(p.start) + p.minutes);

const isArch = (p: Project, it: Item) => findDef(it.type, p.customCatalog)?.category === 'arquitectura';

/** Mesa de presidencia: mesas de 180 en el escenario, de cara al público. */
function presidencia(items: Item[], seats: number): Item[] {
  const stage = items.find((i) => i.type === 'escenario');
  if (!stage) return [];
  const n = Math.max(1, Math.ceil(seats / 3));
  const w = 1.8;
  const z = stage.z - (stage.d ?? 2.4) / 2 + 0.9;
  return Array.from({ length: n }, (_, k) => ({
    id: uid('i_'),
    type: 'mesa-escuela',
    x: (k - (n - 1) / 2) * w,
    z,
    rot: Math.PI,
    chairs: k === n - 1 ? seats - 3 * (n - 1) : 3,
  }));
}

/** Pista de baile: se retiran las mesas más cercanas al escenario y se pone la pista. */
function withDanceFloor(p: Project, items: Item[]): Item[] {
  const D = p.space.depth;
  const size = Math.min(8, p.space.width * 0.35);
  const cz = -D / 2 + 3.6 + size / 2;
  const free = (it: Item) => {
    const def = findDef(it.type, p.customCatalog);
    if (!def || def.category !== 'mesas') return true;
    return !(Math.abs(it.x) < size / 2 + 1.2 && Math.abs(it.z - cz) < size / 2 + 1.2);
  };
  return [...items.filter(free), { id: uid('i_'), type: 'pista-baile', x: 0, z: cz, rot: 0, w: size, d: size }];
}

/** Crea las fases y sus montajes. Sustituye las propuestas actuales. */
export function buildProgram(project: Project, kind: EventKind, pax: number, start?: string, staff = 6): { program: Program; variants: Variant[] } {
  const k = EVENT_KINDS[kind];
  const arch = project.items.filter((i) => isArch(project, i));
  const base: Project = { ...project, items: arch };
  let t = toMin(start || k.start);
  const variants: Variant[] = [];
  const phases: Phase[] = [];
  let prev: Item[] | null = null;
  for (const s of k.steps) {
    const ph: Phase = { id: uid('f_'), name: s.name, start: fmtTime(t), minutes: s.minutes, note: s.note };
    t += s.minutes;
    if ('outside' in s) {
      ph.place = s.outside;
      phases.push(ph);
      continue;
    }
    let items: Item[];
    let layout: LayoutType | '';
    if ('room' in s) {
      const o = { ...defaultOptions(s.room.layout), pax, stage: !!s.room.stage, screen: !!s.room.screen };
      const r = generateLayout(base, o);
      items = [...arch.map((i) => ({ ...i })), ...r.items.map((i) => ({ ...i, id: uid('i_') }) as Item)];
      if (s.room.presidencia) items.push(...presidencia(items, s.room.presidencia));
      if (s.room.pista) items = withDanceFloor(project, items);
      layout = s.room.layout;
    } else {
      const src = prev ?? arch;
      const remove = new Set(s.fromPrev.remove ?? []);
      items = src.filter((i) => !remove.has(i.type)).map((i) => ({ ...i, id: uid('i_') }));
      if (s.fromPrev.addPresidencia && !items.some((i) => i.type === 'mesa-escuela' && i.rot === Math.PI)) items.push(...presidencia(items, s.fromPrev.addPresidencia));
      if (s.fromPrev.pista) items = withDanceFloor(project, items);
      layout = variants[variants.length - 1]?.layout ?? '';
    }
    const v: Variant = { id: uid('v_'), name: s.name, items, lighting: layout === 'banquete' ? 'gala' : project.lighting, layout };
    variants.push(v);
    ph.variantId = v.id;
    phases.push(ph);
    prev = items;
  }
  return { program: { kind, phases, staff }, variants };
}

// ---------- Cambios de montaje ----------

/**
 * Minutos de trabajo de una persona por unidad (montar o retirar). Son estimaciones
 * orientativas: cada hotel debería ajustarlas con sus propios tiempos.
 */
export function unitMinutes(type: string, category?: string): number {
  if (type.startsWith('silla') || type === 'butaca') return 0.4;
  if (type.startsWith('mesa-redonda')) return 4; // con mantel
  const known: Record<string, number> = {
    'mesa-escuela': 1.5,
    'mesa-imperial': 3,
    'mesa-coctel': 1.5,
    buffet: 10,
    barra: 10,
    escenario: 30,
    pantalla: 15,
    atril: 2,
    'pista-baile': 25,
    photocall: 10,
  };
  if (known[type] !== undefined) return known[type];
  if (category === 'mesa-deco') return 0.3;
  return 2;
}

/** Un cambio de hasta 5 minutos (retirar la presidencia, una pantalla) se hace sobre la marcha. */
export const QUICK = 5;

export interface Changeover {
  from: Phase;
  to: Phase;
  removed: { type: string; name: string; n: number }[];
  added: { type: string; name: string; n: number }[];
  personMinutes: number;
  /** Minutos con el personal del programa. */
  minutes: number;
  available: number;
  /** Hay una fase fuera de la sala entre medias (los asistentes no están en la sala). */
  guestsOut: boolean;
  ok: boolean;
}

function counts(project: Project, items: Item[]) {
  const c = new Map<string, number>();
  const add = (t: string, n: number) => c.set(t, (c.get(t) ?? 0) + n);
  for (const it of items) {
    const def = findDef(it.type, project.customCatalog);
    if (!def || def.category === 'arquitectura') continue;
    add(it.type, 1);
    // Las sillas de cada mesa también hay que moverlas
    if (it.chairs) add(it.chairType ?? 'silla', it.chairs);
  }
  return c;
}

export function changeovers(project: Project): Changeover[] {
  const prog = project.program;
  if (!prog) return [];
  const vs = new Map((project.variants ?? []).map((v) => [v.id, v.id === project.activeVariant ? { ...v, items: project.items } : v]));
  const out: Changeover[] = [];
  let last: { ph: Phase; v: Variant } | null = null;
  let outside = false;
  for (const ph of prog.phases) {
    const v = ph.variantId ? vs.get(ph.variantId) : undefined;
    if (!v) {
      outside = true;
      continue;
    }
    if (last) {
      const a = counts(project, last.v.items);
      const b = counts(project, v.items);
      const removed: Changeover['removed'] = [];
      const added: Changeover['added'] = [];
      let pm = 0;
      for (const t of new Set([...a.keys(), ...b.keys()])) {
        const d = (b.get(t) ?? 0) - (a.get(t) ?? 0);
        if (!d) continue;
        const def = findDef(t, project.customCatalog);
        const row = { type: t, name: def?.name ?? t, n: Math.abs(d) };
        (d > 0 ? added : removed).push(row);
        pm += Math.abs(d) * unitMinutes(t, def?.category);
      }
      // Cambiar de tipo de montaje: también hay que mover lo que se queda (recolocar filas)
      if (last.v.layout && v.layout && last.v.layout !== v.layout) {
        for (const [t, n] of b) if (a.has(t)) pm += Math.min(n, a.get(t)!) * unitMinutes(t, findDef(t, project.customCatalog)?.category) * 0.5;
      }
      const minutes = Math.ceil(pm / Math.max(1, prog.staff));
      const available = toMin(ph.start) - (toMin(last.ph.start) + last.ph.minutes);
      out.push({ from: last.ph, to: ph, removed, added, personMinutes: Math.round(pm), minutes, available, guestsOut: outside, ok: minutes <= Math.max(QUICK, available) });
    }
    last = { ph, v };
    outside = false;
  }
  return out;
}

export interface PhaseWarning {
  phaseId: string;
  text: string;
}

/** Avisos por fase: capacidad insuficiente para las personas previstas. */
export function phaseWarnings(project: Project): PhaseWarning[] {
  const prog = project.program;
  const pax = project.event.pax;
  if (!prog || !pax) return [];
  const vs = new Map((project.variants ?? []).map((v) => [v.id, v.id === project.activeVariant ? { ...v, items: project.items } : v]));
  const out: PhaseWarning[] = [];
  for (const ph of prog.phases) {
    const v = ph.variantId ? vs.get(ph.variantId) : undefined;
    if (!v) continue;
    const cap = capacitySummary({ ...project, items: v.items });
    const seatedLayout = v.layout && v.layout !== 'coctel';
    const have = seatedLayout ? cap.seated : cap.total;
    if (have < pax) out.push({ phaseId: ph.id, text: `${seatedLayout ? 'Asientos' : 'Capacidad'}: ${have} para ${pax} personas` });
  }
  return out;
}

export const layoutName = (l: LayoutType | '') => (l ? LAYOUT_INFO[l].name : 'Personalizado');

/** Tipos que el generador sustituiría (para avisar antes de crear el programa). */
export const hasDesign = (p: Project) => generatedTypes(p).length > 0 || (p.variants?.length ?? 0) > 1;
