import { useState } from 'react';
import { syncedVariants, useStore } from '../store';
import type { LayoutType, Project, Variant, ViewMode } from '../types';
import { analyze, capacitySummary } from '../lib/safety';
import { LAYOUT_INFO } from '../lib/layouts';
import { isTableDef } from '../lib/tables';
import { findDef } from '../catalog';
import { budgetLines } from './Panels';
import { ConfirmButton, m } from './ui';
import { money, t } from '../lib/i18n';

/** Resumen de una propuesta para compararla con las demás. */
export function variantSummary(project: Project, v: Variant) {
  const p: Project = { ...project, items: v.items, lighting: v.lighting, event: { ...project.event, layout: v.layout } };
  const cap = capacitySummary(p);
  const res = analyze(p);
  const furniture = budgetLines(p).reduce((a, l) => a + l.qty * l.price, 0);
  const pax = project.event.pax || cap.total;
  const total = (furniture + project.event.roomPrice + pax * project.event.pricePerPax) * 1.21;
  return {
    cap,
    tables: v.items.filter((i) => isTableDef(findDef(i.type, project.customCatalog))).length,
    errors: res.checks.filter((c) => c.severity === 'error').length,
    warnings: res.checks.filter((c) => c.severity === 'aviso').length,
    maxOccupancy: res.maxOccupancy,
    furniture,
    total,
    pax,
  };
}

/** Selector de propuestas en la barra superior. */
export function VariantMenu({ onCompare, client = false }: { onCompare?: () => void; client?: boolean }) {
  const project = useStore((s) => s.project)!;
  const st = useStore();
  const [editing, setEditing] = useState<string | null>(null);
  const vs = syncedVariants(project);
  const active = project.activeVariant ?? vs[0].id;
  /** Cierra el desplegable después de elegir una opción. */
  const close = (e: React.MouseEvent) => (e.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open');

  if (client) {
    if (vs.length < 2) return null;
    return (
      <div className="seg" role="group" aria-label="Propuestas">
        {vs.map((v) => (
          <button key={v.id} className={v.id === active ? 'active' : ''} onClick={() => st.switchVariant(v.id)}>
            {v.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <details className="menu variant-menu">
      <summary className="btn" title="Propuestas alternativas del evento">
        {vs.find((v) => v.id === active)?.name ?? 'Propuesta A'} ▾
      </summary>
      <div className="menu-list">
        {vs.map((v) => (
          <div key={v.id} className={`variant-row ${v.id === active ? 'active' : ''}`}>
            {editing === v.id ? (
              <input
                autoFocus
                defaultValue={v.name}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                }}
                onBlur={(e) => {
                  st.renameVariant(v.id, e.target.value.trim() || v.name);
                  setEditing(null);
                }}
              />
            ) : (
              <button
                className="variant-name"
                onClick={(e) => {
                  st.switchVariant(v.id);
                  close(e);
                }}
              >
                {v.id === active ? '● ' : ''}
                {v.name}
                <span>{v.layout ? LAYOUT_INFO[v.layout as LayoutType].name : 'Personalizado'}</span>
              </button>
            )}
            <button className="icon-btn" title="Cambiar el nombre" onClick={() => setEditing(v.id)}>
              ✎
            </button>
            {vs.length > 1 && (
              <ConfirmButton title="Eliminar la propuesta" onConfirm={() => st.deleteVariant(v.id)}>
                ✕
              </ConfirmButton>
            )}
          </div>
        ))}
        <hr />
        <button
          onClick={(e) => {
            st.createVariant(true);
            close(e);
          }}
        >
          + Nueva propuesta (copia de la actual)
        </button>
        <button
          onClick={(e) => {
            st.createVariant(false);
            close(e);
          }}
        >
          + Nueva propuesta vacía
        </button>
        {vs.length > 1 && onCompare && (
          <button
            onClick={(e) => {
              onCompare();
              close(e);
            }}
          >
            Comparar propuestas
          </button>
        )}
      </div>
    </details>
  );
}

/** Comparación lado a lado de las propuestas, con plano de cada una. */
export function CompareModal({ capture, onClose }: { capture: (view: ViewMode) => Promise<string | undefined>; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const lang = project.event.language;
  const T = (es: string) => t(lang, es);
  const st = useStore();
  const vs = syncedVariants(project);
  const [shots, setShots] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const takeShots = async () => {
    setBusy(true);
    const original = useStore.getState().project!.activeVariant ?? vs[0].id;
    const prevView = useStore.getState().view;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    // Primero se pasa a la planta y se espera a que la sala (y su escaneo) termine de cargar.
    if (prevView !== 'planta') {
      useStore.getState().setView('planta');
      await wait(2000);
    }
    const out: Record<string, string> = {};
    for (const v of vs) {
      useStore.getState().switchVariant(v.id);
      await wait(500);
      const url = await capture('planta');
      if (url) out[v.id] = url;
    }
    useStore.getState().switchVariant(original);
    if (prevView !== 'planta') useStore.getState().setView(prevView);
    setShots(out);
    setBusy(false);
  };

  return (
    <div className="order-overlay">
      <div className="order-actions">
        <button className="btn primary" onClick={takeShots} disabled={busy}>
          {T(busy ? 'Generando planos…' : 'Ver el plano de cada propuesta')}
        </button>
        <button className="btn" onClick={onClose}>
          {T('Cerrar')}
        </button>
      </div>
      <article className="compare-sheet">
        <h1>{T('Comparación de propuestas')}</h1>
        <p className="muted">
          {project.name} · {project.space.name} ({m(project.space.width * project.space.depth, 0)} m²)
        </p>
        <div className="compare-scroll">
          <table className="compare-table">
            <thead>
              <tr>
                <th />
                {vs.map((v) => (
                  <th key={v.id}>
                    {v.name}
                    {v.id === (project.activeVariant ?? vs[0].id) && <span className="badge">{T('actual')}</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Object.keys(shots).length > 0 && (
                <tr>
                  <th>{T('Plano')}</th>
                  {vs.map((v) => (
                    <td key={v.id}>{shots[v.id] && <img src={shots[v.id]} alt={`Plano de ${v.name}`} />}</td>
                  ))}
                </tr>
              )}
              {(
                [
                  ['Montaje', (v: Variant) => T(v.layout ? LAYOUT_INFO[v.layout as LayoutType].name : 'Personalizado')],
                  ['Plazas sentadas', (v: Variant) => String(variantSummary(project, v).cap.seated)],
                  ['Personas de pie', (v: Variant) => String(variantSummary(project, v).cap.standing)],
                  ['Mesas', (v: Variant) => String(variantSummary(project, v).tables)],
                  ['Aforo máximo (CTE)', (v: Variant) => String(variantSummary(project, v).maxOccupancy)],
                  [
                    'Seguridad',
                    (v: Variant) => {
                      const s = variantSummary(project, v);
                      if (lang === 'en') return s.errors ? `${s.errors} issue(s)` : s.warnings ? `${s.warnings} warning(s)` : 'OK';
                      return s.errors ? `${s.errors} problema(s)` : s.warnings ? `${s.warnings} aviso(s)` : 'Correcta';
                    },
                  ],
                  ['Mobiliario y montaje', (v: Variant) => money(lang, variantSummary(project, v).furniture)],
                  ['Total con IVA', (v: Variant) => money(lang, variantSummary(project, v).total)],
                  ['Ambiente de luz', (v: Variant) => T({ dia: 'Día', tarde: 'Tarde', noche: 'Noche', gala: 'Gala' }[v.lighting])],
                ] as [string, (v: Variant) => string][]
              ).map(([label, fn]) => (
                <tr key={label}>
                  <th>{T(label)}</th>
                  {vs.map((v) => (
                    <td key={v.id}>{fn(v)}</td>
                  ))}
                </tr>
              ))}
              <tr>
                <th />
                {vs.map((v) => (
                  <td key={v.id}>
                    <button
                      className="btn small"
                      onClick={() => {
                        st.switchVariant(v.id);
                        onClose();
                      }}
                    >
                      {T('Abrir')}
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </div>
  );
}
