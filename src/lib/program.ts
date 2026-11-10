// Programa del evento por fases: cada tipo de evento MICE sigue una secuencia típica
// (ver docs/estructura-eventos-mice.md). Cada fase en la sala es una propuesta (montaje)
// propia; entre fases se calcula el cambio de montaje: qué se retira, qué se monta, cuánto
// personal y tiempo hace falta y si el tiempo disponible alcanza.

import type { Item, LayoutType, Project, Variant } from '../types';
import { findDef } from '../catalog';
import { defaultOptions, generateLayout, generatedTypes, LAYOUT_INFO } from './layouts';
import { capacitySummary, obbOf } from './safety';
import { insideSpace } from './outline';
import { obbOverlap } from './geometry';
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
/** `at`: hora habitual de la fase (comida, cena); si el programa va adelantado, se espera hasta esa hora. */
type Step = { name: string; minutes: number; note?: string; at?: string } & (
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
      { name: 'Comida', minutes: 75, outside: 'Restaurante', at: '13:30' },
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
      { name: 'Comida', minutes: 60, outside: 'Restaurante', at: '14:00' },
      { name: 'Talleres de tarde', minutes: 120, at: '16:00', room: { layout: 'u', screen: true } },
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
      { name: 'Comida de trabajo', minutes: 75, outside: 'Otra sala o terraza (cóctel)', at: '14:00' },
      { name: 'Sesiones de tarde', minutes: 120, fromPrev: {}, at: '16:00' },
      { name: 'Clausura y premios', minutes: 45, fromPrev: { addPresidencia: 5 } },
      { name: 'Cóctel previo a la cena', minutes: 75, outside: 'Vestíbulo o jardín', at: '20:00' },
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
      { name: 'Grupos de trabajo', minutes: 90, outside: 'Salas pequeñas' },
      { name: 'Comida', minutes: 90, outside: 'Restaurante', at: '14:00' },
      { name: 'Actividad de equipo', minutes: 150, outside: 'Exterior o sala diáfana', at: '16:30' },
      { name: 'Cóctel', minutes: 60, outside: 'Vestíbulo o terraza', at: '20:00' },
      { name: 'Cena de clausura y premios', minutes: 150, room: { layout: 'banquete', stage: true } },
      { name: 'Fiesta', minutes: 120, fromPrev: { pista: true }, note: 'Se retiran las mesas de la zona de la pista' },
    ],
  },
  presentacion: {
    name: 'Presentación de producto',
    description: 'Recepción con demostraciones, presentación con desvelado y networking.',
    start: '19:00',
    steps: [
      { name: 'Recepción', minutes: 45, outside: 'Vestíbulo (photocall y teaser)' },
      { name: 'Presentación y desvelado', minutes: 45, room: { layout: 'teatro', stage: true, screen: true }, note: 'Producto tapado en el escenario' },
      { name: 'Demostraciones y networking', minutes: 90, outside: 'Vestíbulo (puntos de demostración y barra)', note: 'En la misma zona de la recepción: no da tiempo a cambiar la sala con los invitados dentro' },
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
      { name: 'Comida', minutes: 60, outside: 'Restaurante', at: '14:00' },
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

/** Mesa de presidencia de cara al público: en el escenario o, si no lo hay, delante de la pantalla. */
function presidencia(p: Project, items: Item[], seats: number): Item[] {
  const stage = items.find((i) => i.type === 'escenario');
  const w = 1.8;
  const z = stage ? stage.z - (stage.d ?? 2.4) / 2 + 0.9 : -p.space.depth / 2 + 1.2;
  // No más mesas de las que caben en el escenario (o en el frente de la sala)
  const maxW = stage ? (stage.w ?? 3) : p.space.width * 0.5;
  const n = Math.max(1, Math.min(Math.ceil(seats / 3), Math.floor(maxW / w) || 1));
  const tables: Item[] = Array.from({ length: n }, (_, k) => ({
    id: uid('i_'),
    type: 'mesa-escuela',
    x: (k - (n - 1) / 2) * w,
    z,
    rot: 180,
    chairs: Math.max(1, Math.min(3, seats - 3 * k)),
  }));
  if (!stage && !tables.every((t) => insideSpace({ x: t.x, z: t.z, w, d: 1.3, rot: 0 }, p.space, 0))) return [];
  // El atril se aparta a un lado si la mesa lo pisa
  const atril = items.find((i) => i.type === 'atril');
  if (atril && Math.abs(atril.x) < (n * w) / 2 + 0.5 && Math.abs(atril.z - z) < 1.2) atril.x = Math.min((n * w) / 2 + 0.6, maxW / 2 - 0.3);
  return tables;
}

/** Pista de baile: se retiran las mesas que pisa y se pone la pista, siempre dentro de la sala. */
function withDanceFloor(p: Project, items: Item[]): Item[] {
  const { width: W, depth: D } = p.space;
  const blockers = items.filter((i) => i.type === 'escenario' || i.type === 'columna' || i.type === 'tabique' || i.type === 'obstaculo').map((i) => obbOf(i, findDef(i.type, p.customCatalog), false));
  let best: { x: number; z: number; size: number } | null = null;
  // Lo más grande que quepa (de 8 m a 3 m), lo más cerca posible del frente y centrado
  for (let size = Math.max(2, Math.min(8, W * 0.35, D * 0.5)); size >= 2 && !best; size -= 0.5) {
    const want = { x: 0, z: Math.min(-D / 2 + 3.6 + size / 2, 0) };
    let bd = Infinity;
    // Rejilla simétrica respecto al centro de la sala, para que la pista quede centrada
    const nx = Math.floor((W / 2 - size / 2 - 0.3) / 0.5);
    for (let z = want.z - Math.floor((want.z + D / 2 - size / 2 - 0.3) / 0.5) * 0.5; z <= D / 2 - size / 2 - 0.3; z += 0.5)
      for (let x = -nx * 0.5; x <= nx * 0.5 + 1e-9; x += 0.5) {
        const box = { x, z, w: size, d: size, rot: 0 };
        if (!insideSpace(box, p.space, 0) || blockers.some((o) => obbOverlap(o, box))) continue;
        const d = Math.hypot(x - want.x, z - want.z);
        if (d < bd) {
          bd = d;
          best = { x, z, size };
        }
      }
  }
  if (!best) return items;
  const f = best;
  const free = (it: Item) => {
    const def = findDef(it.type, p.customCatalog);
    if (!def || def.category !== 'mesas') return true;
    return !(Math.abs(it.x - f.x) < f.size / 2 + 1.2 && Math.abs(it.z - f.z) < f.size / 2 + 1.2);
  };
  return [...items.filter(free), { id: uid('i_'), type: 'pista-baile', x: f.x, z: f.z, rot: 0, w: f.size, d: f.size }];
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
    if (s.at && toMin(s.at) > t) t = toMin(s.at);
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
      let o = { ...defaultOptions(s.room.layout), pax, stage: !!s.room.stage, screen: !!s.room.screen };
      let r = generateLayout(base, o);
      // La U y la imperial son para grupos pequeños: si no caben, se prueba la otra, escuela y teatro
      if (r.pax < pax && (s.room.layout === 'u' || s.room.layout === 'imperial'))
        for (const alt of [s.room.layout === 'u' ? 'imperial' : 'u', 'escuela', 'teatro'] as const) {
          const o2 = { ...defaultOptions(alt), pax, stage: !!s.room.stage, screen: !!s.room.screen };
          const r2 = generateLayout(base, o2);
          if (r2.pax > r.pax) {
            o = o2;
            r = r2;
            ph.note = [s.note, `Montaje en ${LAYOUT_INFO[alt].name.toLowerCase()} porque en ${LAYOUT_INFO[s.room.layout].name.toLowerCase()} no caben ${pax} personas`].filter(Boolean).join(' · ');
          }
          if (r.pax >= pax) break;
        }
      items = [...arch.map((i) => ({ ...i })), ...r.items.map((i) => ({ ...i, id: uid('i_') }) as Item)];
      if (s.room.presidencia) items.push(...presidencia(project, items, s.room.presidencia));
      if (s.room.pista) items = withDanceFloor(project, items);
      layout = o.type;
    } else {
      const src = prev ?? arch;
      const remove = new Set(s.fromPrev.remove ?? []);
      items = src.filter((i) => !remove.has(i.type)).map((i) => ({ ...i, id: uid('i_') }));
      if (s.fromPrev.addPresidencia && !items.some((i) => i.type === 'mesa-escuela' && i.rot === 180)) items.push(...presidencia(project, items, s.fromPrev.addPresidencia));
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
/** Retirar unas mesas para abrir la pista se hace con los invitados en la sala si no pasa de 15 minutos. */
export const LIVE = 15;

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
  /** Solo se retiran piezas y es corto: se hace con los asistentes en la sala (abrir la pista de baile). */
  live: boolean;
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
      let available = toMin(ph.start) - (toMin(last.ph.start) + last.ph.minutes);
      // Programas que pasan de medianoche
      if (available < -720) available += 1440;
      const live = !outside && available < minutes && minutes <= LIVE && added.every((r) => r.type === 'pista-baile');
      out.push({ from: last.ph, to: ph, removed, added, personMinutes: Math.round(pm), minutes, available, guestsOut: outside, live, ok: live || minutes <= Math.max(QUICK, available) });
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
    // Con pista de baile no hace falta un asiento por persona
    if (v.items.some((i) => i.type === 'pista-baile')) continue;
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
