import { useState } from 'react';
import { useStore } from '../store';
import { AR_ANCHORS, ArAnchor, exportArUsdz, isIOS, openQuickLook } from '../lib/arExport';
import { downloadBlob } from '../lib/db';
import { Field, Toggle } from './ui';
import { logEvent } from '../lib/usageLog';

/** Ver el montaje a tamaño real en la sala con el iPhone o el iPad (AR Quick Look). */
export function ArModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const hasDoor = project.items.some((i) => i.type === 'puerta' || i.type === 'salida');
  const [anchor, setAnchor] = useState<ArAnchor>(hasDoor ? 'puerta' : 'esquina');
  const [outline, setOutline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const ios = isIOS();

  const go = async () => {
    setBusy(true);
    setMsg('');
    try {
      const blob = await exportArUsdz(project, { anchor, outline });
      logEvent('realidad aumentada', ios ? 'abrir en el iPhone' : 'descargar .usdz');
      if (ios) openQuickLook(blob);
      else {
        downloadBlob(blob, `${(project.event.name || project.name).replace(/[^\p{L}\p{N}]+/gu, '-')}.usdz`);
        setMsg('Archivo descargado. Ábrelo en el iPhone o iPad (AirDrop, Archivos) o abre este proyecto en el iPhone con la sincronización y pulsa aquí el mismo botón.');
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <div className="order-overlay">
      <div className="order-actions">
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <article className="compare-sheet ar-sheet">
        <h1>Ver el montaje en la sala (realidad aumentada)</h1>
        <p className="muted">
          Con el iPhone o el iPad, el montaje aparece a tamaño real en la sala vacía y puedes caminar entre las mesas. Solo se muestra lo que se va a montar: las paredes,
          puertas, columnas y cuadros son los reales.
        </p>
        <Field label="Punto de referencia" hint={AR_ANCHORS[anchor].help}>
          <select value={anchor} onChange={(e) => setAnchor(e.target.value as ArAnchor)}>
            {(Object.keys(AR_ANCHORS) as ArAnchor[]).map((k) => (
              <option key={k} value={k} disabled={k === 'puerta' && !hasDoor}>
                {AR_ANCHORS[k].label}
              </option>
            ))}
          </select>
        </Field>
        <Toggle checked={outline} onChange={setOutline} label="Mostrar en el suelo el contorno de la sala (para encajarlo con las paredes)" />
        <ol className="ar-steps">
          <li>Ve al punto de referencia en la sala real con el {ios ? 'dispositivo' : 'iPhone o iPad'}.</li>
          <li>Pulsa «{ios ? 'Abrir en realidad aumentada' : 'Descargar para iPhone'}», apunta al suelo y toca justo en ese punto.</li>
          <li>Gira el montaje con dos dedos hasta que la línea azul del contorno coincida con las paredes.</li>
          <li>Camina por la sala: las mesas se quedan fijas en su sitio a escala real.</li>
        </ol>
        <button className="btn primary" onClick={go} disabled={busy}>
          {busy ? 'Preparando…' : ios ? 'Abrir en realidad aumentada' : 'Descargar para iPhone (.usdz)'}
        </button>
        {msg && <p className="hint">{msg}</p>}
      </article>
    </div>
  );
}
