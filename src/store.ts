import { create } from 'zustand';
import type { CatalogDef, Item, LightingPreset, Project, Space, Tool, ViewMode, EventInfo } from './types';
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
  snap: boolean;
  clientMode: boolean;
  measure: MeasurePoint[];
  /** Color recogido con el cuentagotas. */
  picked: string | null;
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

let saveTimer: number | undefined;
function scheduleSave(p: Project | null) {
  if (!p) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => db.saveProject({ ...p, updatedAt: Date.now() }), 400);
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
    snap: true,
    clientMode: false,
    measure: [],
    picked: null,
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
      if (p) db.saveProject({ ...p, updatedAt: Date.now() });
      set({ project: null, selection: [] });
    },
    setPanel: (panel) => set({ panel }),
    setView: (view) => set({ view, selection: view === 'paseo' ? [] : get().selection, tool: view === 'paseo' ? 'select' : get().tool, placingType: view === 'paseo' ? null : get().placingType }),
    setTool: (tool) => set({ tool, placingType: tool === 'place' ? get().placingType : null, measure: tool === 'measure' ? get().measure : [] }),
    startPlacing: (type) => set({ tool: 'place', placingType: type, selection: [], view: get().view === 'paseo' ? '3d' : get().view }),
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
      mutate((p) => ({ ...p, space: { ...p.space, ...patch } }));
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
    removeItems: (ids) => {
      if (!ids.length) return;
      get().checkpoint();
      const s = new Set(ids);
      mutate((p) => ({ ...p, items: p.items.filter((i) => !s.has(i.id)) }));
      set({ selection: get().selection.filter((id) => !s.has(id)) });
    },
    duplicate: (ids) => {
      const p = get().project;
      if (!p || !ids.length) return;
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
