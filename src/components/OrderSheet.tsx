import { useMemo } from 'react';
import { useStore } from '../store';
import { LAYOUT_INFO } from '../lib/layouts';
import { analyze, capacitySummary } from '../lib/safety';
import { budgetLines } from './Panels';
import { eur, isEmbedded, m } from './ui';
import type { LayoutType } from '../types';

/** Orden de montaje (BEO) y propuesta para el cliente, lista para imprimir o guardar en PDF. */
export default function OrderSheet({ images, onClose }: { images: { plan?: string; view?: string }; onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const { event: ev, space } = project;
  const res = useMemo(() => analyze(project), [project]);
  const cap = capacitySummary(project);
  const lines = budgetLines(project);
  const furniture = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const pax = ev.pax || cap.total;
  const subtotal = furniture + pax * ev.pricePerPax + ev.roomPrice;
  const exits = project.items.filter((i) => i.type === 'salida').length;
  const date = ev.date ? new Date(ev.date + 'T12:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }) : '—';

  return (
    <div className="order-overlay">
      <div className="order-actions no-print">
        {isEmbedded ? (
          <span className="embed-note dark">Para imprimir o guardar en PDF, abre la app instalada.</span>
        ) : (
          <button className="btn primary" onClick={() => window.print()}>
            Imprimir / Guardar como PDF
          </button>
        )}
        <button className="btn" onClick={onClose}>
          Cerrar
        </button>
      </div>
      <article className="order-sheet print-area">
        <header className="order-head">
          <div>
            <div className="order-brand">◆ MICE Design · {project.hotel || 'Hotel'}</div>
            <h1>Orden de montaje</h1>
            <p className="order-sub">
              {project.name}
              {project.variants && project.variants.length > 1 && ` · ${project.variants.find((v) => v.id === project.activeVariant)?.name ?? ''}`}
            </p>
          </div>
          <table className="order-meta">
            <tbody>
              <tr>
                <th>Cliente</th>
                <td>{ev.client || '—'}</td>
              </tr>
              <tr>
                <th>Fecha</th>
                <td>{date}</td>
              </tr>
              <tr>
                <th>Horario</th>
                <td>{ev.time || '—'}</td>
              </tr>
              <tr>
                <th>Espacio</th>
                <td>
                  {space.name} ({m(space.width, 1)} × {m(space.depth, 1)} m, {m(space.width * space.depth, 0)} m²)
                </td>
              </tr>
              <tr>
                <th>Montaje</th>
                <td>{ev.layout ? LAYOUT_INFO[ev.layout as LayoutType].name : 'Personalizado'}</td>
              </tr>
              <tr>
                <th>Asistentes</th>
                <td>
                  {pax} ({cap.seated} plazas sentadas{cap.standing ? `, ${cap.standing} de pie` : ''})
                </td>
              </tr>
            </tbody>
          </table>
        </header>

        <section className="order-images">
          {images.plan && (
            <figure>
              <img src={images.plan} alt="Plano de planta del montaje" />
              <figcaption>Plano de planta (el frente/escenario en la parte superior)</figcaption>
            </figure>
          )}
          {images.view && (
            <figure>
              <img src={images.view} alt="Vista 3D del montaje" />
              <figcaption>Vista 3D del evento</figcaption>
            </figure>
          )}
        </section>

        <section className="order-cols">
          <div>
            <h2>Material y mobiliario</h2>
            <table className="order-table">
              <thead>
                <tr>
                  <th>Elemento</th>
                  <th>Ud.</th>
                  <th>Importe</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.name}>
                    <td>{l.name}</td>
                    <td className="num-cell">{l.qty}</td>
                    <td className="num-cell">{eur(l.qty * l.price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2>Seguridad y aforo</h2>
            <ul className="order-checks">
              {res.checks.map((c) => (
                <li key={c.id} className={c.severity}>
                  {c.severity === 'ok' ? '✓' : c.severity === 'aviso' ? '!' : '✕'} {c.title}
                </li>
              ))}
              <li>Salidas de emergencia señalizadas: {exits}</li>
            </ul>
            <h2>Presupuesto orientativo</h2>
            <table className="order-table">
              <tbody>
                <tr>
                  <td>Mobiliario y montaje</td>
                  <td className="num-cell">{eur(furniture)}</td>
                </tr>
                <tr>
                  <td>Alquiler del espacio</td>
                  <td className="num-cell">{eur(ev.roomPrice)}</td>
                </tr>
                <tr>
                  <td>Servicio por persona ({pax} × {eur(ev.pricePerPax)})</td>
                  <td className="num-cell">{eur(pax * ev.pricePerPax)}</td>
                </tr>
                <tr>
                  <td>IVA (21 %)</td>
                  <td className="num-cell">{eur(subtotal * 0.21)}</td>
                </tr>
                <tr className="total">
                  <td>Total</td>
                  <td className="num-cell">{eur(subtotal * 1.21)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {ev.notes && (
          <section>
            <h2>Observaciones</h2>
            <p className="order-notes">{ev.notes}</p>
          </section>
        )}

        <section className="order-sign">
          <div>
            <span>Departamento de eventos</span>
          </div>
          <div>
            <span>Conforme del cliente</span>
          </div>
        </section>
        <footer className="order-foot">
          Generado con MICE Design · {new Date().toLocaleDateString('es-ES')} · Las comprobaciones de seguridad son orientativas (CTE DB-SI) y no sustituyen al plan de autoprotección.
        </footer>
      </article>
    </div>
  );
}
