// Versión publicada y actualización automática. Los navegadores (sobre todo el de las gafas)
// guardan la página en caché: al abrir la app se pregunta al servidor cuál es la última
// versión y, si es otra, se recarga saltándose la caché.
declare const __BUILD__: string;

export const BUILD: string = typeof __BUILD__ === 'string' ? __BUILD__ : 'desarrollo';

/** Comprueba si hay una versión más nueva; `canReload` evita recargar con un proyecto abierto. */
export async function checkForUpdate(canReload: () => boolean) {
  if (BUILD === 'desarrollo' || location.protocol === 'file:') return;
  try {
    const r = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    const latest = (await r.json()).build as string;
    if (!latest || latest === BUILD || !canReload()) return;
    // Una sola vez por versión, para no entrar en bucle si la caché se resiste
    if (sessionStorage.getItem('mice-updated-to') === latest) return;
    sessionStorage.setItem('mice-updated-to', latest);
    const url = new URL(location.href);
    url.searchParams.set('v', latest.replace(/\D/g, ''));
    location.replace(url.toString());
  } catch {
    /* sin conexión: se sigue con la versión que haya */
  }
}
