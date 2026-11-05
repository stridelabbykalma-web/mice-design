// Compartir propuestas con el cliente mediante Supabase (base de datos + archivos).
// Solo se usa la clave pública (publishable); la seguridad la ponen las reglas de
// supabase/schema.sql: nadie puede listar propuestas, solo abrirlas con su enlace.

import type { Project } from '../types';
import { getAsset, projectAssetIds, registerAsset } from './db';

/** Configuración del proyecto de Supabase (la URL y la clave pública no son secretas). */
const DEFAULT_URL = 'https://czpzvcrwejkgtwsvgxpr.supabase.co';

/** Para pruebas: localStorage «mice-cloud-url» apunta la app a otro servidor. */
function cloudUrl() {
  try {
    return localStorage.getItem('mice-cloud-url') || DEFAULT_URL;
  } catch {
    return DEFAULT_URL;
  }
}

export const CLOUD = {
  url: cloudUrl(),
  key: 'sb_publishable_r50ep5iXZrEVUyLnc1ckXQ_67LcGFio',
  bucket: 'mice-assets',
};

/** Dirección pública de la app, para los enlaces que se envían al cliente. */
export const PUBLIC_APP_URL = 'https://stridelabbykalma-web.github.io/mice-design/';

export const cloudReady = () => !CLOUD.url.includes('REEMPLAZAR');

export const headers = (extra: Record<string, string> = {}) => ({ apikey: CLOUD.key, Authorization: `Bearer ${CLOUD.key}`, ...extra });

export async function rest(path: string, init: RequestInit) {
  const res = await fetch(`${CLOUD.url}${path}`, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Error ${res.status} del servidor${text ? `: ${text.slice(0, 200)}` : ''}`);
  }
  return res;
}

export async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const res = await rest(`/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(args) });
  const text = await res.text();
  return (text ? JSON.parse(text) : null) as T;
}

export interface ShareComment {
  id: string;
  share_id: string;
  created_at: string;
  author: string;
  body: string;
  variant?: string | null;
  x?: number | null;
  z?: number | null;
  resolved: boolean;
}

/** Enlace que se envía al cliente. */
export function shareLink(id: string) {
  const here = typeof location !== 'undefined' && /^https?:/.test(location.protocol) && !location.hostname.endsWith('claude.ai') && !location.hostname.includes('localhost');
  const base = here ? location.origin + location.pathname : PUBLIC_APP_URL;
  return `${base}#p-${id}`;
}

export function sharedIdFromHash(): string | null {
  const m = typeof location !== 'undefined' ? location.hash.match(/^#p-([0-9a-f-]{36})$/i) : null;
  return m ? m[1] : null;
}

/**
 * Publica una copia de la propuesta para el cliente: sube los archivos que usa (escaneos,
 * fotos, modelos) y guarda el proyecto. Devuelve el identificador del enlace.
 */
export async function publishShare(project: Project, opts: { includeGuests: boolean }, onProgress?: (msg: string) => void): Promise<string> {
  const id = crypto.randomUUID();
  const copy: Project = structuredClone(project);
  if (!opts.includeGuests) {
    delete copy.guests;
    copy.variants = copy.variants?.map((v) => ({ ...v, guests: undefined }));
  }
  delete (copy as Partial<Project>).shares;
  const ids = projectAssetIds(copy);
  const assets: Record<string, { name: string; mime: string; path: string }> = {};
  let n = 0;
  for (const aid of ids) {
    const a = await getAsset(aid);
    if (!a) continue;
    n++;
    onProgress?.(`Subiendo archivos ${n}/${ids.length}…`);
    const path = `${id}/${aid}`;
    await rest(`/storage/v1/object/${CLOUD.bucket}/${path}`, {
      method: 'POST',
      headers: headers({ 'Content-Type': a.mime || 'application/octet-stream', 'x-upsert': 'false' }),
      body: a.blob,
    });
    assets[aid] = { name: a.name, mime: a.mime, path };
  }
  onProgress?.('Guardando la propuesta…');
  await rest('/rest/v1/shares', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ id, title: project.event.name || project.name, project: { format: 'mice-design', version: 1, project: copy, assets } }),
  });
  return id;
}

/** Abre una propuesta compartida: descarga el proyecto y sus archivos. */
export async function loadShare(id: string, onProgress?: (msg: string) => void): Promise<Project> {
  const row = await rpc<{ project: { project: Project; assets: Record<string, { name: string; mime: string; path: string }> } } | null>('get_share', { p_id: id });
  if (!row) throw new Error('No se ha encontrado la propuesta. Comprueba el enlace.');
  const entries = Object.entries(row.project.assets ?? {});
  let n = 0;
  for (const [aid, a] of entries) {
    n++;
    onProgress?.(`Descargando ${n}/${entries.length}…`);
    const res = await rest(`/storage/v1/object/public/${CLOUD.bucket}/${a.path}`, { headers: headers() });
    registerAsset(aid, await res.blob(), a.name, a.mime);
  }
  return row.project.project;
}

export const listComments = (shareId: string) => rpc<ShareComment[]>('get_comments', { p_share: shareId });

export async function addComment(c: Omit<ShareComment, 'id' | 'created_at' | 'resolved'>) {
  await rest('/rest/v1/share_comments', {
    method: 'POST',
    headers: headers({ 'Content-Type': 'application/json', Prefer: 'return=minimal' }),
    body: JSON.stringify({ id: crypto.randomUUID(), ...c }),
  });
}

export const setResolved = (commentId: string, shareId: string, resolved: boolean) =>
  rpc<null>('set_comment_resolved', { p_comment: commentId, p_share: shareId, p_resolved: resolved });
