import { useMemo } from 'react';
import { useStore } from '../store';
import { LAYOUT_INFO } from '../lib/layouts';
import { analyze, capacitySummary } from '../lib/safety';
import { budgetLines } from './Panels';
import { isEmbedded, m } from './ui';
import { roomArea } from '../lib/outline';
import { dietSummary, seatingTables, tableCapacity } from '../lib/guests';
import type { LayoutType } from '../types';
import { itemName, locale, money, t, tableLabel } from '../lib/i18n';

/** Orden de montaje (BEO) y propuesta para el cliente, lista para imprimir o guardar en PDF. */
export default function OrderSheet({ images, onClose }: { images: { plan?: string; view?: string }; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const { event: ev, space } = project;
  const lang = ev.language;
  const T = (es: string) => t(lang, es);
  const E = (v: number) => money(lang, v);
  const num = (v: number, d = 2) => (lang === 'en' ? v.toFixed(d) : m(v, d));
  const res = useMemo(() => analyze(project, lang), [project, lang]);
  const cap = capacitySummary(project);
  const lines = budgetLines(project);
  const furniture = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const pax = ev.pax || cap.total;
  const subtotal = furniture + pax * ev.pricePerPax + ev.roomPrice;
  const exits = project.items.filter((i) => i.type === 'salida').length;
  const diets = dietSummary(project.guests ?? []);
  const tableIds = new Set(seatingTables(project).map((tb) => tb.id));
  const unseated = (project.guests ?? []).filter((g) => !g.tableId || !tableIds.has(g.tableId)).length;
  const date = ev.date ? new Date(ev.date + 'T12:00').toLocaleDateString(locale(lang), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <div className="order-overlay">
      <div className="order-actions no-print">
        {isEmbedded ? (
          <span className="embed-note dark">{T('Para imprimir o guardar en PDF, abre la app instalada.')}</span>
        ) : (
          <button className="btn primary" onClick={() => window.print()}>
            {T('Imprimir / Guardar como PDF')}
          </button>
        )}
        <button className="btn" onClick={onClose}>
          {T('Cerrar')}
        </button>
      </div>
      <article className="order-sheet print-area">
        <header className="order-head">
          <div>
            <div className="order-brand">◆ MICE Design · {project.hotel || 'Hotel'}</div>
            <h1>{T('Orden de montaje')}</h1>
            <p className="order-sub">
              {project.name}
              {project.variants && project.variants.length > 1 && ` · ${project.variants.find((v) => v.id === project.activeVariant)?.name ?? ''}`}
            </p>
          </div>
          <table className="order-meta">
            <tbody>
              <tr>
                <th>{T('Cliente')}</th>
                <td>{ev.client || '—'}</td>
              </tr>
              <tr>
                <th>{T('Fecha')}</th>
                <td>{date}</td>
              </tr>
              <tr>
                <th>{T('Horario')}</th>
                <td>{ev.time || '—'}</td>
              </tr>
              <tr>
                <th>{T('Espacio')}</th>
                <td>
                  {space.name} ({num(space.width, 1)} × {num(space.depth, 1)} m, {num(roomArea(space), 0)} m²)
                </td>
              </tr>
              <tr>
                <th>{T('Montaje')}</th>
                <td>{T(ev.layout ? LAYOUT_INFO[ev.layout as LayoutType].name : 'Personalizado')}</td>
              </tr>
              <tr>
                <th>{T('Asistentes')}</th>
                <td>
                  {pax} ({cap.seated} {T('plazas sentadas')}{cap.standing ? `, ${cap.standing} ${T('de pie')}` : ''})
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="order-images">
          {images.plan && (
            <figure>
              <img src={images.plan} alt="Plano de planta del montaje" />
              <figcaption>{T('Plano de planta (el frente/escenario en la parte superior)')}</figcaption>
            </figure>
          )}
          {images.view && (
            <figure>
              <img src={images.view} alt="Vista 3D del montaje" />
              <figcaption>{T('Vista 3D del evento')}</figcaption>
            </figure>
          )}
        </section>

        <section className="order-cols">
          <div>
            <h2>{T('Material y mobiliario')}</h2>
            <table className="order-table">
              <thead>
                <tr>
                  <th>{T('Elemento')}</th>
                  <th>{T('Ud.')}</th>
                  <th>{T('Importe')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.name}>
                    <td>{itemName(lang, l.type, l.name)}</td>
                    <td className="num-cell">{l.qty}</td>
                    <td className="num-cell">{E(l.qty * l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2>{T('Seguridad y aforo')}</h2>
            <ul className="order-checks">
              {res.checks.map((c) => (
                <li key={c.id} className={c.severity}>
                  {c.severity === 'ok' ? '✓' : c.severity === 'aviso' ? '!' : '✕'} {c.title}
                </li>
              ))}
              <li>{T('Salidas de emergencia señalizadas')}: {exits}</li>
            </ul>
            <h2>{T('Presupuesto orientativo')}</h2>
            <table className="order-table">
              <tbody>
                <tr>
                  <td>{T('Mobiliario y montaje')}</td>
                  <td className="num-cell">{E(furniture)}</td>
                </tr>
                <tr>
                  <td>{T('Alquiler del espacio')}</td>
                  <td className="num-cell">{E(ev.roomPrice)}</td>
                </tr>
                <tr>
                  <td>{T('Servicio por persona')} ({pax} × {E(ev.pricePerPax)})</td>
                  <td className="num-cell">{E(pax * ev.pricePerPax)}</td>
                </tr>
                <tr>
                  <td>{T('IVA (21 %)')}</td>
                  <td className="num-cell">{E(subtotal * 0.21)}</td>
                </tr>
                <tr className="total">
                  <td>{T('Total')}</td>
                  <td className="num-cell">{E(subtotal * 1.21)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {ev.notes && (
          <section>
            <h2>{T('Observaciones')}</h2>
            <p className="order-notes">{ev.notes}</p>
          </section>
        )}

        {(project.guests?.length ?? 0) > 0 && (
          <section>
            <h2>{T('Plano de mesas')}</h2>
            {diets.length > 0 && (
              <p className="order-notes">
                <strong>{T('Dietas y alergias para cocina')}:</strong> {diets.map(([d, n]) => `${d} (${n})`).join(' · ')}
              </p>
            )}
            <div className="seating-grid">
              {seatingTables(project).map((tb) => {
                const list = (project.guests ?? []).filter((g) => g.tableId === tb.id);
                if (!list.length) return null;
                return (
                  <div key={tb.id} className="seating-table">
                    <strong>
                      {tableLabel(lang, tb.label)} · {list.length}/{tableCapacity(project, tb)}
                    </strong>
                    <ol>
                      {list.map((g) => (
                        <li key={g.id}>
                          {g.name}
                          {g.diet ? ` (${g.diet})` : ''}
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </div>
            {unseated > 0 && <p className="order-notes">{T('Sin mesa asignada')}: {unseated} {T('invitados')}.</p>}
          </section>
        )}

        <section className="order-sign">
          <div>
            <span>{T('Departamento de eventos')}</span>
          </div>
          <div>
            <span>{T('Conforme del cliente')}</span>
          </div>
        </section>
        <footer className="order-foot">
          {T('Generado con MICE Design')} · {new Date().toLocaleDateString(locale(lang))} ·{' '}
          {T('Las comprobaciones de seguridad son orientativas (CTE DB-SI) y no sustituyen al plan de autoprotección.')}
        </footer>
      </article>
    </div>
  );
}
