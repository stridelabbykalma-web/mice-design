import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import type { SpaceMethod } from '../types';
import { addAsset, assetUrl, downloadBlob } from '../lib/db';
import { loadGltf } from './Furniture';
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
  const autoFit = async (assetId: string, scale: number, rotation: number, name: string) => {
    const obj = await loadGltf(assetId);
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(scale);
    const c = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
    const r = rotation * DEG;
    const cx = c.x * Math.cos(r) + c.z * Math.sin(r);
    const cz = -c.x * Math.sin(r) + c.z * Math.cos(r);
    const swap = Math.abs(Math.sin(r)) > 0.7;
    updateSpace({
      model: { assetId, name, scale, rotation, offsetX: -cx, offsetY: -box.min.y * scale, offsetZ: -cz },
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
        accept=".glb,.gltf,model/gltf-binary"
        onFile={async (f) => {
          setBusy(true);
          setMsg('');
          try {
            const id = await addAsset(f, f.name);
            const size = await autoFit(id, 1, 0, f.name);
            setMsg(`Modelo cargado: ${m(size.x)} × ${m(size.z)} × ${m(size.y)} m. Si las medidas no son reales, corrige la escala.`);
          } catch {
            setMsg('No se pudo leer el modelo. Asegúrate de que es un archivo .glb válido.');
          }
          setBusy(false);
        }}
      >
        {busy ? 'Cargando…' : mdl ? 'Cambiar modelo 3D' : 'Importar modelo 3D (.glb)'}
      </FileButton>
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
