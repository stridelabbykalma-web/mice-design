// Descarga de imagen satélite (teselas Esri World Imagery) y geocodificación (OpenStreetMap Nominatim).

export const SAT_ATTRIBUTION = 'Imágenes satélite: Esri, Maxar, Earthstar Geographics y la comunidad GIS · Geocodificación: © OpenStreetMap';

export async function geocode(query: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('No se pudo contactar con el servicio de búsqueda.');
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('tile'));
    img.src = src;
  });
}

/**
 * Compone una imagen satélite centrada en (lat, lon) que cubre `sizeM` metros de lado.
 * Devuelve la imagen y el ancho real que representa.
 */
export async function satelliteImage(lat: number, lon: number, sizeM: number): Promise<{ blob: Blob; widthM: number }> {
  // Elegimos el zoom para que la zona quepa en ~1024 px.
  const mppAt = (z: number) => (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
  let z = 19;
  while (z > 14 && sizeM / mppAt(z) > 1100) z--;
  const mpp = mppAt(z);
  const px = Math.min(2048, Math.ceil(sizeM / mpp));
  const n = 2 ** z;
  const xt = ((lon + 180) / 360) * n;
  const latR = (lat * Math.PI) / 180;
  const yt = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n;
  const cx = xt * 256;
  const cy = yt * 256;
  const x0 = cx - px / 2;
  const y0 = cy - px / 2;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  const jobs: Promise<void>[] = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + px) / 256); tx++)
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + px) / 256); ty++) {
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${ty}/${tx}`;
      jobs.push(loadImage(url).then((img) => ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0)));
    }
  const results = await Promise.allSettled(jobs);
  if (results.every((r) => r.status === 'rejected')) throw new Error('No se pudo descargar la imagen satélite (¿sin conexión?). Puedes subir una captura en su lugar.');
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas'))), 'image/jpeg', 0.9));
  return { blob, widthM: px * mpp };
}
