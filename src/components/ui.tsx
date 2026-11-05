import { ReactNode, useEffect, useState } from 'react';

export function Section({ title, children, defaultOpen = true, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`section ${open ? 'open' : ''}`}>
      <button className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>{title}</span>
        {badge && <span className="badge">{badge}</span>}
        <span className="chev">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}

/** Campo numérico que acepta coma decimal y solo confirma al salir o pulsar Intro. */
export function NumberInput({
  value,
  onChange,
  step = 0.1,
  min,
  max,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? String(Math.round(v * 1000) / 1000).replace('.', ',') : '');
  const [text, setText] = useState(fmt(value));
  useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    let v = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(v)) return setText(fmt(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(fmt(v));
  };
  return (
    <span className="num">
      <input
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const v = value + (e.key === 'ArrowUp' ? step : -step);
            onChange(Math.round(v * 1000) / 1000);
          }
          e.stopPropagation();
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function FileButton({
  accept,
  onFile,
  children,
  className = 'btn',
  camera = false,
}: {
  accept: string;
  onFile: (f: File) => void;
  children: ReactNode;
  className?: string;
  /** En el móvil abre directamente la cámara trasera. */
  camera?: boolean;
}) {
  return (
    <label className={className}>
      {children}
      <input
        type="file"
        accept={accept}
        capture={camera ? 'environment' : undefined}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
    </label>
  );
}

export const eur = (v: number) => v.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
export const m = (v: number, d = 2) => v.toFixed(d).replace('.', ',');

/** Botón de doble confirmación integrado en la página (sin diálogos del navegador). */
export function ConfirmButton({
  onConfirm,
  children,
  title,
  className = 'icon-btn',
  armedLabel = '¿Eliminar?',
}: {
  onConfirm: () => void;
  children: ReactNode;
  title: string;
  className?: string;
  /** Texto del segundo clic (confirmación). */
  armedLabel?: string;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <button
      className={armed ? 'btn small danger' : className}
      title={title}
      onClick={() => {
        if (armed) {
          setArmed(false);
          onConfirm();
        } else setArmed(true);
      }}
    >
      {armed ? armedLabel : children}
    </button>
  );
}

/** true si la app se ejecuta incrustada (p. ej. vista previa), donde imprimir y descargar pueden estar bloqueados. */
export const isEmbedded = (() => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
})();
