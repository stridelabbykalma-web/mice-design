import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Pt, planeMeter, rectify } from '../lib/perspective';
import { useStore } from '../store';
import { addAsset } from '../lib/db';
import type { WallSide } from '../types';
import { NumberInput, m } from './ui';

// Medir una pared con una foto (metrología plana). Se marca un rectángulo de referencia
// de tamaño real conocido y las esquinas de la pared, en el mismo plano; la app calcula
// el ancho y el alto reales de la pared. Funciona en cualquier móvil, sin RA ni LiDAR.

const useMeasureTool = create<{ file: File | null }>(() => ({ file: null }));
export const openPhotoMeasure = (file: File) => useMeasureTool.setState({ file });

type Which = 'ref' | 'wall';
const LABELS = ['Arriba izq.', 'Arriba der.', 'Abajo der.', 'Abajo izq.'];

const quadAt = (W: number, H: number, x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: W * x0, y: H * y0 },
  { x: W * x1, y: H * y0 },
  { x: W * x1, y: H * y1 },
  { x: W * x0, y: H * y1 },
];

export function PhotoMeasureHost() {
  const file = useMeasureTool((s) => s.file);
  const project = useStore((s) => s.project);
  const updateSpace = useStore((s) => s.updateSpace);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [ref, setRef] = useState<Pt[]>([]);
  const [wall, setWall] = useState<Pt[]>([]);
  const [refW, setRefW] = useState(4);
  const [refH, setRefH] = useState(3);
  const [step, setStep] = useState<Which>('ref');
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [drag, setDrag] = useState<{ which: Which; i: number } | null>(null);
  const [side, setSide] = useState<WallSide>('norte');
  const [msg, setMsg] = useState('');
  const stage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const W = im.naturalWidth;
      const H = im.naturalHeight;
      setImg(im);
      setRef(quadAt(W, H, 0.38, 0.25, 0.62, 0.75));
      setWall(quadAt(W, H, 0.08, 0.12, 0.92, 0.88));
      setStep('ref');
      setMsg('');
    };
    im.src = url;
    return () => {
      URL.revokeObjectURL(url);
      setImg(null);
    };
  }, [file]);

  useEffect(() => {
    if (!img || !stage.current) return;
    const fit = () => {
      const r = stage.current!.getBoundingClientRect();
      const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      setBox({ w: img.naturalWidth * k, h: img.naturalHeight * k });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage.current);
    return () => ro.disconnect();
  }, [img]);

  if (!file || !project) return null;
  const k = img ? box.w / img.naturalWidth : 1;
  const close = () => useMeasureTool.setState({ file: null });

  // Resultado
  let res: null | { top: number; bottom: number; left: number; right: number; w: number; h: number; rel: 'alta' | 'media' | 'baja' } = null;
  if (img && ref.length === 4 && wall.length === 4 && refW > 0 && refH > 0) {
    try {
      const d = planeMeter(ref, refW, refH);
      const top = d(wall[0], wall[1]);
      const bottom = d(wall[3], wall[2]);
      const left = d(wall[0], wall[3]);
      const right = d(wall[1], wall[2]);
      const w = (top + bottom) / 2;
      const h = (left + right) / 2;
      // Fiabilidad: tamaño de la referencia respecto a lo medido y coherencia de lados opuestos
      const ratio = Math.min(refW / w, refH / h);
      const incoherence = Math.max(Math.abs(top - bottom) / w, Math.abs(left - right) / h);
      const rel = ratio >= 0.2 && incoherence < 0.03 ? 'alta' : ratio >= 0.08 && incoherence < 0.08 ? 'media' : 'baja';
      if (Number.isFinite(w) && Number.isFinite(h)) res = { top, bottom, left, right, w, h, rel };
    } catch {
      res = null;
    }
  }

  const toImg = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.max(0, Math.min(img!.naturalWidth, (e.clientX - r.left) / k)), y: Math.max(0, Math.min(img!.naturalHeight, (e.clientY - r.top) / k)) };
  };
  const active = drag ? (drag.which === 'ref' ? ref : wall)[drag.i] : null;

  const applyPhoto = async () => {
    if (!img || !res) return;
    const aspect = res.w / res.h;
    const outW = 2048;
    const blob = await rectify(img, wall, outW, Math.max(64, Math.round(outW / aspect)));
    const id = await addAsset(new File([blob], `${side}.jpg`, { type: 'image/jpeg' }), `${side}.jpg`);
    const sp = useStore.getState().project!.space;
    updateSpace({ wallPhotos: { ...(sp.wallPhotos ?? {}), [side]: { assetId: id } }, showWalls: sp.model ? sp.showWalls : true });
    setMsg('Foto aplicada a la pared.');
  };

  const handles = (which: Which, pts: Pt[]) =>
    pts.map((p, i) => (
      <button
        key={`${which}${i}`}
        className={`rectify-handle ${which === 'ref' ? 'ref' : ''} ${step !== which ? 'dim' : ''}`}
        style={{ left: p.x * k, top: p.y * k }}
        aria-label={`${which === 'ref' ? 'Referencia' : 'Pared'}: ${LABELS[i]}`}
        onPointerDown={(e) => {
          if (step !== which) return;
          setDrag({ which, i });
          (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
      >
        {step === which && <span>{LABELS[i]}</span>}
      </button>
    ));

  const LOUPE = 140;
  const ZOOM = 3;

  return (
    <div className="rectify-overlay" role="dialog" aria-modal="true" aria-label="Medir una pared con una foto">
      <div className="rectify-panel">
        <header className="rectify-head">
          <div className="steps">
            <button className={step === 'ref' ? 'active' : ''} onClick={() => setStep('ref')}>
              1. Referencia medida
            </button>
            <button className={step === 'wall' ? 'active' : ''} onClick={() => setStep('wall')}>
              2. Esquinas de la pared
            </button>
          </div>
          {step === 'ref' ? (
            <p>
              Marca un rectángulo de la pared cuyo tamaño real hayas medido (con la app Medidas o con un metro). Cuanto más grande, más preciso: lo ideal es un tramo de pared de
              varios metros con su altura completa, o una puerta doble.
            </p>
          ) : (
            <p>Marca las 4 esquinas de la pared: donde se une con el techo y con el suelo, en los dos extremos.</p>
          )}
        </header>
        <div className="measure-body">
          <div className="rectify-stage" ref={stage}>
            {img && (
              <div
                className="rectify-img"
                style={{ width: box.w, height: box.h, backgroundImage: `url(${img.src})` }}
                onPointerMove={(e) => {
                  if (!drag) return;
                  const p = toImg(e);
                  (drag.which === 'ref' ? setRef : setWall)((old) => old.map((o, i) => (i === drag.i ? p : o)));
                }}
                onPointerUp={() => setDrag(null)}
                onPointerCancel={() => setDrag(null)}
              >
                <svg width={box.w} height={box.h}>
                  <polygon points={wall.map((p) => `${p.x * k},${p.y * k}`).join(' ')} className={`rectify-poly ${step === 'wall' ? '' : 'faded'}`} />
                  <polygon points={ref.map((p) => `${p.x * k},${p.y * k}`).join(' ')} className={`ref-poly ${step === 'ref' ? '' : 'faded'}`} />
                </svg>
                {handles('wall', wall)}
                {handles('ref', ref)}
                {active && (
                  // Lupa para colocar la esquina con precisión aunque el dedo la tape
                  <div
                    className="loupe"
                    style={{
                      left: Math.min(box.w - LOUPE, Math.max(0, active.x * k - LOUPE / 2)),
                      top: active.y * k > LOUPE + 40 ? active.y * k - LOUPE - 40 : active.y * k + 40,
                      width: LOUPE,
                      height: LOUPE,
                      backgroundImage: `url(${img.src})`,
                      backgroundSize: `${box.w * ZOOM}px ${box.h * ZOOM}px`,
                      backgroundPosition: `${-active.x * k * ZOOM + LOUPE / 2}px ${-active.y * k * ZOOM + LOUPE / 2}px`,
                    }}
                  />
                )}
              </div>
            )}
          </div>
          <aside className="measure-side">
            <div className="field">
              <span className="field-label">Tamaño real de la referencia</span>
              <div className="grid2">
                <NumberInput value={refW} min={0.05} max={100} onChange={setRefW} suffix="m" />
                <NumberInput value={refH} min={0.05} max={30} onChange={setRefH} suffix="m" />
              </div>
              <span className="hint">Ancho × alto</span>
            </div>
            <div className="row gap wrap">
              <button className="btn small" onClick={() => { setRefW(1.8); setRefH(2.3); }}>
                Puerta doble
              </button>
              <button className="btn small" onClick={() => project && setRefH(project.space.height)}>
                Referencia con el alto ya medido
              </button>
            </div>
            {res ? (
              <div className={`measure-result rel-${res.rel}`}>
                <div>
                  <span>Ancho de la pared</span>
                  <strong>{m(res.w)} m</strong>
                  <em>
                    arriba {m(res.top)} · abajo {m(res.bottom)}
                  </em>
                </div>
                <div>
                  <span>Alto</span>
                  <strong>{m(res.h)} m</strong>
                  <em>
                    izq. {m(res.left)} · der. {m(res.right)}
                  </em>
                </div>
                <p>
                  Fiabilidad <strong>{res.rel}</strong>
                  {res.rel !== 'alta' && ': usa una referencia más grande o ajusta las esquinas con la lupa.'}
                </p>
              </div>
            ) : (
              <p className="hint">Marca la referencia y las esquinas de la pared.</p>
            )}
            {res && (
              <>
                <span className="field-label">Usar estas medidas</span>
                <div className="row gap wrap">
                  <button className="btn small" onClick={() => updateSpace({ width: Math.round(res!.w * 100) / 100 })}>
                    Ancho del espacio
                  </button>
                  <button className="btn small" onClick={() => updateSpace({ depth: Math.round(res!.w * 100) / 100 })}>
                    Fondo del espacio
                  </button>
                  <button className="btn small" onClick={() => updateSpace({ height: Math.round(res!.h * 100) / 100 })}>
                    Altura del espacio
                  </button>
                </div>
                <span className="field-label">Y aplicar la foto enderezada a</span>
                <div className="row gap">
                  <select value={side} onChange={(e) => setSide(e.target.value as WallSide)}>
                    <option value="norte">Pared del frente</option>
                    <option value="este">Pared derecha</option>
                    <option value="sur">Pared del fondo</option>
                    <option value="oeste">Pared izquierda</option>
                  </select>
                  <button className="btn small" onClick={applyPhoto}>
                    Aplicar
                  </button>
                </div>
                {msg && <p className="hint">{msg}</p>}
              </>
            )}
          </aside>
        </div>
        <footer className="rectify-foot">
          {step === 'ref' ? (
            <button className="btn primary" onClick={() => setStep('wall')}>
              Siguiente: esquinas de la pared →
            </button>
          ) : (
            <button className="btn" onClick={() => setStep('ref')}>
              ← Volver a la referencia
            </button>
          )}
          <button className="btn" onClick={close}>
            Cerrar
          </button>
        </footer>
      </div>
    </div>
  );
}
