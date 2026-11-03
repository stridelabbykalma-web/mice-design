import { useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { Pt, estimateAspect, rectify } from '../lib/perspective';

// Editor de perspectiva: se abre desde cualquier parte con requestRectify() y devuelve
// la imagen enderezada (o null si se cancela).

interface Request {
  file: File;
  title: string;
  help: string;
  /** Relación ancho/alto real conocida (pared de 16 × 3,6 m → 4,44). Si falta, se estima. */
  aspect?: number;
  resolve: (r: { blob: Blob; aspect: number } | null) => void;
}

const useRectify = create<{ req: Request | null }>(() => ({ req: null }));

export function requestRectify(file: File, title: string, help: string, aspect?: number) {
  return new Promise<{ blob: Blob; aspect: number } | null>((resolve) => useRectify.setState({ req: { file, title, help, aspect, resolve } }));
}

const LABELS = ['Arriba izq.', 'Arriba der.', 'Abajo der.', 'Abajo izq.'];

export function RectifyHost() {
  const req = useRectify((s) => s.req);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [q, setQ] = useState<Pt[]>([]);
  const [busy, setBusy] = useState(false);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const wrap = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  useEffect(() => {
    if (!req) return;
    const url = URL.createObjectURL(req.file);
    const im = new Image();
    im.onload = () => {
      setImg(im);
      const W = im.naturalWidth;
      const H = im.naturalHeight;
      setQ([
        { x: W * 0.1, y: H * 0.1 },
        { x: W * 0.9, y: H * 0.1 },
        { x: W * 0.9, y: H * 0.9 },
        { x: W * 0.1, y: H * 0.9 },
      ]);
    };
    im.src = url;
    return () => {
      URL.revokeObjectURL(url);
      setImg(null);
    };
  }, [req]);

  // Ajusta la imagen al espacio disponible
  useEffect(() => {
    if (!img || !wrap.current) return;
    const fit = () => {
      const r = wrap.current!.getBoundingClientRect();
      const k = Math.min(r.width / img.naturalWidth, r.height / img.naturalHeight);
      setBox({ w: img.naturalWidth * k, h: img.naturalHeight * k });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [img]);

  if (!req) return null;
  const k = img ? box.w / img.naturalWidth : 1;
  const close = (r: { blob: Blob; aspect: number } | null) => {
    req.resolve(r);
    useRectify.setState({ req: null });
    setBusy(false);
  };

  const toImg = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.max(0, Math.min(img!.naturalWidth, (e.clientX - r.left) / k)), y: Math.max(0, Math.min(img!.naturalHeight, (e.clientY - r.top) / k)) };
  };

  const apply = async () => {
    if (!img) return;
    setBusy(true);
    const aspect = req.aspect ?? estimateAspect(q);
    const outW = Math.min(2048, Math.max(512, Math.round(2048 * Math.min(1, aspect))));
    const outH = Math.max(64, Math.round(outW / aspect));
    const blob = await rectify(img, q, outW, Math.min(outH, 4096));
    close({ blob, aspect });
  };

  return (
    <div className="rectify-overlay" role="dialog" aria-modal="true" aria-label={req.title}>
      <div className="rectify-panel">
        <header className="rectify-head">
          <div>
            <strong>{req.title}</strong>
            <p>{req.help}</p>
          </div>
        </header>
        <div className="rectify-stage" ref={wrap}>
          {img && (
            <div
              className="rectify-img"
              style={{ width: box.w, height: box.h, backgroundImage: `url(${img.src})` }}
              onPointerMove={(e) => {
                if (drag.current === null) return;
                const p = toImg(e);
                setQ((old) => old.map((o, i) => (i === drag.current ? p : o)));
              }}
              onPointerUp={() => (drag.current = null)}
              onPointerCancel={() => (drag.current = null)}
            >
              <svg width={box.w} height={box.h}>
                <polygon points={q.map((p) => `${p.x * k},${p.y * k}`).join(' ')} className="rectify-poly" />
              </svg>
              {q.map((p, i) => (
                <button
                  key={i}
                  className="rectify-handle"
                  style={{ left: p.x * k, top: p.y * k }}
                  aria-label={`Esquina ${LABELS[i]}`}
                  onPointerDown={(e) => {
                    drag.current = i;
                    (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
                    e.preventDefault();
                  }}
                >
                  <span>{LABELS[i]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <footer className="rectify-foot">
          <button className="btn" onClick={() => close(null)} disabled={busy}>
            Cancelar
          </button>
          <button
            className="btn"
            disabled={busy || !img}
            onClick={() => close({ blob: req.file, aspect: req.aspect ?? (img ? img.naturalWidth / img.naturalHeight : 1) })}
          >
            Usar la foto sin enderezar
          </button>
          <button className="btn primary" onClick={apply} disabled={busy || !img}>
            {busy ? 'Enderezando…' : 'Enderezar y aplicar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
