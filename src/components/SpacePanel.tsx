import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import type { SpaceMethod, WallSide } from '../types';
import { addAsset, assetUrl, downloadBlob } from '../lib/db';
import { loadGltf } from './Furniture';
import { requestRectify } from './Rectify';
import { openPhotoMeasure } from './PhotoMeasure';
import { parseRoomPlan } from '../lib/roomplan';
import { geocode, satelliteImage, SAT_ATTRIBUTION } from '../lib/satellite';
import { makeZip } from '../lib/zip';
import { DEG } from '../lib/geometry';
import { Field, FileButton, NumberInput, Section, Toggle, m } from './ui';

const METHOD_LABEL: Record<SpaceMethod, string> = {
  plano: 'Plano',
  fotogrametria: 'Fotogrametría / escaneo',
  satelite: 'Vista satélite',
  video: 'Vídeo',
};

function imageAspect(file: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve(img.naturalHeight / img.naturalWidth || 1);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => resolve(1);
    img.src = url;
  });
}

export default function SpacePanel() {
  const project = useStore((s) => s.project)!;
  const updateSpace = useStore((s) => s.updateSpace);
  const measure = useStore((s) => s.measure);
  const setTool = useStore((s) => s.setTool);
  const { space } = project;
  const [realDist, setRealDist] = useState(5);

  const measured = measure.length === 2 ? Math.hypot(measure[1].x - measure[0].x, measure[1].z - measure[0].z) : 0;

  const setUnderlayFile = async (f: File, widthM: number) => {
    const id = await addAsset(f, f.name);
    const aspect = await imageAspect(f);
    updateSpace({ underlay: { assetId: id, widthM, aspect, opacity: 0.85, offsetX: 0, offsetZ: 0, rotation: 0 } });
  };

  const order: SpaceMethod[] = [space.method, ...(['plano', 'fotogrametria', 'satelite', 'video'] as SpaceMethod[]).filter((x) => x !== space.method)];

  return (
    <div className="panel">
      <Section title="Espacio" badge={METHOD_LABEL[space.method]}>
        <Field label="Nombre del espacio">
          <input value={space.name} onChange={(e) => updateSpace({ name: e.target.value }, false)} />
        </Field>
        <div className="grid3">
          <Field label="Ancho (X)">
            <NumberInput value={space.width} min={2} max={300} onChange={(width) => updateSpace({ width })} suffix="m" />
          </Field>
          <Field label="Fondo (Z)">
            <NumberInput value={space.depth} min={2} max={300} onChange={(depth) => updateSpace({ depth })} suffix="m" />
          </Field>
          <Field label="Altura">
            <NumberInput value={space.height} min={2} max={30} onChange={(height) => updateSpace({ height })} suffix="m" />
          </Field>
        </div>
        <RoomPlanImport />
        <div className="callout">
          <strong>📏 ¿No tienes las medidas?</strong>
          <p className="hint">
            Mide un tramo grande de una pared (con la app Medidas del móvil o un metro), hazle una foto a la pared entera y la app calcula su ancho y su alto.
          </p>
          <div className="row gap">
            <FileButton accept="image/*" camera className="btn small" onFile={openPhotoMeasure}>
              📷 Medir una pared con foto
            </FileButton>
            <FileButton accept="image/*" className="btn small ghost" onFile={openPhotoMeasure}>
              Subir foto
            </FileButton>
          </div>
        </div>
        <p className="hint">
          Superficie: <strong>{m(space.width * space.depth, 1)} m²</strong>. El frente del espacio (escenario, pantalla) se sitúa en la pared superior de la vista en planta.
        </p>
        <div className="row gap wrap">
          <Toggle checked={space.outdoor} onChange={(outdoor) => updateSpace({ outdoor, showWalls: !outdoor })} label="Espacio exterior" />
          {!space.outdoor && <Toggle checked={space.showWalls} onChange={(showWalls) => updateSpace({ showWalls })} label="Mostrar paredes" />}
        </div>
        <div className="grid2">
          <Field label="Color del suelo">
            <input type="color" value={space.floorColor} onChange={(e) => updateSpace({ floorColor: e.target.value }, false)} />
          </Field>
          {!space.outdoor && (
            <Field label="Color de paredes">
              <input type="color" value={space.wallColor} onChange={(e) => updateSpace({ wallColor: e.target.value }, false)} />
            </Field>
          )}
        </div>
        <p className="hint">Añade columnas, puertas, salidas de emergencia y ventanas desde Catálogo → Elementos del espacio.</p>
      </Section>

      <RealSurfaces />

      {order.map((method) => {
        const primary = method === space.method;
        if (method === 'plano')
          return (
            <Section key={method} title="📐 Plano del hotel" defaultOpen={primary}>
              <p className="hint">Sube el plano como imagen (PNG o JPG; exporta el PDF a imagen). Se coloca en el suelo a escala real.</p>
              <FileButton accept="image/*" onFile={(f) => setUnderlayFile(f, space.width)}>
                {space.underlay && space.method !== 'satelite' ? 'Cambiar imagen del plano' : 'Subir plano (imagen)'}
              </FileButton>
              {space.underlay && <UnderlayControls />}
              {space.underlay && (
                <div className="callout">
                  <strong>Calibrar la escala</strong>
                  <ol>
                    <li>
                      Activa{' '}
                      <button className="link" onClick={() => setTool('measure')}>
                        la herramienta Medir
                      </button>{' '}
                      y marca dos puntos del plano cuya distancia conozcas (por ejemplo, una cota).
                    </li>
                    <li>Escribe la distancia real y pulsa Aplicar.</li>
                  </ol>
                  <div className="row gap">
                    <span className="muted">Medido: {measured ? `${m(measured)} m` : '—'}</span>
                    <NumberInput value={realDist} min={0.1} onChange={setRealDist} suffix="m" />
                    <button
                      className="btn small"
                      disabled={!measured}
                      onClick={() => {
                        const u = space.underlay!;
                        const k = realDist / measured;
                        updateSpace({ underlay: { ...u, widthM: u.widthM * k, offsetX: u.offsetX * k, offsetZ: u.offsetZ * k } });
                        useStore.getState().clearMeasure();
                      }}
                    >
                      Aplicar
                    </button>
                  </div>
                </div>
              )}
            </Section>
          );
        if (method === 'fotogrametria') return <PhotogrammetrySection key={method} primary={primary} />;
        if (method === 'satelite') return <SatelliteSection key={method} primary={primary} onImage={setUnderlayFile} />;
        return <VideoSection key={method} primary={primary} />;
      })}
    </div>
  );
}

function UnderlayControls() {
  const project = useStore((s) => s.project)!;
  const updateSpace = useStore((s) => s.updateSpace);
  const u = project.space.underlay!;
  const set = (patch: Partial<typeof u>, record = true) => updateSpace({ underlay: { ...u, ...patch } }, record);
  return (
    <div className="sub">
      <div className="grid2">
        <Field label="Ancho real de la imagen">
          <NumberInput value={u.widthM} min={1} onChange={(widthM) => set({ widthM })} suffix="m" />
        </Field>
        <Field label="Rotación">
          <NumberInput value={u.rotation} step={1} onChange={(rotation) => set({ rotation })} suffix="°" />
        </Field>
        <Field label="Desplazar X">
          <NumberInput value={u.offsetX} onChange={(offsetX) => set({ offsetX })} suffix="m" />
        </Field>
        <Field label="Desplazar Z">
          <NumberInput value={u.offsetZ} onChange={(offsetZ) => set({ offsetZ })} suffix="m" />
        </Field>
      </div>
      <Field label={`Opacidad (${Math.round(u.opacity * 100)} %)`}>
        <input type="range" min={0.1} max={1} step={0.05} value={u.opacity} onChange={(e) => set({ opacity: parseFloat(e.target.value) }, false)} />
      </Field>
      <div className="row gap">
        <button className="btn small" onClick={() => updateSpace({ width: Math.round(u.widthM * 100) / 100, depth: Math.round(u.widthM * u.aspect * 100) / 100 })}>
          Ajustar el espacio a la imagen
        </button>
        <button className="btn small danger" onClick={() => updateSpace({ underlay: undefined })}>
          Quitar imagen
        </button>
      </div>
    </div>
  );
}

function PhotogrammetrySection({ primary }: { primary: boolean }) {
  const project = useStore((s) => s.project)!;
  const updateSpace = useStore((s) => s.updateSpace);
  const { space } = project;
  const mdl = space.model;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  /** Centra el modelo, lo apoya en el suelo y ajusta las medidas del espacio a su huella. */
  const autoFit = async (assetId: string, scale: number, rotation: number, name: string, tilt?: number) => {
    const src = await loadGltf(assetId);
    const prevTilt = tilt ?? (useStore.getState().project?.space.model?.assetId === assetId ? useStore.getState().project?.space.model?.tilt ?? 0 : 0);
    const holder = new THREE.Group();
    holder.add(src.clone(true));
    holder.rotation.x = prevTilt * DEG;
    holder.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(scale);
    const c = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    const r = rotation * DEG;
    const cx = c.x * Math.cos(r) + c.z * Math.sin(r);
    const cz = -c.x * Math.sin(r) + c.z * Math.cos(r);
    const swap = Math.abs(Math.sin(r)) > 0.7;
    const prev = useStore.getState().project?.space.model;
    const keep = prev && prev.assetId === assetId ? prev : { realColors: true, brightness: 1, emptyInterior: false, keepBand: 0.4, keepCeiling: 1 };
    updateSpace({
      model: { ...keep, tilt: prevTilt, assetId, name, scale, rotation, offsetX: -cx, offsetY: -box.min.y * scale, offsetZ: -cz },
      width: Math.round((swap ? size.z : size.x) * 100) / 100,
      depth: Math.round((swap ? size.x : size.z) * 100) / 100,
      height: Math.max(2.2, Math.round(size.y * 100) / 100),
      showWalls: false,
    });
    return size;
  };

  return (
    <Section title="📷 Fotogrametría / escaneo 3D" defaultOpen={primary}>
      <p className="hint">
        Importa el espacio reconstruido en formato <strong>.glb</strong>. Puedes obtenerlo con apps de captura como Polycam, Scaniverse o RealityScan (móvil, con o sin LiDAR) o
        con programas de fotogrametría como Meshroom o RealityCapture a partir de una sesión de fotos.
      </p>
      <FileButton
        accept=".glb,.gltf,.ply,model/gltf-binary"
        onFile={async (f) => {
          setBusy(true);
          setMsg('');
          try {
            const id = await addAsset(f, f.name);
            const size = await autoFit(id, 1, 0, f.name);
            setMsg(`Modelo cargado: ${m(size.x)} × ${m(size.z)} × ${m(size.y)} m. Si las medidas no son reales, corrige la escala.`);
          } catch {
            setMsg('No se pudo leer el modelo. Exporta el escaneo en .glb (recomendado) o .ply.');
          }
          setBusy(false);
        }}
      >
        {busy ? 'Cargando…' : mdl ? 'Cambiar modelo 3D' : 'Importar escaneo de la sala (.glb / .ply)'}
      </FileButton>
      <details className="guide">
        <summary>Cómo capturar la sala para que sea un doble exacto</summary>
        <ul>
          <li>Ilumina la sala de forma uniforme (todas las luces encendidas, cortinas como estarán el día del evento) y no uses flash.</li>
          <li>Recorre todo el perímetro con un solape del 60-70 % entre fotos y repite a dos alturas (1,0 y 1,7 m) y una pasada mirando al techo.</li>
          <li>Acércate a cuadros, molduras, apliques y papel pintado para que la textura tenga detalle; evita superficies en movimiento.</li>
          <li>Puedes escanear con los muebles puestos: después activa «Vaciar la sala» y monta encima con el mobiliario escaneado del hotel.</li>
          <li>Exporta en .glb con texturas en alta resolución (4K si la app lo permite) y comprueba la escala midiendo una puerta.</li>
        </ul>
      </details>
      {msg && <p className="hint">{msg}</p>}
      {mdl && (
        <div className="sub">
          <p className="muted">Modelo: {mdl.name}</p>
          <div className="grid2">
            <Field label="Escala" hint="1 = el modelo ya está en metros">
              <NumberInput value={mdl.scale} step={0.01} min={0.001} onChange={(scale) => autoFit(mdl.assetId, scale, mdl.rotation, mdl.name)} />
            </Field>
            <Field label="Rotación">
              <NumberInput value={mdl.rotation} step={1} onChange={(rotation) => autoFit(mdl.assetId, mdl.scale, rotation, mdl.name)} suffix="°" />
            </Field>
            <Field label="Desplazar X">
              <NumberInput value={mdl.offsetX} onChange={(offsetX) => updateSpace({ model: { ...mdl, offsetX } })} suffix="m" />
            </Field>
            <Field label="Desplazar Z">
              <NumberInput value={mdl.offsetZ} onChange={(offsetZ) => updateSpace({ model: { ...mdl, offsetZ } })} suffix="m" />
            </Field>
            <Field label="Altura del suelo">
              <NumberInput value={mdl.offsetY} step={0.01} onChange={(offsetY) => updateSpace({ model: { ...mdl, offsetY } })} suffix="m" />
            </Field>
          </div>
          <p className="hint">
            Consejo: mide con la herramienta <em>Medir</em> una distancia conocida del modelo (una puerta suele medir 0,8–0,9 m por hoja) y corrige la escala.
          </p>
          <Field label="Eje vertical" hint="Si la sala aparece tumbada, el escaneo se exportó con otro eje hacia arriba.">
            <select value={mdl.tilt ?? 0} onChange={(e) => autoFit(mdl.assetId, mdl.scale, mdl.rotation, mdl.name, parseFloat(e.target.value))}>
              <option value={0}>Correcto (Y hacia arriba)</option>
              <option value={-90}>Corregir: Z hacia arriba</option>
              <option value={90}>Corregir: −Z hacia arriba</option>
            </select>
          </Field>
          <h4 className="sub-title">Gemelo digital</h4>
          <Toggle
            checked={mdl.realColors !== false}
            onChange={(realColors) => updateSpace({ model: { ...mdl, realColors } })}
            label="Colores y texturas reales, tal como se capturaron"
          />
          <p className="hint">
            Activado, la sala se ve exactamente como en el escaneo (pinturas, papel pintado, molduras, suelos) y los ambientes de luz no la alteran. Desactívalo para simular
            la iluminación del evento sobre la sala.
          </p>
          <Field label={`Brillo (${Math.round((mdl.brightness ?? 1) * 100)} %)`}>
            <input type="range" min={0.5} max={1.6} step={0.05} value={mdl.brightness ?? 1} onChange={(e) => updateSpace({ model: { ...mdl, brightness: parseFloat(e.target.value) } }, false)} />
          </Field>
          <Toggle
            checked={!!mdl.emptyInterior}
            onChange={(emptyInterior) => updateSpace({ model: { ...mdl, emptyInterior } })}
            label="Vaciar la sala: quitar el mobiliario que había al escanear"
          />
          {mdl.emptyInterior && (
            <div className="grid2">
              <Field label="Conservar junto a paredes" hint="Cuadros, molduras, radiadores, consolas">
                <NumberInput value={mdl.keepBand ?? 0.4} min={0.05} max={3} step={0.05} onChange={(keepBand) => updateSpace({ model: { ...mdl, keepBand } })} suffix="m" />
              </Field>
              <Field label="Conservar bajo el techo" hint="Lámparas, molduras de techo">
                <NumberInput value={mdl.keepCeiling ?? 1} min={0} max={3} step={0.05} onChange={(keepCeiling) => updateSpace({ model: { ...mdl, keepCeiling } })} suffix="m" />
              </Field>
            </div>
          )}
          <p className="hint">En la vista 3D el techo y la pared más cercana a la cámara se ocultan solos para ver el interior; en el paseo la sala se ve completa.</p>
          <div className="row gap">
            <button className="btn small" onClick={() => autoFit(mdl.assetId, mdl.scale, mdl.rotation, mdl.name)}>
              Recentrar y ajustar medidas
            </button>
            <button className="btn small danger" onClick={() => updateSpace({ model: undefined, showWalls: !space.outdoor })}>
              Quitar modelo
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}

function SatelliteSection({ primary, onImage }: { primary: boolean; onImage: (f: File, widthM: number) => Promise<void> }) {
  const project = useStore((s) => s.project)!;
  const { space } = project;
  const [q, setQ] = useState('');
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [size, setSize] = useState(Math.max(60, Math.ceil(Math.max(space.width, space.depth) * 2.5)));
  const [status, setStatus] = useState('');
  const [manualW, setManualW] = useState(100);

  return (
    <Section title="🛰️ Vista satélite" defaultOpen={primary}>
      <p className="hint">Para terrazas y jardines: la imagen satélite se coloca bajo la zona del evento a escala real.</p>
      <Field label="Dirección o nombre del hotel">
        <div className="row gap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hotel …, Málaga" onKeyDown={(e) => e.stopPropagation()} />
          <button
            className="btn small"
            onClick={async () => {
              setStatus('Buscando…');
              try {
                const r = await geocode(q);
                if (!r) return setStatus('No se ha encontrado la dirección.');
                setCoords({ lat: r.lat, lon: r.lon });
                setStatus(r.label);
              } catch (e) {
                setStatus((e as Error).message);
              }
            }}
          >
            Buscar
          </button>
        </div>
      </Field>
      <div className="grid3">
        <Field label="Latitud">
          <NumberInput value={coords?.lat ?? 0} step={0.0001} onChange={(lat) => setCoords({ lat, lon: coords?.lon ?? 0 })} />
        </Field>
        <Field label="Longitud">
          <NumberInput value={coords?.lon ?? 0} step={0.0001} onChange={(lon) => setCoords({ lon, lat: coords?.lat ?? 0 })} />
        </Field>
        <Field label="Área a cubrir">
          <NumberInput value={size} min={20} max={600} step={10} onChange={setSize} suffix="m" />
        </Field>
      </div>
      <button
        className="btn"
        disabled={!coords}
        onClick={async () => {
          if (!coords) return;
          setStatus('Descargando imagen satélite…');
          try {
            const { blob, widthM } = await satelliteImage(coords.lat, coords.lon, size);
            await onImage(new File([blob], 'satelite.jpg', { type: 'image/jpeg' }), widthM);
            setStatus(`Imagen colocada (${m(widthM, 0)} m de lado). Mueve la zona del evento con "Desplazar X/Z".`);
          } catch (e) {
            setStatus((e as Error).message);
          }
        }}
      >
        Descargar vista satélite
      </button>
      {status && <p className="hint">{status}</p>}
      <div className="sub">
        <p className="hint">O sube una captura de Google Maps, del catastro o de un dron indicando cuántos metros mide de ancho:</p>
        <div className="row gap">
          <NumberInput value={manualW} min={5} onChange={setManualW} suffix="m" />
          <FileButton accept="image/*" onFile={(f) => onImage(f, manualW)} className="btn small">
            Subir captura
          </FileButton>
        </div>
      </div>
      {space.underlay && space.method === 'satelite' && <UnderlayControls />}
      <p className="attribution">{SAT_ATTRIBUTION}</p>
    </Section>
  );
}

function VideoSection({ primary }: { primary: boolean }) {
  const project = useStore((s) => s.project)!;
  const updateSpace = useStore((s) => s.updateSpace);
  const showVideo = useStore((s) => s.showVideo);
  const setShowVideo = useStore((s) => s.setShowVideo);
  const [every, setEvery] = useState(1);
  const [status, setStatus] = useState('');
  const vid = project.space.videoAssetId;

  const extract = async () => {
    const url = vid && (await assetUrl(vid));
    if (!url) return;
    const v = document.createElement('video');
    v.src = url;
    v.muted = true;
    v.playsInline = true;
    await new Promise((r) => (v.onloadedmetadata = r));
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 1920 / v.videoWidth);
    canvas.width = v.videoWidth * scale;
    canvas.height = v.videoHeight * scale;
    const ctx = canvas.getContext('2d')!;
    const frames: { name: string; blob: Blob }[] = [];
    const total = Math.floor(v.duration / every);
    for (let i = 0; i <= total && i < 300; i++) {
      await new Promise<void>((r) => {
        const done = () => r();
        v.onseeked = done;
        setTimeout(done, 3000);
        v.currentTime = Math.min(v.duration - 0.05, i * every + 0.001);
      });
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const b = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      if (b) frames.push({ name: `fotograma_${String(i).padStart(4, '0')}.jpg`, blob: b });
      setStatus(`Extrayendo fotogramas… ${i + 1}/${total + 1}`);
    }
    downloadBlob(await makeZip(frames), `${project.space.name || 'espacio'}_fotogramas.zip`);
    setStatus(`${frames.length} fotogramas descargados en un ZIP.`);
  };

  return (
    <Section title="🎥 Vídeo del espacio" defaultOpen={primary}>
      <p className="hint">
        Sube un recorrido en vídeo del espacio. Puedes verlo como referencia mientras ajustas medidas y elementos, y extraer fotogramas para reconstruirlo en 3D con un
        programa de fotogrametría (después, impórtalo en la sección de fotogrametría).
      </p>
      <FileButton
        accept="video/*"
        onFile={async (f) => {
          const id = await addAsset(f, f.name);
          updateSpace({ videoAssetId: id }, false);
          setShowVideo(true);
        }}
      >
        {vid ? 'Cambiar vídeo' : 'Subir vídeo'}
      </FileButton>
      {vid && (
        <div className="sub">
          <Toggle checked={showVideo} onChange={setShowVideo} label="Mostrar el vídeo como referencia" />
          <div className="row gap">
            <span className="muted">Un fotograma cada</span>
            <NumberInput value={every} min={0.2} max={10} step={0.5} onChange={setEvery} suffix="s" />
            <button className="btn small" onClick={extract}>
              Extraer fotogramas (ZIP)
            </button>
          </div>
          {status && <p className="hint">{status}</p>}
        </div>
      )}
    </Section>
  );
}

/** Reproductor flotante de referencia. */
export function VideoReference() {
  const project = useStore((s) => s.project);
  const show = useStore((s) => s.showVideo);
  const setShow = useStore((s) => s.setShowVideo);
  const [url, setUrl] = useState<string>();
  const ref = useRef<HTMLVideoElement>(null);
  const vid = project?.space.videoAssetId;
  useEffect(() => {
    if (vid) assetUrl(vid).then(setUrl);
  }, [vid]);
  if (!show || !url) return null;
  return (
    <div className="video-ref">
      <div className="video-head">
        <span>Vídeo de referencia</span>
        <button className="icon-btn" onClick={() => setShow(false)}>
          ✕
        </button>
      </div>
      <video ref={ref} src={url} controls muted playsInline />
    </div>
  );
}

type Surface = WallSide | 'suelo' | 'techo';

const SURFACES: { id: Surface; label: string; help: string }[] = [
  { id: 'norte', label: 'Pared del frente', help: 'La pared del escenario o la pantalla (arriba en la vista en planta).' },
  { id: 'este', label: 'Pared derecha', help: 'Mirando hacia el frente, la pared de tu derecha.' },
  { id: 'sur', label: 'Pared del fondo', help: 'La pared opuesta al frente, normalmente la de la entrada.' },
  { id: 'oeste', label: 'Pared izquierda', help: 'Mirando hacia el frente, la pared de tu izquierda.' },
  { id: 'suelo', label: 'Suelo', help: 'Una muestra del suelo: una baldosa, un tramo de parqué o de moqueta.' },
  { id: 'techo', label: 'Techo', help: 'El techo completo, fotografiado desde el centro de la sala.' },
];

/**
 * Captura de la sala desde la propia app: una foto por superficie con la cámara del móvil,
 * corrección de perspectiva marcando las 4 esquinas y colocación a escala real.
 */
function RealSurfaces() {
  const project = useStore((s) => s.project)!;
  const updateSpace = useStore((s) => s.updateSpace);
  const setTool = useStore((s) => s.setTool);
  const { space } = project;
  const [busy, setBusy] = useState<Surface | null>(null);
  if (space.outdoor) return null;

  const has = (id: Surface) => (id === 'suelo' ? !!space.floorPhoto : id === 'techo' ? !!space.ceilingPhoto : !!space.wallPhotos?.[id]);
  const done = SURFACES.filter((x) => has(x.id)).length;

  const capture = async (id: Surface, f: File) => {
    setBusy(id);
    const len = id === 'norte' || id === 'sur' ? space.width : space.depth;
    const sf = SURFACES.find((x) => x.id === id)!;
    const help =
      id === 'suelo'
        ? 'Arrastra las 4 esquinas hasta los bordes de una baldosa o de un trozo de suelo cuyo tamaño conozcas.'
        : id === 'techo'
          ? 'Arrastra las 4 esquinas hasta las esquinas del techo (arriba = lado del frente).'
          : `Arrastra las 4 esquinas hasta donde la pared se une con el techo y con el suelo. Se colocará a escala: ${m(len, 1)} × ${m(space.height, 1)} m.`;
    const aspect = id === 'suelo' ? undefined : id === 'techo' ? space.width / space.depth : len / space.height;
    const r = await requestRectify(f, `${sf.label}: marca las esquinas`, help, aspect);
    if (r) {
      const id_ = await addAsset(new File([r.blob], `${id}.jpg`, { type: 'image/jpeg' }), `${id}.jpg`);
      if (id === 'suelo') updateSpace({ floorPhoto: { assetId: id_, tileM: space.floorPhoto?.tileM ?? 0.6 } });
      else if (id === 'techo') updateSpace({ ceilingPhoto: { assetId: id_ } });
      else updateSpace({ wallPhotos: { ...(space.wallPhotos ?? {}), [id]: { assetId: id_ } }, showWalls: space.model ? space.showWalls : true });
    }
    setBusy(null);
  };

  const clear = (id: Surface) => {
    if (id === 'suelo') return updateSpace({ floorPhoto: undefined });
    if (id === 'techo') return updateSpace({ ceilingPhoto: undefined });
    const next = { ...(space.wallPhotos ?? {}) };
    delete next[id];
    updateSpace({ wallPhotos: next });
  };

  return (
    <Section title="📱 Capturar la sala con la cámara" badge={`${done}/6`} defaultOpen={!space.model}>
      <p className="hint">
        Sin apps externas: fotografía cada superficie con el móvil, marca sus 4 esquinas y la app endereza la foto y la coloca a escala sobre el espacio. Comprueba antes que las
        medidas del espacio (ancho, fondo y altura) son las reales.
      </p>
      <details className="guide">
        <summary>Consejos para que la sala quede fiel</summary>
        <ul>
          <li>Enciende todas las luces de la sala y no uses flash.</li>
          <li>Fotografía cada pared desde el centro de la pared opuesta, con el móvil recto y la pared entera en la foto (usa el gran angular o el modo panorámico en salas largas).</li>
          <li>Coloca las esquinas justo donde la pared toca el techo y el suelo.</li>
          <li>Los relieves (molduras, apliques) quedan como imagen plana; para tener su volumen, escanéalos aparte como decoración.</li>
        </ul>
      </details>
      <ul className="photo-slots">
        {SURFACES.map((x) => (
          <li key={x.id}>
            <span className={has(x.id) ? 'slot-done' : ''} title={x.help}>
              {has(x.id) ? '✓ ' : ''}
              {x.label}
            </span>
            {busy === x.id ? (
              <span className="muted">Procesando…</span>
            ) : (
              <>
                <FileButton accept="image/*" camera className="btn small" onFile={(f) => capture(x.id, f)}>
                  📷 Foto
                </FileButton>
                <FileButton accept="image/*" className="btn small ghost" onFile={(f) => capture(x.id, f)}>
                  Subir
                </FileButton>
                {has(x.id) && (
                  <button className="icon-btn" title="Quitar" onClick={() => clear(x.id)}>
                    ✕
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {space.floorPhoto && (
        <Field label="Ancho real de la muestra de suelo" hint="Lo que mide de lado la baldosa o el trozo marcado; se repite como un mosaico.">
          <NumberInput value={space.floorPhoto.tileM ?? 0.6} min={0.05} max={20} onChange={(tileM) => updateSpace({ floorPhoto: { ...space.floorPhoto!, tileM } })} suffix="m" />
        </Field>
      )}
      <button className="btn small" onClick={() => setTool('eyedropper')}>
        Coger un color del espacio (cuentagotas)
      </button>
    </Section>
  );
}

/** Importa la medición de MICE Capture (RoomPlan, iPhone/iPad con LiDAR). */
function RoomPlanImport() {
  const updateSpace = useStore((s) => s.updateSpace);
  const addItems = useStore((s) => s.addItems);
  const [msg, setMsg] = useState('');
  return (
    <div className="callout">
      <strong>📱 Medición con iPhone Pro (LiDAR)</strong>
      <p className="hint">
        Escanea la sala con la app de refuerzo <em>MICE Capture</em> y comparte aquí el archivo <code>.mice-room.json</code>: se crean las medidas, la altura, las puertas, las
        ventanas y los tabiques.
      </p>
      <FileButton
        accept=".json,application/json"
        className="btn small"
        onFile={async (f) => {
          try {
            const r = parseRoomPlan(JSON.parse(await f.text()));
            updateSpace({ width: r.width, depth: r.depth, height: r.height });
            addItems(
              r.items.map(({ id: _id, ...it }) => it),
              ['puerta', 'salida', 'ventana', 'tabique'],
            );
            setMsg(r.summary);
          } catch (e) {
            setMsg((e as Error).message);
          }
        }}
      >
        Importar medición (.mice-room.json)
      </FileButton>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}
