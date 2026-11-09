// Programa del evento por fases, con los cambios de montaje entre fases.

import { useMemo, useState } from 'react';
import { syncedVariants, useStore } from '../store';
import { EVENT_KINDS, QUICK, type EventKind, buildProgram, changeovers, fmtTime, hasDesign, layoutName, phaseEnd, phaseWarnings } from '../lib/program';
import { ConfirmButton, Field, NumberInput } from './ui';

export function ProgramPanel() {
  const project = useStore((s) => s.project)!;
  const st = useStore();
  const prog = project.program;
  const [kind, setKind] = useState<EventKind>('congreso');
  const [pax, setPax] = useState(project.event.pax || 150);
  const [start, setStart] = useState(EVENT_KINDS.congreso.start);
  const [staff, setStaff] = useState(6);

  const create = () => {
    const { program, variants } = buildProgram(project, kind, pax, start, staff);
    const first = variants[0];
    st.patchProject({
      program,
      variants,
      activeVariant: first.id,
      items: first.items,
      lighting: first.lighting,
      event: { ...project.event, pax, layout: first.layout, name: project.event.name || EVENT_KINDS[kind].name },
    });
    useStore.setState({ past: [], future: [], selection: [] });
  };

  if (!prog)
    return (
      <div className="panel">
        <p className="hint">
          Elige el tipo de evento y la app propone sus fases típicas, con el montaje de la sala en cada una y el cambio de montaje entre fases (qué se retira, qué se monta, personal y
          tiempo).
        </p>
        <div className="kind-list">
          {(Object.keys(EVENT_KINDS) as EventKind[]).map((k) => (
            <button
              key={k}
              className={`kind ${kind === k ? 'active' : ''}`}
              onClick={() => {
                setKind(k);
                setStart(EVENT_KINDS[k].start);
              }}
            >
              <strong>{EVENT_KINDS[k].name}</strong>
              <span>{EVENT_KINDS[k].description}</span>
            </button>
          ))}
        </div>
        <ol className="phase-preview">
          {EVENT_KINDS[kind].steps.map((s, i) => (
            <li key={i}>
              {s.name} <span className="muted">· {'outside' in s ? s.outside : 'room' in s ? layoutName(s.room.layout) : 'cambio pequeño'}</span>
            </li>
          ))}
        </ol>
        <div className="grid3">
          <Field label="Personas">
            <NumberInput value={pax} min={1} max={5000} onChange={setPax} />
          </Field>
          <Field label="Hora de inicio">
            <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Personal de montaje">
            <NumberInput value={staff} min={1} max={60} onChange={setStaff} />
          </Field>
        </div>
        {hasDesign(project) ? (
          <ConfirmButton className="btn primary" title="Sustituye las propuestas actuales por las fases del programa" onConfirm={create} armedLabel="¿Sustituir las propuestas actuales? Pulsa otra vez">
            Crear el programa (sustituye las propuestas)
          </ConfirmButton>
        ) : (
          <button className="btn primary" onClick={create}>
            Crear el programa
          </button>
        )}
      </div>
    );

  return <ProgramView />;
}

function ProgramView() {
  const project = useStore((s) => s.project)!;
  const st = useStore();
  const prog = project.program!;
  const cos = useMemo(() => changeovers(project), [project]);
  const warns = useMemo(() => phaseWarnings(project), [project]);
  // Con la fase en pantalla al día (su montaje vive en el proyecto, no en la lista)
  const vs = project.variants?.length ? syncedVariants(project) : [];

  const setPhases = (phases: typeof prog.phases) => st.patchProject({ program: { ...prog, phases } });
  /** Cambiar la duración de una fase desplaza las siguientes. */
  const setMinutes = (i: number, minutes: number) => {
    const ph = prog.phases.map((p) => ({ ...p }));
    const delta = minutes - ph[i].minutes;
    ph[i].minutes = minutes;
    for (let j = i + 1; j < ph.length; j++) {
      const [h, m] = ph[j].start.split(':').map(Number);
      ph[j].start = fmtTime(h * 60 + m + delta);
    }
    setPhases(ph);
  };

  return (
    <div className="panel">
      <p className="muted">
        {EVENT_KINDS[prog.kind].name} · {project.event.pax || '—'} personas ·{' '}
        <label className="inline">
          personal de montaje{' '}
          <input type="number" min={1} max={60} value={prog.staff} onChange={(e) => st.patchProject({ program: { ...prog, staff: Math.max(1, Number(e.target.value) || 1) } })} />
        </label>
      </p>
      <ol className="timeline">
        {prog.phases.map((ph, i) => {
          const v = vs.find((x) => x.id === ph.variantId);
          const active = ph.variantId && ph.variantId === project.activeVariant;
          const co = cos.find((c) => c.to.id === ph.id);
          const w = warns.filter((x) => x.phaseId === ph.id);
          return (
            <li key={ph.id} className={`phase ${ph.variantId ? 'in-room' : 'outside'} ${active ? 'active' : ''}`}>
              {co && <ChangeoverCard co={co} />}
              <div className="phase-row">
                <span className="phase-time">
                  {ph.start}–{phaseEnd(ph)}
                </span>
                <div className="phase-main">
                  <strong>{ph.name}</strong>
                  <span className="muted">{ph.variantId ? (v ? `Sala: ${layoutName(v.layout)}` : 'Montaje borrado') : `Fuera de la sala: ${ph.place}`}</span>
                  {ph.note && <span className="hint">{ph.note}</span>}
                  {w.map((x, k) => (
                    <span key={k} className="warn-text">
                      ⚠ {x.text}
                    </span>
                  ))}
                </div>
                <div className="phase-actions">
                  <input
                    type="number"
                    aria-label={`Duración de ${ph.name} en minutos`}
                    title="Duración (min)"
                    min={5}
                    step={5}
                    value={ph.minutes}
                    onChange={(e) => setMinutes(i, Math.max(5, Number(e.target.value) || 5))}
                  />
                  {v && !active && (
                    <button className="btn small" onClick={() => st.switchVariant(v.id)}>
                      Ver
                    </button>
                  )}
                  {active && <span className="badge">En pantalla</span>}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="hint">
        Cada fase en la sala es un montaje: se edita como siempre (Catálogo, Montajes) y se cambia de fase con «Ver» o con el selector de propuestas. Los tiempos de cambio son una
        estimación orientativa con el personal indicado.
      </p>
      <ConfirmButton className="btn small danger" title="Quitar el programa (los montajes se quedan como propuestas)" onConfirm={() => st.patchProject({ program: undefined })} armedLabel="¿Quitar el programa?">
        Quitar el programa
      </ConfirmButton>
    </div>
  );
}

function ChangeoverCard({ co }: { co: ReturnType<typeof changeovers>[number] }) {
  const nothing = !co.removed.length && !co.added.length;
  if (nothing) return <div className="changeover none">Sin cambios en la sala</div>;
  const list = (rows: typeof co.added) => rows.map((r) => `${r.n} ${r.name.toLowerCase()}`).join(', ');
  return (
    <details className={`changeover ${co.ok ? 'ok' : 'bad'}`}>
      <summary>
        {co.ok ? '✓' : '⚠'}{' '}
        {co.minutes <= QUICK && co.available < co.minutes
          ? `Cambio rápido (~${co.minutes} min), sobre la marcha`
          : co.live
            ? `Se abre la pista con los invitados en la sala (~${co.minutes} min)`
            : `Cambio de montaje: ~${co.minutes} min · disponibles ${Math.max(0, co.available)} min`}
      </summary>
      {co.removed.length > 0 && <p>Retirar: {list(co.removed)}</p>}
      {co.added.length > 0 && <p>Montar: {list(co.added)}</p>}
      <p className="muted">{co.personMinutes} minutos de trabajo en total.</p>
      {!co.ok && (
        <p className="warn-text">
          No da tiempo. {co.guestsOut ? 'Alarga la fase anterior fuera de la sala' : 'Añade una pausa o un cóctel fuera de la sala'}, aumenta el personal o deja parte del
          montaje preparado de antemano.
        </p>
      )}
      {co.ok && !co.guestsOut && !co.live && co.minutes > QUICK && <p className="warn-text">Los asistentes no tienen otro sitio mientras se cambia: prevé una zona de espera.</p>}
    </details>
  );
}
