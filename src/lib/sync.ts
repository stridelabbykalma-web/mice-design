// Sincronización de los datos del hotel con la nube (Supabase), con la sesión iniciada.
// Proyectos, salas y catálogo se mantienen iguales en todos los dispositivos del hotel:
// se diseña en el ordenador, se completan fotos desde el móvil y se ve en directo en las gafas.
// Las gafas (rol «viewer») solo reciben cambios; mientras hay un proyecto abierto se
// consulta cada 2 s para que lo que se mueve en el ordenador aparezca casi al instante.

import { create } from 'zustand';
import type { LibraryEntry, Project } from '../types';
import { CLOUD, cloudReady } from './cloud';
import { authHeaders, authRpc, isViewer, ls, useAuth } from './auth';
import { db, getAsset, projectAssetIds, registerAsset } from './db';
import { useLibrary } from './library';
import { useXR } from './xr';
import { useStore } from '../store';

const BUCKET = 'mice-hotel';
const keyFor = (k: string) => `mice-sync-${useAuth.getState().hotel?.id ?? 'x'}-${k}`;
const readJson = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(ls.get(k) ?? '') as T;
  } catch {
    return d;
  }
};

interface SyncState {
  /** Hotel con el que se sincroniza (null: sin sesión). */
  ws: string | null;
  status: 'off' | 'idle' | 'syncing' | 'error';
  message: string;
  last: number | null;
  /** El proyecto abierto ha cambiado en otro dispositivo y aquí hay cambios sin subir. */
  conflict: boolean;
}

export const useSync = create<SyncState>(() => ({
  ws: useAuth.getState().session ? (useAuth.getState().hotel?.id ?? null) : null,
  status: useAuth.getState().session && useAuth.getState().hotel ? 'idle' : 'off',
  message: '',
  last: null,
  conflict: false,
}));

useAuth.subscribe((st) => {
  const ws = st.session ? (st.hotel?.id ?? null) : null;
  if (ws !== useSync.getState().ws) useSync.setState({ ws, status: ws ? 'idle' : 'off', message: '', last: null });
});

const assetPath = (hotel: string, id: string) => `${hotel}/${id}`;

async function uploadAssets(ws: string, ids: string[]) {
  const done = new Set(readJson<string[]>(keyFor('assets'), []));
  for (const id of ids) {
    if (done.has(id)) continue;
    const a = await getAsset(id);
    if (!a) continue;
    try {
      const res = await fetch(`${CLOUD.url}/storage/v1/object/${BUCKET}/${assetPath(ws, id)}`, {
        method: 'POST',
        headers: await authHeaders({ 'Content-Type': a.mime || 'application/octet-stream', 'x-upsert': 'false' }),
        body: a.blob,
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`);
    } catch (e) {
      // Si ya existe (subido por otro dispositivo) no es un error
      if (!/409|Duplicate|already exists/i.test((e as Error).message)) throw e;
    }
    done.add(id);
    ls.set(keyFor('assets'), JSON.stringify([...done]));
  }
}

async function downloadAssets(ws: string, ids: string[]) {
  const done = new Set(readJson<string[]>(keyFor('assets'), []));
  for (const id of ids) {
    if (await getAsset(id)) continue;
    const res = await fetch(`${CLOUD.url}/storage/v1/object/authenticated/${BUCKET}/${assetPath(ws, id)}`, { headers: await authHeaders() });
    if (!res.ok) continue; // archivo aún no subido por el otro dispositivo: se reintentará
    const blob = await res.blob();
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    registerAsset(id, blob, id, mime);
    await db.saveAsset({ id, name: id, mime, blob });
    done.add(id);
  }
  ls.set(keyFor('assets'), JSON.stringify([...done]));
}

function libraryAssets(e: LibraryEntry): string[] {
  const ids = new Set<string>();
  [e.def, ...(e.table?.defs ?? []), ...(e.room?.defs ?? [])].forEach((d) => d?.modelAssetId && ids.add(d.modelAssetId));
  if (e.room) projectAssetIds({ space: e.room.space, items: e.room.items, customCatalog: e.room.defs } as Project).forEach((i) => ids.add(i));
  return [...ids];
}

interface Row {
  kind: 'project' | 'library';
  id: string;
  updated_at: number;
  deleted: boolean;
  data: Project | LibraryEntry | null;
}

let running = false;
let again = false;

/** Sube los cambios locales y baja los del otro dispositivo. */
export async function syncNow(): Promise<void> {
  const ws = useSync.getState().ws;
  // Una propuesta abierta desde el enlace del cliente no se sincroniza
  if (!ws || !cloudReady() || useStore.getState().shareId) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  useSync.setState({ status: 'syncing' });
  try {
    const pushed = readJson<Record<string, number>>(keyFor('pushed'), {});
    // 1. Bajar cambios
    const since = Number(ls.get(keyFor('pull')) ?? 0);
    const rows = (await authRpc<Row[]>('hotel_pull', { p_hotel: ws, p_since: since })) ?? [];
    let maxSeen = since;
    let libChanged = false;
    for (const r of rows) {
      maxSeen = Math.max(maxSeen, r.updated_at);
      const key = `${r.kind}:${r.id}`;
      if (r.kind === 'project') {
        const local = await db.getProject(r.id);
        if (local && local.updatedAt >= r.updated_at) continue;
        const open = useStore.getState().project;
        const openHere = open?.id === r.id;
        if (r.deleted) {
          if (!openHere) await db.deleteProject(r.id);
          pushed[key] = r.updated_at;
          continue;
        }
        const remote = { ...(r.data as Project), updatedAt: r.updated_at };
        await downloadAssets(ws, projectAssetIds(remote));
        if (openHere) {
          // Si aquí no hay cambios sin subir, se actualiza al momento; si los hay, se avisa.
          const unsynced = !isViewer() && (pushed[key] ?? 0) < (open!.updatedAt ?? 0);
          if (unsynced) {
            useSync.setState({ conflict: true });
            continue;
          }
          useStore.getState().replaceProject(remote);
        }
        await db.saveProject(remote);
        pushed[key] = r.updated_at;
      } else {
        const entry = r.data as LibraryEntry | null;
        if (r.deleted) await db.deleteLibrary(r.id);
        else if (entry) {
          await downloadAssets(ws, libraryAssets(entry));
          await db.saveLibrary({ ...entry, updatedAt: r.updated_at });
        }
        pushed[key] = r.updated_at;
        libChanged = true;
      }
    }
    ls.set(keyFor('pull'), String(maxSeen));
    if (libChanged) await useLibrary.getState().load();

    // 2. Subir cambios (las gafas y pantallas solo miran)
    if (isViewer()) {
      ls.set(keyFor('pushed'), JSON.stringify(pushed));
      useSync.setState({ status: 'idle', last: Date.now(), message: '' });
      return;
    }
    for (const p of await db.listProjects()) {
      const key = `project:${p.id}`;
      if ((pushed[key] ?? 0) >= p.updatedAt) continue;
      await uploadAssets(ws, projectAssetIds(p));
      await authRpc('hotel_push', { p_hotel: ws, p_kind: 'project', p_id: p.id, p_updated: p.updatedAt, p_deleted: false, p_data: p });
      pushed[key] = p.updatedAt;
    }
    for (const e of await db.listLibrary()) {
      const key = `library:${e.id}`;
      const ts = e.updatedAt ?? e.createdAt;
      if ((pushed[key] ?? 0) >= ts) continue;
      await uploadAssets(ws, libraryAssets(e));
      await authRpc('hotel_push', { p_hotel: ws, p_kind: 'library', p_id: e.id, p_updated: ts, p_deleted: false, p_data: e });
      pushed[key] = ts;
    }
    ls.set(keyFor('pushed'), JSON.stringify(pushed));
    useSync.setState({ status: 'idle', last: Date.now(), message: '' });
  } catch (e) {
    useSync.setState({ status: 'error', message: (e as Error).message });
  } finally {
    running = false;
    if (again) {
      again = false;
      syncNow();
    }
  }
}

/** Borra en los demás dispositivos lo que se ha borrado aquí. */
async function pushDeletion(kind: 'project' | 'library', id: string) {
  const ws = useSync.getState().ws;
  if (!ws || !cloudReady()) return;
  try {
    await authRpc('hotel_push', { p_hotel: ws, p_kind: kind, p_id: id, p_updated: Date.now(), p_deleted: true, p_data: null });
  } catch {
    /* sin conexión: se ignora */
  }
}

/** Recarga el proyecto abierto con la versión del otro dispositivo (descarta los cambios locales sin subir). */
export async function acceptRemote() {
  const ws = useSync.getState().ws;
  const open = useStore.getState().project;
  if (!ws || !open) return;
  const rows = (await authRpc<Row[]>('hotel_pull', { p_hotel: ws, p_since: 0 })) ?? [];
  const r = rows.find((x) => x.kind === 'project' && x.id === open.id && !x.deleted);
  if (r) {
    const remote = { ...(r.data as Project), updatedAt: r.updated_at };
    await downloadAssets(ws, projectAssetIds(remote));
    await db.saveProject(remote);
    useStore.getState().replaceProject(remote);
    const pushed = readJson<Record<string, number>>(keyFor('pushed'), {});
    pushed[`project:${r.id}`] = r.updated_at;
    ls.set(keyFor('pushed'), JSON.stringify(pushed));
  }
  useSync.setState({ conflict: false });
}

/** Arranca la sincronización automática: al guardar, cada 2 s con un proyecto abierto (en directo) y cada 15 s si no. */
export function startAutoSync() {
  let t: number | undefined;
  window.addEventListener('mice-saved', () => {
    window.clearTimeout(t);
    t = window.setTimeout(syncNow, 600);
  });
  window.addEventListener('mice-deleted', (e) => {
    const d = (e as CustomEvent<{ kind: 'project' | 'library'; id: string }>).detail;
    pushDeletion(d.kind, d.id);
  });
  let lastRun = 0;
  window.setInterval(() => {
    // Con las gafas puestas la página puede figurar como oculta: se sigue actualizando
    const active = document.visibilityState === 'visible' || !!useXR.getState().mode;
    const every = useStore.getState().project ? 2000 : 15000;
    if (active && Date.now() - lastRun >= every) {
      lastRun = Date.now();
      syncNow();
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  syncNow();
}
