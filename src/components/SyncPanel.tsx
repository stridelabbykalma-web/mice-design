import { useEffect, useMemo, useState } from 'react';
import qrcode from 'qrcode-generator';
import { cloudReady } from '../lib/cloud';
import { acceptRemote, createWorkspace, linkWorkspace, syncNow, unlinkWorkspace, useSync, workspaceFromHash, workspaceLink } from '../lib/sync';
import { useStore } from '../store';
import { ConfirmButton } from './ui';

function Qr({ text }: { text: string }) {
  const src = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createDataURL(5, 2);
  }, [text]);
  return <img className="qr" src={src} alt="Código QR para vincular el móvil" width={200} height={200} />;
}

const ago = (t: number | null) => {
  if (!t) return 'todavía no';
  const s = Math.round((Date.now() - t) / 1000);
  return s < 60 ? `hace ${s} s` : `hace ${Math.round(s / 60)} min`;
};

/** Pantalla de inicio: activar, vincular el móvil por QR y ver el estado. */
export function SyncSection() {
  const { ws, status, message, last } = useSync();
  const [join, setJoin] = useState<string | null>(() => workspaceFromHash());
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  if (!cloudReady())
    return (
      <>
        <h2>Sincronizar con el móvil</h2>
        <p className="muted">Disponible cuando se configure el servidor (Supabase) en la app.</p>
      </>
    );

  return (
    <>
      <h2>Sincronizar con el móvil</h2>
      {join && join !== ws && (
        <div className="card sync-join">
          <strong>¿Vincular este dispositivo al espacio de trabajo del hotel?</strong>
          <p className="muted">Verás aquí los proyectos y el catálogo del otro dispositivo, y lo que hagas aquí (por ejemplo, las fotos de las paredes) aparecerá allí.</p>
          <div className="row gap">
            <button
              className="btn primary"
              onClick={() => {
                linkWorkspace(join);
                history.replaceState(null, '', location.pathname + location.search);
                setJoin(null);
              }}
            >
              Vincular
            </button>
            <button
              className="btn"
              onClick={() => {
                history.replaceState(null, '', location.pathname + location.search);
                setJoin(null);
              }}
            >
              Ahora no
            </button>
          </div>
        </div>
      )}
      {!ws ? (
        <div className="card sync-card">
          <p>
            Trabaja en el ordenador y completa desde el móvil (por ejemplo, las fotos de las paredes): los proyectos, las salas y el catálogo del hotel se mantienen iguales en
            todos los dispositivos vinculados.
          </p>
          <div className="row gap wrap">
            <button className="btn primary" onClick={createWorkspace}>
              Activar la sincronización
            </button>
            <input placeholder="o pega aquí el código de otro dispositivo" value={code} onChange={(e) => setCode(e.target.value.trim())} />
            <button
              className="btn"
              disabled={!code}
              onClick={() => {
                try {
                  linkWorkspace(code.replace(/^.*#ws-/, ''));
                } catch (e) {
                  setErr((e as Error).message);
                }
              }}
            >
              Unirme
            </button>
          </div>
          {err && <p className="error">{err}</p>}
        </div>
      ) : (
        <div className="card sync-card linked">
          <Qr text={workspaceLink(ws)} />
          <div className="sync-info">
            <p>
              <strong>Para añadir el móvil:</strong> escanea este código con la cámara del iPhone y pulsa «Vincular».
            </p>
            <p className={`sync-status ${status}`}>
              {status === 'syncing' ? 'Sincronizando…' : status === 'error' ? `Error: ${message}` : `Sincronizado ${ago(last)}`}
            </p>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => syncNow()}>
                Sincronizar ahora
              </button>
              <ConfirmButton className="btn small" title="Este dispositivo deja de sincronizarse (no se borra nada)" onConfirm={unlinkWorkspace}>
                Desvincular este dispositivo
              </ConfirmButton>
            </div>
            <details className="guide">
              <summary>Código del espacio de trabajo</summary>
              <p className="hint">Quien tenga este código o el QR puede ver y editar los proyectos del hotel. Compártelo solo con el equipo.</p>
              <code className="ws-code">{ws}</code>
            </details>
          </div>
        </div>
      )}
    </>
  );
}

/** Indicador en la barra del editor y aviso si el proyecto cambió en otro dispositivo. */
export function SyncIndicator() {
  const { ws, status, conflict } = useSync();
  const readOnly = useStore((s) => s.readOnly);
  if (!ws || readOnly || !cloudReady()) return null;
  return (
    <>
      <button className={`icon-btn sync-dot ${status}`} title={status === 'error' ? 'Error al sincronizar: pulsa para reintentar' : 'Sincronizado con tus dispositivos'} onClick={() => syncNow()}>
        {status === 'syncing' ? '⟳' : status === 'error' ? '⚠' : '☁'}
      </button>
      {conflict && (
        <div className="sync-conflict">
          Este proyecto se ha cambiado en otro dispositivo y aquí también hay cambios.
          <button className="link" onClick={() => acceptRemote()}>
            Cargar los del otro dispositivo
          </button>
          <button
            className="link"
            onClick={() => {
              useSync.setState({ conflict: false });
              useStore.getState().patchProject({});
            }}
          >
            Mantener los míos
          </button>
        </div>
      )}
    </>
  );
}
