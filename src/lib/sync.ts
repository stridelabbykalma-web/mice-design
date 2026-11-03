// Sincronización entre dispositivos (ordenador ↔ móvil) mediante un «espacio de trabajo»
// del hotel en Supabase. Cada dispositivo vinculado guarda el identificador del espacio
// (secreto, compartido por QR). Se sincronizan proyectos y catálogo del hotel con sus archivos.

import { create } from 'zustand';
import type { LibraryEntry, Project } from '../types';
import { CLOUD, PUBLIC_APP_URL, cloudReady, headers, rest, rpc } from './cloud';
import { db, getAsset, projectAssetIds, registerAsset } from './db';
import { useLibrary } from './library';
import { useStore } from '../store';

const KEY = 'mice-ws';
const PULL = 'mice-ws-pull';
const PUSHED = 'mice-ws-pushed';
const UPLOADED = 'mice-ws-assets';

const ls = {
  get(k: string) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* almacenamiento no disponible */
    }
  },
};
const readJson = <T>(k: string, d: T): T => {
  try {
    return JSON.parse(ls.get(k) ?? '') as T;
  } catch {
    return d;
  }
};

interface SyncState {
  ws: string | null;
  status: 'off' | 'idle' | 'syncing' | 'error';
  message: string;
  last: number | null;
  /** El proyecto abierto ha cambiado en otro dispositivo y aquí hay cambios sin subir. */
  conflict: boolean;
}

export const useSync = create<SyncState>(() => ({
  ws: ls.get(KEY),
  status: ls.get(KEY) ? 'idle' : 'off',
  message: '',
  last: null,
  conflict: false,
}));

const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function workspaceLink(ws: string) {
  const real = /^https?:/.test(location.protocol) && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('localhost');
  return `${real ? location.origin + location.pathname : PUBLIC_APP_URL}#ws-${ws}`;
}

export function workspaceFromHash() {
  const m = location.hash.match(/^#ws-([0-9a-f-]{36})$/i);
  return m && isUuid(m[1]) ? m[1] : null;
}

export function createWorkspace() {
  linkWorkspace(crypto.randomUUID());
}

export function linkWorkspace(ws: string) {
  if (!isUuid(ws)) throw new Error('El código no es válido.');
  ls.set(KEY, ws);
  ls.set(PULL, '0');
  ls.set(PUSHED, '{}');
  useSync.setState({ ws, status: 'idle', message: '' });
  syncNow();
}

export function unlinkWorkspace() {
  [KEY, PULL, PUSHED, UPLOADED].forEach((k) => ls.set(k, null));
  useSync.setState({ ws: null, status: 'off', message: '', last: null });
}

const assetPath = (ws: string, id: string) => `ws/${ws}/${id}`;

async function uploadAssets(ws: string, ids: string[]) {
  const done = new Set(readJson<string[]>(UPLOADED, []));
  for (const id of ids) {
    if (done.has(id)) continue;
    const a = await getAsset(id);
    if (!a) continue;
    try {
      await rest(`/storage/v1/object/${CLOUD.bucket}/${assetPath(ws, id)}`, {
        method: 'POST',
        headers: headers({ 'Content-Type': a.mime || 'application/octet-stream', 'x-upsert': 'false', 'x-mice-name': encodeURIComponent(a.name) }),
        body: a.blob,
      });
    } catch (e) {
      // Si ya existe (subido por otro dispositivo) no es un error
      if (!/409|Duplicate|already exists/i.test((e as Error).message)) throw e;
    }
    done.add(id);
    ls.set(UPLOADED, JSON.stringify([...done]));
  }
}

async function downloadAssets(ws: string, ids: string[]) {
  const done = new Set(readJson<string[]>(UPLOADED, []));
  for (const id of ids) {
    if (await getAsset(id)) continue;
    const res = await rest(`/storage/v1/object/public/${CLOUD.bucket}/${assetPath(ws, id)}`, { headers: headers() });
    const blob = await res.blob();
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    registerAsset(id, blob, id, mime);
    await db.saveAsset({ id, name: id, mime, blob });
    done.add(id);
  }
  ls.set(UPLOADED, JSON.stringify([...done]));
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
  if (!ws || !cloudReady() || useStore.getState().readOnly) return;
  if (running) {
    again = true;
    return;
  }
  running = true;
  useSync.setState({ status: 'syncing' });
  try {
    const pushed = readJson<Record<string, number>>(PUSHED, {});
    // 1. Bajar cambios
    const since = Number(ls.get(PULL) ?? 0);
    const rows = (await rpc<Row[]>('ws_pull', { p_ws: ws, p_since: since })) ?? [];
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
          const unsynced = (pushed[key] ?? 0) < (open!.updatedAt ?? 0);
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
    ls.set(PULL, String(maxSeen));
    if (libChanged) await useLibrary.getState().load();

    // 2. Subir cambios
    for (const p of await db.listProjects()) {
      const key = `project:${p.id}`;
      if ((pushed[key] ?? 0) >= p.updatedAt) continue;
      await uploadAssets(ws, projectAssetIds(p));
      await rpc('ws_push', { p_ws: ws, p_kind: 'project', p_id: p.id, p_updated: p.updatedAt, p_deleted: false, p_data: p });
      pushed[key] = p.updatedAt;
    }
    for (const e of await db.listLibrary()) {
      const key = `library:${e.id}`;
      const ts = e.updatedAt ?? e.createdAt;
      if ((pushed[key] ?? 0) >= ts) continue;
      await uploadAssets(ws, libraryAssets(e));
      await rpc('ws_push', { p_ws: ws, p_kind: 'library', p_id: e.id, p_updated: ts, p_deleted: false, p_data: e });
      pushed[key] = ts;
    }
    ls.set(PUSHED, JSON.stringify(pushed));
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
    await rpc('ws_push', { p_ws: ws, p_kind: kind, p_id: id, p_updated: Date.now(), p_deleted: true, p_data: null });
  } catch {
    /* sin conexión: se ignora */
  }
}

/** Recarga el proyecto abierto con la versión del otro dispositivo (descarta los cambios locales sin subir). */
export async function acceptRemote() {
  const ws = useSync.getState().ws;
  const open = useStore.getState().project;
  if (!ws || !open) return;
  const rows = (await rpc<Row[]>('ws_pull', { p_ws: ws, p_since: 0 })) ?? [];
  const r = rows.find((x) => x.kind === 'project' && x.id === open.id && !x.deleted);
  if (r) {
    const remote = { ...(r.data as Project), updatedAt: r.updated_at };
    await downloadAssets(ws, projectAssetIds(remote));
    await db.saveProject(remote);
    useStore.getState().replaceProject(remote);
    const pushed = readJson<Record<string, number>>(PUSHED, {});
    pushed[`project:${r.id}`] = r.updated_at;
    ls.set(PUSHED, JSON.stringify(pushed));
  }
  useSync.setState({ conflict: false });
}

/** Arranca la sincronización automática (al guardar, cada 15 s y al volver a la app). */
export function startAutoSync() {
  let t: number | undefined;
  window.addEventListener('mice-saved', () => {
    window.clearTimeout(t);
    t = window.setTimeout(syncNow, 2500);
  });
  window.addEventListener('mice-deleted', (e) => {
    const d = (e as CustomEvent<{ kind: 'project' | 'library'; id: string }>).detail;
    pushDeletion(d.kind, d.id);
  });
  window.setInterval(() => document.visibilityState === 'visible' && syncNow(), 15000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
  syncNow();
}
