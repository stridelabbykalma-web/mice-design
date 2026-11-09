import { useState } from 'react';
import { useXR } from '../lib/xr';
import { sceneApi } from './sceneApi';
import { useStore } from '../store';
import { logEvent } from '../lib/usageLog';

/** Botón para entrar con gafas (solo aparece si el navegador las admite, p. ej. Meta Quest). */
export function XrButton() {
  const { supportsAR, supportsVR, mode } = useXR();
  const canEdit = useStore((s) => !s.readOnly && !s.clientMode && !!s.project);
  const liveViewer = useStore((s) => s.readOnly && !s.shareId);
  const lang = useStore((s) => (s.clientMode ? s.project?.event.language : 'es'));
  const [err, setErr] = useState('');
  if (!supportsAR && !supportsVR) return null;
  const L = (es: string, en: string) => (lang === 'en' ? en : es);
  const enter = async (m: 'ar' | 'vr', e: React.MouseEvent, task: 'ver' | 'medir' = 'ver') => {
    (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');
    setErr('');
    try {
      await sceneApi.enterXR?.(m, task);
      logEvent('gafas', task === 'medir' ? 'medir la sala' : m === 'ar' ? 'realidad mixta' : 'realidad virtual');
    } catch (x) {
      setErr((x as Error).message);
    }
  };
  return (
    <details className="menu">
      <summary className="btn" title={L('Ver con gafas de realidad mixta o virtual', 'View with mixed or virtual reality headset')}>
        🥽 {L('Gafas', 'Headset')}
      </summary>
      <div className="menu-list">
        {supportsAR && (
          <button disabled={!!mode} onClick={(e) => enter('ar', e)}>
            {L('Realidad mixta: el montaje en la sala vacía', 'Mixed reality: the setup in the empty room')}
          </button>
        )}
        {supportsAR && canEdit && (
          <button disabled={!!mode} onClick={(e) => enter('ar', e, 'medir')} title="Usa el escaneo de la sala de las gafas (Configuración del espacio) o marca las esquinas con el mando">
            📏 Medir esta sala con las gafas
          </button>
        )}
        {supportsAR && liveViewer && (
          <p className="hint">Para medir la sala con las gafas, emparéjalas con la opción «Móvil o gafas que editan» (la medida se guarda en el proyecto).</p>
        )}
        {supportsVR && (
          <button disabled={!!mode} onClick={(e) => enter('vr', e)}>
            {L('Realidad virtual: recorrer el gemelo digital', 'Virtual reality: walk through the digital twin')}
          </button>
        )}
        {err && <p className="error">{err}</p>}
      </div>
    </details>
  );
}

/**
 * Tarjeta «Medir la sala con las gafas»: en las Quest abre directamente la medición; en un
 * ordenador o un móvil explica cómo hacerlo. `create` crea y abre antes un proyecto nuevo
 * (pantalla de inicio); sin él se mide la sala del proyecto abierto.
 */
export function HeadsetMeasure({ create, viewer }: { create?: () => void; viewer?: boolean }) {
  const { supportsAR, mode } = useXR();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setMsg('');
    setBusy(true);
    try {
      create?.();
      // La escena 3D tarda un instante en montarse al abrir el proyecto
      for (let i = 0; i < 40 && !sceneApi.enterXR; i++) await new Promise((r) => setTimeout(r, 100));
      if (!sceneApi.enterXR) throw new Error('La escena no ha terminado de cargar. Pulsa «🥽 Gafas → Medir esta sala con las gafas».');
      await sceneApi.enterXR('ar', 'medir');
      logEvent('gafas', 'medir la sala');
    } catch (x) {
      setMsg(`${(x as Error).message} Si el proyecto ya está abierto, usa el botón «🥽 Gafas» de arriba y elige «Medir esta sala con las gafas».`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="callout">
      <strong>🥽 Medir la sala con las gafas (Meta Quest 3 / 3S)</strong>
      {supportsAR && !viewer ? (
        <>
          <p className="hint">
            Ponte en la sala. Las gafas leen su escaneo (paredes, puertas, ventanas y techo) o lo hacen en el momento; después se guarda aquí y se diseña en el ordenador.
          </p>
          <button className="btn primary" disabled={busy || !!mode} onClick={start}>
            {create ? 'Crear una sala midiéndola con las gafas' : 'Medir esta sala con las gafas'}
          </button>
        </>
      ) : supportsAR ? (
        <p className="hint">Estas gafas están emparejadas solo para ver. Para medir, emparéjalas de nuevo desde el ordenador con la opción «Móvil o gafas que editan».</p>
      ) : (
        <p className="hint">
          Se hace desde las gafas: abre esta misma dirección en el navegador de las Quest, entra con la cuenta del hotel (o empareja las gafas con la opción «Móvil o gafas que editan») y
          verás aquí el botón para medir. La sala aparece después en este dispositivo.
        </p>
      )}
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}
