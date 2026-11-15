// Fotos que hace la app de las gafas durante el escaneo: se descargan con el mismo código que
// la sala, se guardan en el proyecto y se sitúan en la planta (dónde y hacia qué pared).
import type { ScanPhoto } from '../types';
import { rpc } from './cloud';
import { addAsset } from './db';
import { rectOutline } from './outline';
import { placePhotos, type PhotoMeta, type ScanResult } from './scanImport';

export async function fetchScanPhotos(code: string, r: ScanResult): Promise<ScanPhoto[]> {
  let list: { idx: number; meta: PhotoMeta }[] = [];
  try {
    list = (await rpc<{ idx: number; meta: PhotoMeta }[]>('scan_photos_list', { p_code: code })) ?? [];
  } catch {
    return [];
  }
  const valid = list.filter((p) => Array.isArray(p.meta?.pos) && Array.isArray(p.meta?.rot));
  if (!valid.length) return [];
  const outline = r.outline ?? rectOutline(r.width, r.depth);
  const placed = placePhotos(r.frame, outline, valid.map((p) => p.meta));
  const out: ScanPhoto[] = [];
  for (let i = 0; i < valid.length; i++) {
    try {
      const b64 = await rpc<string>('scan_photo_get', { p_code: code, p_idx: valid[i].idx });
      if (!b64) continue;
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
      const assetId = await addAsset(new File([bytes], `foto-${valid[i].idx + 1}.jpg`, { type: 'image/jpeg' }), `foto-${valid[i].idx + 1}.jpg`);
      out.push({ assetId, ...placed[i] });
    } catch {
      /* una foto que falla no impide traer las demás */
    }
  }
  return out;
}

/** Nombre de la pared para el pie de la foto (mismo número que en la planta). */
export function wallName(wall: number | undefined, polygon: boolean) {
  if (wall === undefined) return 'pared sin identificar';
  if (polygon) return `pared ${wall + 1}`;
  return ['pared del frente', 'pared derecha', 'pared del fondo', 'pared izquierda'][wall] ?? `pared ${wall + 1}`;
}
