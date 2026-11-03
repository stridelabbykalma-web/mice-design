// Catálogo del hotel: lo que se digitaliza una vez y se reutiliza en todos los eventos.
import { create } from 'zustand';
import type { CatalogDef, LibraryEntry, LibraryKind } from '../types';
import { db, getAsset, uid } from './db';

interface LibState {
  entries: LibraryEntry[];
  loaded: boolean;
  load(): Promise<void>;
  add(kind: LibraryKind, name: string, data: Partial<LibraryEntry>): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
  rename(id: string, name: string): Promise<void>;
}

export const useLibrary = create<LibState>((set, get) => ({
  entries: [],
  loaded: false,
  load: async () => set({ entries: await db.listLibrary(), loaded: true }),
  add: async (kind, name, data) => {
    const e: LibraryEntry = { id: uid('l_'), kind, name, createdAt: Date.now(), updatedAt: Date.now(), ...data };
    await db.saveLibrary(e);
    window.dispatchEvent(new Event('mice-saved'));
    set({ entries: [e, ...get().entries] });
    return e;
  },
  remove: async (id) => {
    await db.deleteLibrary(id);
    window.dispatchEvent(new CustomEvent('mice-deleted', { detail: { kind: 'library', id } }));
    set({ entries: get().entries.filter((e) => e.id !== id) });
  },
  rename: async (id, name) => {
    const e = get().entries.find((x) => x.id === id);
    if (!e) return;
    const n = { ...e, name, updatedAt: Date.now() };
    await db.saveLibrary(n);
    window.dispatchEvent(new Event('mice-saved'));
    set({ entries: get().entries.map((x) => (x.id === id ? n : x)) });
  },
}));

/** Guarda un mueble escaneado en el catálogo del hotel (si no estaba ya). */
export async function saveFurnitureToLibrary(def: CatalogDef) {
  const lib = useLibrary.getState();
  if (!lib.loaded) await lib.load();
  if (useLibrary.getState().entries.some((e) => e.kind === 'mueble' && e.def?.type === def.type)) return;
  await useLibrary.getState().add('mueble', def.name, { def });
}

// ---------- Copia de seguridad del catálogo del hotel (.mice-hotel.json) ----------

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

function entryAssets(e: LibraryEntry): string[] {
  const ids = new Set<string>();
  const defs = [e.def, ...(e.table?.defs ?? []), ...(e.room?.defs ?? [])];
  defs.forEach((d) => d?.modelAssetId && ids.add(d.modelAssetId));
  e.table?.decor.forEach((d) => d.imageAssetId && ids.add(d.imageAssetId));
  const sp = e.room?.space;
  if (sp) {
    [sp.underlay?.assetId, sp.model?.assetId, sp.floorPhoto?.assetId, sp.ceilingPhoto?.assetId, ...Object.values(sp.wallPhotos ?? {}).map((w) => w?.assetId)].forEach(
      (id) => id && ids.add(id),
    );
    e.room?.items.forEach((i) => i.imageAssetId && ids.add(i.imageAssetId));
  }
  return [...ids];
}

export async function exportLibrary(): Promise<Blob> {
  const entries = useLibrary.getState().entries;
  const assets: Record<string, { name: string; mime: string; data: string }> = {};
  for (const e of entries)
    for (const id of entryAssets(e)) {
      if (assets[id]) continue;
      const a = await getAsset(id);
      if (a) assets[id] = { name: a.name, mime: a.mime, data: await blobToDataUrl(a.blob) };
    }
  return new Blob([JSON.stringify({ format: 'mice-hotel', version: 1, entries, assets })], { type: 'application/json' });
}

export async function importLibrary(file: File) {
  const payload = JSON.parse(await file.text());
  if (payload.format !== 'mice-hotel') throw new Error('El archivo no es un catálogo de hotel de MICE Design.');
  for (const [id, a] of Object.entries(payload.assets as Record<string, { name: string; mime: string; data: string }>)) {
    const blob = await (await fetch(a.data)).blob();
    await db.saveAsset({ id, name: a.name, mime: a.mime, blob });
  }
  for (const e of payload.entries as LibraryEntry[]) await db.saveLibrary(e);
  await useLibrary.getState().load();
  return (payload.entries as LibraryEntry[]).length;
}
