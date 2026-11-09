// Persistencia local en IndexedDB: proyectos y archivos (planos, modelos 3D, vídeos).
import type { LibraryEntry, Project } from '../types';

const BASE_DB = 'mice-design';
const DB_VERSION = 2;

/**
 * Cada hotel con sesión iniciada tiene su propia base de datos local, para que los proyectos
 * de un hotel no aparezcan en otro si se comparte el ordenador. Sin cuenta se usa la de siempre.
 */
export function localDbName(): string {
  try {
    const h = JSON.parse(localStorage.getItem('mice-hotel') ?? 'null') as { id?: string } | null;
    return h?.id ? `${BASE_DB}-h-${h.id}` : BASE_DB;
  } catch {
    return BASE_DB;
  }
}

export interface StoredAsset {
  id: string;
  name: string;
  mime: string;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openNamed(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(name, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      // Catálogo del hotel compartido por todos los proyectos (muebles, mesas decoradas, salas)
      if (!db.objectStoreNames.contains('library')) db.createObjectStore('library', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= openNamed(localDbName());
  return dbPromise;
}

function getAllFrom<T>(d: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = d.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

/** Proyectos guardados en este navegador sin cuenta (para pasarlos al hotel). */
export async function countLocalWithoutAccount(): Promise<number> {
  if (localDbName() === BASE_DB) return 0;
  try {
    const d = await openNamed(BASE_DB);
    const n = (await getAllFrom<Project>(d, 'projects')).length + (await getAllFrom<LibraryEntry>(d, 'library')).length;
    d.close();
    return n;
  } catch {
    return 0;
  }
}

/** Copia al hotel los proyectos, el catálogo y los archivos guardados sin cuenta. */
export async function copyLocalWithoutAccount(): Promise<number> {
  const d = await openNamed(BASE_DB);
  const projects = await getAllFrom<Project>(d, 'projects');
  const library = await getAllFrom<LibraryEntry>(d, 'library');
  const assets = await getAllFrom<StoredAsset>(d, 'assets');
  d.close();
  for (const a of assets) await db.saveAsset(a);
  // Fecha nueva para que se suban a la nube en la siguiente sincronización
  const now = Date.now();
  for (const p of projects) if (!(await db.getProject(p.id))) await db.saveProject({ ...p, updatedAt: now });
  for (const e of library) await db.saveLibrary({ ...e, updatedAt: now });
  window.dispatchEvent(new Event('mice-saved'));
  return projects.length + library.length;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const db = {
  async listProjects(): Promise<Project[]> {
    try {
      const all = await tx<Project[]>('projects', 'readonly', (s) => s.getAll() as IDBRequest<Project[]>);
      return all.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  },
  async getProject(id: string): Promise<Project | undefined> {
    try {
      return await tx<Project | undefined>('projects', 'readonly', (s) => s.get(id) as IDBRequest<Project | undefined>);
    } catch {
      return undefined;
    }
  },
  saveProject(p: Project) {
    return tx('projects', 'readwrite', (s) => s.put(p)).catch(() => undefined);
  },
  deleteProject(id: string) {
    return tx('projects', 'readwrite', (s) => s.delete(id)).catch(() => undefined);
  },
  async listLibrary(): Promise<LibraryEntry[]> {
    try {
      const all = await tx<LibraryEntry[]>('library', 'readonly', (s) => s.getAll() as IDBRequest<LibraryEntry[]>);
      return all.sort((a, b) => b.createdAt - a.createdAt);
    } catch {
      return [];
    }
  },
  saveLibrary(e: LibraryEntry) {
    return tx('library', 'readwrite', (s) => s.put(e)).catch(() => undefined);
  },
  deleteLibrary(id: string) {
    return tx('library', 'readwrite', (s) => s.delete(id)).catch(() => undefined);
  },
  saveAsset(a: StoredAsset) {
    return tx('assets', 'readwrite', (s) => s.put(a)).catch(() => undefined);
  },
  getAsset(id: string): Promise<StoredAsset | undefined> {
    return tx<StoredAsset | undefined>('assets', 'readonly', (s) => s.get(id) as IDBRequest<StoredAsset | undefined>).catch(
      () => undefined,
    );
  },
};

// Caché en memoria de URLs de objeto para los assets.
const urlCache = new Map<string, string>();
const memAssets = new Map<string, StoredAsset>();

export function uid(prefix = '') {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** Registra en memoria un archivo descargado (propuestas compartidas) con su id original. */
export function registerAsset(id: string, blob: Blob, name: string, mime: string) {
  memAssets.set(id, { id, name, mime, blob });
}

export async function addAsset(file: Blob, name: string): Promise<string> {
  const id = uid('a_');
  const asset: StoredAsset = { id, name, mime: file.type || 'application/octet-stream', blob: file };
  memAssets.set(id, asset);
  await db.saveAsset(asset);
  return id;
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  if (memAssets.has(id)) return memAssets.get(id);
  const a = await db.getAsset(id);
  if (a) memAssets.set(id, a);
  return a;
}

export async function assetUrl(id: string): Promise<string | undefined> {
  if (urlCache.has(id)) return urlCache.get(id);
  const a = await getAsset(id);
  if (!a) return undefined;
  const url = URL.createObjectURL(a.blob);
  urlCache.set(id, url);
  return url;
}

// ---------- Exportar / importar proyecto completo (.mice.json) ----------

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

export function projectAssetIds(p: Project): string[] {
  const ids = new Set<string>();
  if (p.space.underlay) ids.add(p.space.underlay.assetId);
  if (p.space.model) ids.add(p.space.model.assetId);
  if (p.space.splat) ids.add(p.space.splat.assetId);
  if (p.space.videoAssetId) ids.add(p.space.videoAssetId);
  p.customCatalog.forEach((c) => c.modelAssetId && ids.add(c.modelAssetId));
  Object.values(p.space.wallPhotos ?? {}).forEach((w) => w && ids.add(w.assetId));
  if (p.space.floorPhoto) ids.add(p.space.floorPhoto.assetId);
  if (p.space.ceilingPhoto) ids.add(p.space.ceilingPhoto.assetId);
  Object.values(p.space.edgePhotos ?? {}).forEach((w) => ids.add(w.assetId));
  p.items.forEach((i) => i.imageAssetId && ids.add(i.imageAssetId));
  // También las imágenes de las propuestas y fases que no están en pantalla
  p.variants?.forEach((v) => v.items.forEach((i) => i.imageAssetId && ids.add(i.imageAssetId)));
  return [...ids];
}

export async function exportProject(p: Project, includeVideo = false): Promise<Blob> {
  const assets: Record<string, { name: string; mime: string; data: string }> = {};
  for (const id of projectAssetIds(p)) {
    if (!includeVideo && id === p.space.videoAssetId) continue;
    const a = await getAsset(id);
    if (a) assets[id] = { name: a.name, mime: a.mime, data: await blobToDataUrl(a.blob) };
  }
  const payload = { format: 'mice-design', version: 1, project: p, assets };
  return new Blob([JSON.stringify(payload)], { type: 'application/json' });
}

export async function importProject(file: File): Promise<Project> {
  const payload = JSON.parse(await file.text());
  if (payload.format !== 'mice-design') throw new Error('El archivo no es un proyecto de MICE Design.');
  for (const [id, a] of Object.entries(payload.assets as Record<string, { name: string; mime: string; data: string }>)) {
    const blob = await (await fetch(a.data)).blob();
    const asset = { id, name: a.name, mime: a.mime, blob };
    memAssets.set(id, asset);
    await db.saveAsset(asset);
  }
  const p = payload.project as Project;
  p.updatedAt = Date.now();
  await db.saveProject(p);
  return p;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
