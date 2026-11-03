import { create } from 'zustand';
import type { CatalogDef, Guest, Item, LightingPreset, Project, Space, Tool, ViewMode, EventInfo, TableTemplate, Variant } from './types';
import { attachedDecor, decorForTable, isTableDef } from './lib/tables';
import { snapToRoomWall } from './lib/outline';
import { db, uid } from './lib/db';
import { findDef } from './catalog';

interface Snapshot {
  space: Space;
  items: Item[];
}

export interface MeasurePoint {
  x: number;
  y: number;
  z: number;
}

interface State {
  project: Project | null;
  selection: string[];
  view: ViewMode;
  tool: Tool;
  placingType: string | null;
  /** Mesa decorada que se está colocando. */
  placingTemplate: TableTemplate | null;
  snap: boolean;
  clientMode: boolean;
  measure: MeasurePoint[];
  /** Color recogido con el cuentagotas. */
  picked: string | null;
  /** Propuesta abierta desde un enlace (cliente): solo lectura y sin guardar. */
  readOnly: boolean;
  /** Enlace desde el que se ha abierto (cliente) o cuyos comentarios se están viendo (hotel). */
  shareId: string | null;
  /** Comentarios del cliente que se muestran en el plano. */
  comments: { id: string; n: number; x: number; z: number; resolved: boolean; author: string; body: string }[];
  /** El cliente está señalando un punto en el plano para su comentario. */
  pinMode: boolean;
  pendingPin: { x: number; z: number } | null;
  setCloud(patch: Partial<Pick<State, 'readOnly' | 'shareId' | 'comments' | 'pinMode' | 'pendingPin'>>): void;
  /** Sustituye el proyecto abierto por una versión más reciente (sincronización) sin cambiar la vista. */
  replaceProject(p: Project): void;
  /** Vértices del contorno que se está dibujando. */
  drawPts: { x: number; z: number }[];
  setDrawPts(p: { x: number; z: number }[]): void;
  past: Snapshot[];
  future: Snapshot[];
  panel: string;
  showVideo: boolean;

  openProject(p: Project): void;
  closeProject(): void;
  setPanel(p: string): void;
  setView(v: ViewMode): void;
  setTool(t: Tool): void;
  startPlacing(type: string): void;
  startPlacingTemplate(t: TableTemplate): void;
  /** Gira elementos; las mesas giran con su decoración alrededor de su centro. */
  rotateItems(ids: string[], delta: number): void;
  /** Añade a una lista de elementos la decoración de las mesas que incluya. */
  withDecor(ids: string[]): string[];
  /** Añade al proyecto las definiciones del catálogo del hotel que falten. */
  ensureDefs(defs: CatalogDef[]): void;
  /** Aplica una mesa decorada a varias mesas (sustituye su decoración). */
  applyTemplate(tpl: TableTemplate, tableIds: string[]): void;
  /** Invitados del plano de mesas. */
  setGuests(guests: Guest[]): void;
  /** Cambia datos generales del proyecto (por ejemplo, los enlaces compartidos). */
  patchProject(patch: Partial<Project>): void;
  /** Propuestas: crea una copia de la actual (o vacía), cambia, renombra y elimina. */
  createVariant(copy: boolean): void;
  switchVariant(id: string): void;
  renameVariant(id: string, name: string): void;
  deleteVariant(id: string): void;
  /** Coloca una mesa decorada nueva. */
  placeTemplate(tpl: TableTemplate, x: number, z: number): string;
  setSnap(s: boolean): void;
  setClientMode(c: boolean): void;
  setShowVideo(v: boolean): void;
  addMeasurePoint(p: MeasurePoint): void;
  clearMeasure(): void;
  setPicked(c: string | null): void;

  /** Guarda una instantánea para deshacer. */
  checkpoint(): void;
  undo(): void;
  redo(): void;

  updateSpace(patch: Partial<Space>, record?: boolean): void;
  updateEvent(patch: Partial<EventInfo>): void;
  setLighting(l: LightingPreset): void;
  renameProject(name: string, hotel: string): void;

  addItem(item: Omit<Item, 'id'>): string;
  addItems(items: Omit<Item, 'id'>[], replaceTypes?: string[]): void;
  updateItems(ids: string[], fn: (it: Item) => Partial<Item>, record?: boolean): void;
  removeItems(ids: string[]): void;
  duplicate(ids: string[]): void;
  select(ids: string[], additive?: boolean): void;

  addCustomDef(def: CatalogDef): void;
  updateCustomDef(type: string, patch: Partial<CatalogDef>): void;
  removeCustomDef(type: string): void;
}

export const defaultEvent = (): EventInfo => ({
  name: '',
  client: '',
  date: '',
  time: '',
  pax: 0,
  layout: '',
  notes: '',
  pricePerPax: 0,
  roomPrice: 0,
});

export function newProject(space: Space, name: string, hotel: string): Project {
  return {
    id: uid('p_'),
    name,
    hotel,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    space,
    items: [],
    customCatalog: [],
    event: defaultEvent(),
    lighting: space.outdoor ? 'dia' : 'tarde',
  };
}

/**
 * Lista de propuestas con la activa actualizada con el montaje actual. Los proyectos antiguos
 * sin propuestas pasan a tener una «Propuesta A» con su montaje.
 */
export function syncedVariants(p: Project): Variant[] {
  if (!p.variants?.length) return [{ id: p.activeVariant ?? 'v_a', name: 'Propuesta A', items: p.items, lighting: p.lighting, layout: p.event.layout, guests: p.guests }];
  return p.variants.map((v) => (v.id === p.activeVariant ? { ...v, items: p.items, lighting: p.lighting, layout: p.event.layout, guests: p.guests } : v));
}

let saveTimer: number | undefined;
function scheduleSave(p: Project | null) {
  // Una propuesta abierta desde un enlace no se guarda en el navegador del cliente
  if (!p || useStore.getState().readOnly) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const updated = { ...p, updatedAt: Date.now() };
    db.saveProject(updated).then(() => window.dispatchEvent(new Event('mice-saved')));
    // El proyecto en memoria lleva la misma fecha que el guardado (para la sincronización)
    if (useStore.getState().project?.id === p.id) useStore.setState({ project: { ...useStore.getState().project!, updatedAt: updated.updatedAt } });
  }, 400);
}

export const useStore = create<State>((set, get) => {
  /** Aplica un cambio al proyecto y programa el autoguardado. */
  const mutate = (fn: (p: Project) => Project) => {
    const p = get().project;
    if (!p) return;
    const next = fn(p);
    set({ project: next });
    scheduleSave(next);
  };

  return {
    project: null,
    selection: [],
    view: '3d',
    tool: 'select',
    placingType: null,
    placingTemplate: null,
    snap: true,
    clientMode: false,
    measure: [],
    picked: null,
    drawPts: [],
    readOnly: false,
    shareId: null,
    comments: [],
    pinMode: false,
    pendingPin: null,
    setCloud: (patch) => set(patch),
    replaceProject: (p) => set({ project: p, selection: [], past: [], future: [] }),
    setDrawPts: (drawPts) => set({ drawPts }),
    past: [],
    future: [],
    panel: 'espacio',
    showVideo: false,

    openProject: (p) =>
      set({
        project: p,
        selection: [],
        past: [],
        future: [],
        view: '3d',
        tool: 'select',
        placingType: null,
        measure: [],
        clientMode: false,
        panel: p.items.length ? 'catalogo' : 'espacio',
        showVideo: false,
      }),
    closeProject: () => {
      const p = get().project;
      if (p && !get().readOnly) db.saveProject({ ...p, updatedAt: Date.now() });
      set({ project: null, selection: [] });
    },
    setPanel: (panel) => set({ panel }),
    setView: (view) => set({ view, selection: view === 'paseo' ? [] : get().selection, tool: view === 'paseo' ? 'select' : get().tool, placingType: view === 'paseo' ? null : get().placingType }),
    setTool: (tool) => set({ tool, placingType: tool === 'place' ? get().placingType : null, placingTemplate: tool === 'place' ? get().placingTemplate : null, measure: tool === 'measure' ? get().measure : [] }),
    startPlacingTemplate: (t) => {
      get().ensureDefs(t.defs);
      set({ tool: 'place', placingType: t.base.type, placingTemplate: t, selection: [], view: get().view === 'paseo' ? '3d' : get().view });
    },
    rotateItems: (ids, delta) => {
      const p = get().project;
      if (!p) return;
      get().checkpoint();
      const sel = new Set(ids);
      const moves = new Map<string, Partial<Item>>();
      for (const it of p.items) {
        if (!sel.has(it.id)) continue;
        moves.set(it.id, { rot: it.rot + delta });
        if (!isTableDef(findDef(it.type, p.customCatalog))) continue;
        for (const dec of attachedDecor(p, it)) {
          if (sel.has(dec.id)) continue;
          // Giro de la pieza alrededor del centro de la mesa
          const t = (delta * Math.PI) / 180;
          const dx = dec.x - it.x;
          const dz = dec.z - it.z;
          moves.set(dec.id, {
            x: it.x + dx * Math.cos(t) + dz * Math.sin(t),
            z: it.z - dx * Math.sin(t) + dz * Math.cos(t),
            rot: dec.rot + delta,
          });
        }
      }
      mutate((pr) => ({ ...pr, items: pr.items.map((it) => (moves.has(it.id) ? { ...it, ...moves.get(it.id) } : it)) }));
    },
    setGuests: (guests) => mutate((pr) => ({ ...pr, guests })),
    patchProject: (patch) => mutate((pr) => ({ ...pr, ...patch })),
    createVariant: (copy) => {
      const p = get().project;
      if (!p) return;
      const vs = syncedVariants(p);
      const letter = String.fromCharCode(65 + vs.length);
      const idMap: Record<string, string> = {};
      const v: Variant = {
        id: uid('v_'),
        name: `Propuesta ${letter}`,
        items: copy ? p.items.map((i) => ({ ...i, id: (idMap[i.id] = uid('i_')) })) : p.items.filter((i) => findDef(i.type, p.customCatalog)?.category === 'arquitectura').map((i) => ({ ...i, id: uid('i_') })),
        // Los invitados pasan a la nueva propuesta (con su mesa si es una copia)
        guests: (p.guests ?? []).map((g) => ({ ...g, tableId: copy && g.tableId ? idMap[g.tableId] : undefined })),
        lighting: p.lighting,
        layout: copy ? p.event.layout : '',
      };
      set({ past: [], future: [], selection: [] });
      mutate((pr) => ({ ...pr, variants: [...vs, v], activeVariant: v.id, items: v.items, guests: v.guests, event: { ...pr.event, layout: v.layout } }));
    },
    switchVariant: (id) => {
      const p = get().project;
      if (!p || id === p.activeVariant) return;
      const vs = syncedVariants(p);
      const v = vs.find((x) => x.id === id);
      if (!v) return;
      set({ past: [], future: [], selection: [] });
      mutate((pr) => ({ ...pr, variants: vs, activeVariant: id, items: v.items, lighting: v.lighting, guests: v.guests ?? pr.guests?.map((g) => ({ ...g, tableId: undefined })), event: { ...pr.event, layout: v.layout } }));
    },
    renameVariant: (id, name) => mutate((pr) => ({ ...pr, variants: syncedVariants(pr).map((v) => (v.id === id ? { ...v, name } : v)) })),
    deleteVariant: (id) => {
      const p = get().project;
      if (!p) return;
      const vs = syncedVariants(p).filter((v) => v.id !== id);
      if (!vs.length) return;
      const next = id === p.activeVariant ? vs[0] : vs.find((v) => v.id === p.activeVariant)!;
      set({ past: [], future: [], selection: [] });
      mutate((pr) => ({ ...pr, variants: vs, activeVariant: next.id, items: next.items, lighting: next.lighting, guests: next.guests, event: { ...pr.event, layout: next.layout } }));
    },
    withDecor: (ids) => {
      const p = get().project;
      if (!p) return ids;
      const set_ = new Set(ids);
      for (const it of p.items) if (set_.has(it.id) && isTableDef(findDef(it.type, p.customCatalog))) attachedDecor(p, it).forEach((d) => set_.add(d.id));
      return [...set_];
    },
    ensureDefs: (defs) => {
      const p = get().project;
      if (!p || !defs.length) return;
      const have = new Set(p.customCatalog.map((c) => c.type));
      const missing = defs.filter((d) => !have.has(d.type));
      if (missing.length) mutate((pr) => ({ ...pr, customCatalog: [...pr.customCatalog, ...missing] }));
    },
    applyTemplate: (tpl, tableIds) => {
      const p = get().project;
      if (!p) return;
      get().checkpoint();
      get().ensureDefs(tpl.defs);
      const pr = get().project!;
      const ids = new Set(tableIds);
      const tables = pr.items.filter((i) => ids.has(i.id));
      const remove = new Set(tables.flatMap((t) => attachedDecor(pr, t).map((d) => d.id)));
      const { w: _w, d: _d, h: _h, ...base } = tpl.base;
      const updated = pr.items.filter((i) => !remove.has(i.id)).map((i) => (ids.has(i.id) ? { ...i, ...base, type: i.type } : i));
      const decor = tables.flatMap((t) => decorForTable(tpl, { ...t, ...base, type: t.type }));
      mutate((x) => ({ ...x, items: [...updated, ...decor] }));
    },
    placeTemplate: (tpl, x, z) => {
      get().checkpoint();
      get().ensureDefs(tpl.defs);
      const p = get().project!;
      const id = uid('i_');
      const n = p.items.filter((i) => isTableDef(findDef(i.type, p.customCatalog))).length + 1;
      const table: Item = { ...tpl.base, id, x, z, rot: 0, label: `Mesa ${n}` };
      const decor = decorForTable(tpl, table);
      mutate((pr) => ({ ...pr, items: [...pr.items, table, ...decor] }));
      return id;
    },
    startPlacing: (type) => set({ placingTemplate: null, tool: 'place', placingType: type, selection: [], view: get().view === 'paseo' ? '3d' : get().view }),
    setSnap: (snap) => set({ snap }),
    setClientMode: (clientMode) => set({ clientMode, selection: [], tool: 'select', placingType: null }),
    setShowVideo: (showVideo) => set({ showVideo }),
    addMeasurePoint: (pt) => set({ measure: get().measure.length >= 2 ? [pt] : [...get().measure, pt] }),
    clearMeasure: () => set({ measure: [] }),
    setPicked: (picked) => set({ picked }),

    checkpoint: () => {
      const p = get().project;
      if (!p) return;
      const snap = { space: structuredClone(p.space), items: structuredClone(p.items) };
      set({ past: [...get().past.slice(-59), snap], future: [] });
    },
    undo: () => {
      const { past, project } = get();
      if (!past.length || !project) return;
      const prev = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [{ space: project.space, items: project.items }, ...get().future],
        selection: [],
      });
      mutate((p) => ({ ...p, space: prev.space, items: prev.items }));
    },
    redo: () => {
      const { future, project } = get();
      if (!future.length || !project) return;
      const next = future[0];
      set({ future: future.slice(1), past: [...get().past, { space: project.space, items: project.items }], selection: [] });
      mutate((p) => ({ ...p, space: next.space, items: next.items }));
    },

    updateSpace: (patch, record = true) => {
      if (record) get().checkpoint();
      mutate((p) => {
        const space = { ...p.space, ...patch };
        const shapeChanged = 'outline' in patch || 'width' in patch || 'depth' in patch;
        if (!shapeChanged || space.outdoor) return { ...p, space };
        // Puertas, salidas, ventanas y cuadros se reajustan a la pared más cercana de la nueva forma
        const items = p.items.map((it) => {
          const def = findDef(it.type, p.customCatalog);
          if (!def?.wallMount) return it;
          const snap = snapToRoomWall(it.x, it.z, space, it.d ?? def.d);
          return { ...it, x: Math.round(snap.x * 100) / 100, z: Math.round(snap.z * 100) / 100, rot: snap.rot };
        });
        return { ...p, space, items };
      });
    },
    updateEvent: (patch) => mutate((p) => ({ ...p, event: { ...p.event, ...patch } })),
    setLighting: (lighting) => mutate((p) => ({ ...p, lighting })),
    renameProject: (name, hotel) => mutate((p) => ({ ...p, name, hotel })),

    addItem: (item) => {
      get().checkpoint();
      const id = uid('i_');
      const p = get().project!;
      const def = findDef(item.type, p.customCatalog);
      let label = item.label;
      if (!label && def?.category === 'mesas' && def.chairs) {
        const n = p.items.filter((i) => findDef(i.type, p.customCatalog)?.chairs).length + 1;
        label = `Mesa ${n}`;
      }
      mutate((pr) => ({ ...pr, items: [...pr.items, { ...item, id, label }] }));
      return id;
    },
    addItems: (items, replaceTypes) => {
      get().checkpoint();
      mutate((p) => {
        const kept = replaceTypes ? p.items.filter((i) => !replaceTypes.includes(i.type)) : p.items;
        let n = 0;
        const added = items.map((it) => {
          const def = findDef(it.type, p.customCatalog);
          const label = it.label ?? (def?.chairs && def.category === 'mesas' ? `Mesa ${++n}` : undefined);
          return { ...it, id: uid('i_'), label };
        });
        return { ...p, items: [...kept, ...added] };
      });
      set({ selection: [] });
    },
    updateItems: (ids, fn, record = true) => {
      if (record) get().checkpoint();
      const set_ = new Set(ids);
      mutate((p) => ({ ...p, items: p.items.map((it) => (set_.has(it.id) ? { ...it, ...fn(it) } : it)) }));
    },
    removeItems: (idsIn) => {
      if (!idsIn.length) return;
      const ids = get().withDecor(idsIn);
      get().checkpoint();
      const s = new Set(ids);
      mutate((p) => ({ ...p, items: p.items.filter((i) => !s.has(i.id)) }));
      set({ selection: get().selection.filter((id) => !s.has(id)) });
    },
    duplicate: (idsIn) => {
      const p = get().project;
      if (!p || !idsIn.length) return;
      const ids = get().withDecor(idsIn);
      get().checkpoint();
      const s = new Set(ids);
      const copies = p.items.filter((i) => s.has(i.id)).map((i) => ({ ...i, id: uid('i_'), x: i.x + 0.5, z: i.z + 0.5 }));
      mutate((pr) => ({ ...pr, items: [...pr.items, ...copies] }));
      set({ selection: copies.map((c) => c.id) });
    },
    select: (ids, additive = false) => {
      if (!additive) return set({ selection: ids });
      const cur = new Set(get().selection);
      ids.forEach((id) => (cur.has(id) ? cur.delete(id) : cur.add(id)));
      set({ selection: [...cur] });
    },

    addCustomDef: (def) => mutate((p) => ({ ...p, customCatalog: [...p.customCatalog, def] })),
    updateCustomDef: (type, patch) =>
      mutate((p) => ({ ...p, customCatalog: p.customCatalog.map((c) => (c.type === type ? { ...c, ...patch } : c)) })),
    removeCustomDef: (type) =>
      mutate((p) => ({
        ...p,
        customCatalog: p.customCatalog.filter((c) => c.type !== type),
        items: p.items.filter((i) => i.type !== type),
      })),
  };
});
