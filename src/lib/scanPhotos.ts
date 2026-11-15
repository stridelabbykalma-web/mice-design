// Fotos que hace la app de las gafas durante el escaneo: se descargan con el mismo código que
// la sala, se guardan en el proyecto y se sitúan en la planta (dónde y hacia qué pared).
import type { PhotoTexture, ScanPhoto, WallSide } from '../types';
import { rpc } from './cloud';
import { addAsset } from './db';
import { rectOutline } from './outline';
import { placePhotos, type PhotoMeta, type ScanResult } from './scanImport';
import { cameraIntrinsics, wallTexture, type CameraPhoto, type Pixels } from './wallTextures';

export interface ScanPhotoResult {
  scanPhotos: ScanPhoto[];
  /** Foto de cada tramo de pared (salas con forma) o de cada lado (salas rectangulares). */
  edgePhotos?: Record<string, PhotoTexture>;
  wallPhotos?: Partial<Record<WallSide, PhotoTexture>>;
}

type Meta = PhotoMeta & { w?: number; h?: number; intr?: number[] };

export async function fetchScanPhotos(code: string, r: ScanResult, onProgress?: (msg: string) => void): Promise<ScanPhotoResult> {
  let list: { idx: number; meta: Meta }[] = [];
  try {
    list = (await rpc<{ idx: number; meta: Meta }[]>('scan_photos_list', { p_code: code })) ?? [];
  } catch {
    return { scanPhotos: [] };
  }
  const valid = list.filter((p) => Array.isArray(p.meta?.pos) && Array.isArray(p.meta?.rot));
  if (!valid.length) return { scanPhotos: [] };
  const outline = r.outline ?? rectOutline(r.width, r.depth);
  const placed = placePhotos(r.frame, outline, valid.map((p) => p.meta));
  const out: ScanPhoto[] = [];
  const cams: CameraPhoto[] = [];
  for (let i = 0; i < valid.length; i++) {
    onProgress?.(`Trayendo las fotos (${i + 1} de ${valid.length})…`);
    try {
      const b64 = await rpc<string>('scan_photo_get', { p_code: code, p_idx: valid[i].idx });
      if (!b64) continue;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      const file = new File([bytes], `foto-${valid[i].idx + 1}.jpg`, { type: 'image/jpeg' });
      const assetId = await addAsset(file, `foto-${valid[i].idx + 1}.jpg`);
      out.push({ assetId, ...placed[i] });
      const img = await decode(file);
      if (img) cams.push(cameraPhoto(valid[i].meta, img));
    } catch {
      /* una foto que falla no impide traer las demás */
    }
  }
  const res: ScanPhotoResult = { scanPhotos: out };
  if (cams.length) {
    onProgress?.('Pintando las paredes con las fotos…');
    await new Promise((ok) => setTimeout(ok, 30));
    try {
      Object.assign(res, await paintWalls(r, outline, cams));
    } catch (e) {
      console.warn('Fotos de las paredes', e);
    }
  }
  return res;
}

function cameraPhoto(m: Meta, img: Pixels): CameraPhoto {
  const k = m.intr && m.intr.length >= 6 ? { fx: m.intr[0], fy: m.intr[1], cx: m.intr[2], cy: m.intr[3], sw: m.intr[4], sh: m.intr[5] } : undefined;
  return { pos: m.pos, rot: m.rot, ...cameraIntrinsics(img.width, img.height, k), img };
}

async function decode(file: Blob): Promise<Pixels | null> {
  try {
    const bmp = await createImageBitmap(file);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0);
    bmp.close?.();
    const d = ctx.getImageData(0, 0, c.width, c.height);
    return { width: d.width, height: d.height, data: d.data };
  } catch {
    return null;
  }
}

async function encode(p: Pixels): Promise<Blob | null> {
  const c = document.createElement('canvas');
  c.width = p.width;
  c.height = p.height;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.data), p.width, p.height), 0, 0);
  return new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.85));
}

const RECT_SIDES: WallSide[] = ['norte', 'este', 'sur', 'oeste'];

async function paintWalls(r: ScanResult, outline: { x: number; z: number }[], cams: CameraPhoto[]): Promise<Omit<ScanPhotoResult, 'scanPhotos'>> {
  // Altura del suelo en el escaneo: la de la sala de Meta o, si no la hay, la de los ojos menos 1,55 m
  const ys = cams.map((c) => c.pos[1]).sort((a, b) => a - b);
  const y = r.frame.y ?? ys[Math.floor(ys.length / 2)] - 1.55;
  const frame = { ...r.frame, y };
  // Las fotos de las gafas salen oscuras en salas con poca luz: se aclaran todas por igual
  let sum = 0;
  let cnt = 0;
  for (const c of cams)
    for (let o = 0; o < c.img.data.length; o += 4 * 97) {
      sum += 0.299 * c.img.data[o] + 0.587 * c.img.data[o + 1] + 0.114 * c.img.data[o + 2];
      cnt++;
    }
  const gain = Math.min(2.2, Math.max(1, 115 / Math.max(1, sum / Math.max(1, cnt))));
  const edge: Record<string, PhotoTexture> = {};
  for (let i = 0; i < outline.length; i++) {
    const t = wallTexture(outline, i, r.height, frame, cams);
    if (!t) continue;
    if (gain > 1.02) for (let o = 0; o < t.data.length; o += 4) for (let ch = 0; ch < 3; ch++) t.data[o + ch] = 255 * Math.pow(t.data[o + ch] / 255, 1 / gain);
    const blob = await encode(t);
    if (!blob) continue;
    const assetId = await addAsset(new File([blob], `pared-${i + 1}.jpg`, { type: 'image/jpeg' }), `pared-${i + 1}.jpg`);
    edge[r.outline ? `e${i}` : RECT_SIDES[i]] = { assetId };
    await new Promise((ok) => setTimeout(ok, 0));
  }
  if (!Object.keys(edge).length) return {};
  return r.outline ? { edgePhotos: edge } : { wallPhotos: edge as Partial<Record<WallSide, PhotoTexture>> };
}

/** Nombre de la pared para el pie de la foto (mismo número que en la planta). */
export function wallName(wall: number | undefined, polygon: boolean) {
  if (wall === undefined) return 'pared sin identificar';
  if (polygon) return `pared ${wall + 1}`;
  return ['pared del frente', 'pared derecha', 'pared del fondo', 'pared izquierda'][wall] ?? `pared ${wall + 1}`;
}
