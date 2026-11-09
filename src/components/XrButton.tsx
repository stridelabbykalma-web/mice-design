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
          <p className="hint">Para medir la sala con las gafas, emparéjalas con permiso «Diseña y edita» (el medido se guarda en el proyecto).</p>
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
