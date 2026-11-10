import { BUILD } from '../lib/version';
import type { Project } from '../types';
import { createCode, prettyCode, useAuth } from '../lib/auth';
import { cloudReady } from '../lib/cloud';
import { syncNow } from '../lib/sync';
import { db } from '../lib/db';
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
export function HeadsetMeasure({ create, viewer }: { create?: (roomName: string) => Project; viewer?: boolean }) {
  const { supportsAR, mode } = useXR();
  const hotel = useAuth((a) => a.hotel);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState('');
  const [roomName, setRoomName] = useState('');
  const nameField = create ? (
    <label className="field">
      <span>Nombre de la sala</span>
      <input value={roomName} placeholder="Por ejemplo: Salón Alhambra" onChange={(e) => setRoomName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
    </label>
  ) : null;
  const start = async () => {
    setMsg('');
    setBusy(true);
    try {
      if (create) useStore.getState().openProject(create(roomName));
      // La escena 3D tarda un instante en montarse al abrir el proyecto
      for (let i = 0; i < 40 && !sceneApi.enterXR; i++) await new Promise((r) => setTimeout(r, 100));
      if (!sceneApi.enterXR) throw new Error('La escena no ha terminado de cargar.');
      await sceneApi.enterXR('ar', 'medir');
      logEvent('gafas', 'medir la sala');
    } catch (x) {
      setMsg(`${(x as Error).message} Si el proyecto ya está abierto, usa el botón «🥽 Gafas» de arriba y elige «Medir esta sala con las gafas».`);
    } finally {
      setBusy(false);
    }
  };
  /** Desde el móvil o el ordenador: se deja la sala pendiente de medir y se da un código para las gafas. */
  const getCode = async () => {
    setMsg('');
    setBusy(true);
    try {
      let id: string;
      if (create) {
        const p = { ...create(roomName), measureRequest: true };
        await db.saveProject(p);
        id = p.id;
      } else {
        useStore.getState().patchProject({ measureRequest: true });
        id = useStore.getState().project!.id;
        await new Promise((r) => setTimeout(r, 700));
      }
      await syncNow();
      setCode(await createCode('editor', { project: id, label: 'Gafas (medir la sala)', minutes: 30 }));
    } catch (x) {
      setMsg((x as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const canCode = !!hotel && hotel.role !== 'viewer' && cloudReady();
  return (
    <div className="callout">
      <strong>🥽 Medir la sala con las gafas (Meta Quest 3 / 3S)</strong>
      <span className="muted" style={{ float: 'right', fontSize: 11 }}>v. {BUILD}</span>
      {supportsAR && !viewer ? (
        <>
          <p className="hint">
            Ponte en la sala. Las gafas leen su escaneo (paredes, puertas, ventanas y techo) o lo hacen en el momento; después se guarda aquí y se diseña en el ordenador.
          </p>
          {nameField}
          <button className="btn primary" disabled={busy || !!mode} onClick={start}>
            {create ? 'Crear una sala midiéndola con las gafas' : 'Medir esta sala con las gafas'}
          </button>
        </>
      ) : supportsAR ? (
        <p className="hint">Estas gafas están emparejadas solo para ver. Para medir, pide en el móvil o el ordenador un código con «Medir la sala con las gafas».</p>
      ) : code ? (
        <>
          <div className="device-code">
            <div className="device-code-text" aria-label="Código para las gafas">
              {prettyCode(code)}
            </div>
          </div>
          <ol className="ar-steps">
            <li>
              Ponte las gafas en la sala, abre el navegador y entra en <strong>stridelabbykalma-web.github.io/mice-design</strong>.
            </li>
            <li>
              Pulsa <strong>«Gafas o móvil»</strong>, escribe este código y entra. No hace falta correo ni contraseña en las gafas.
            </li>
            <li>
              Se abre la sala con el botón <strong>«Medir esta sala ahora»</strong>. Al guardar la medida, la sala aparece aquí en unos segundos.
            </li>
          </ol>
          <p className="hint">El código sirve una vez y caduca en 30 minutos. Las gafas quedan emparejadas con el hotel para las siguientes veces.</p>
          <button className="btn small" disabled={busy} onClick={getCode}>
            Otro código
          </button>
        </>
      ) : canCode ? (
        <>
          <p className="hint">Pide aquí un código, escríbelo en las gafas y te llevan directamente a medir la sala. El resultado aparece en este dispositivo.</p>
          {nameField}
          <button className="btn primary" disabled={busy} onClick={getCode}>
            {busy ? 'Preparando…' : create ? 'Crear sala con las gafas: dame el código' : 'Medir esta sala con las gafas: dame el código'}
          </button>
        </>
      ) : (
        <p className="hint">
          Para dar un código a las gafas hay que entrar aquí con la cuenta del hotel (así la sala medida se guarda en el hotel). También puedes abrir esta dirección en el navegador de
          las Quest y entrar allí con la cuenta.
        </p>
      )}
      {msg && <p className="error">{msg}</p>}
    </div>
  );
}

/** En las gafas: aviso con botón cuando la sala abierta está pendiente de medir. */
export function MeasurePrompt() {
  const pending = useStore((s) => !!s.project?.measureRequest && !s.readOnly && !s.clientMode);
  const { supportsAR, mode } = useXR();
  const [err, setErr] = useState('');
  if (!pending || !supportsAR || mode) return null;
  return (
    <div className="hint-bar measure-prompt">
      Esta sala está pendiente de medir con las gafas.
      <button
        className="btn primary"
        onClick={async () => {
          try {
            await sceneApi.enterXR?.('ar', 'medir');
            logEvent('gafas', 'medir la sala');
          } catch (x) {
            setErr((x as Error).message);
          }
        }}
      >
        🥽 Medir esta sala ahora
      </button>
      <button className="link" onClick={() => useStore.getState().patchProject({ measureRequest: undefined })}>
        No hace falta
      </button>
      {err && <span className="error">{err}</span>}
    </div>
  );
}
