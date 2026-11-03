import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../lib/db';
import { ConfirmButton } from './ui';

// Módulo de evaluación con usuarios (cap. 7 del TFG):
//  · Tareas cronometradas (eficacia y eficiencia, ISO 9241-11).
//  · System Usability Scale (Brooke, 1996), versión en castellano (Sevilla-González et al., 2020).
//  · Ítems adaptados del Modelo de Aceptación Tecnológica (Davis, 1989).

export const SUS_ITEMS = [
  'Creo que me gustaría utilizar este sistema con frecuencia.',
  'Encontré el sistema innecesariamente complejo.',
  'Pensé que el sistema era fácil de usar.',
  'Creo que necesitaría el apoyo de un técnico para poder utilizar este sistema.',
  'Encontré que las diversas funciones de este sistema estaban bien integradas.',
  'Pensé que había demasiada inconsistencia en este sistema.',
  'Imagino que la mayoría de las personas aprenderían a utilizar este sistema muy rápidamente.',
  'Encontré el sistema muy complicado de usar.',
  'Me sentí muy seguro/a utilizando el sistema.',
  'Necesité aprender muchas cosas antes de poder empezar a utilizar este sistema.',
];

export const TAM_ITEMS: { id: string; group: string; text: string }[] = [
  { id: 'UP1', group: 'Utilidad percibida', text: 'Usar MICE Design me permitiría preparar propuestas de eventos más rápidamente.' },
  { id: 'UP2', group: 'Utilidad percibida', text: 'Usar MICE Design mejoraría la comunicación con el cliente.' },
  { id: 'UP3', group: 'Utilidad percibida', text: 'Usar MICE Design reduciría los errores e imprevistos durante el montaje.' },
  { id: 'UP4', group: 'Utilidad percibida', text: 'En general, MICE Design me resultaría útil en mi trabajo.' },
  { id: 'FU1', group: 'Facilidad de uso percibida', text: 'Aprender a usar MICE Design me resultaría fácil.' },
  { id: 'FU2', group: 'Facilidad de uso percibida', text: 'Me resulta fácil conseguir que MICE Design haga lo que quiero.' },
  { id: 'FU3', group: 'Facilidad de uso percibida', text: 'La interacción con MICE Design es clara y comprensible.' },
  { id: 'FU4', group: 'Facilidad de uso percibida', text: 'En general, MICE Design me resulta fácil de usar.' },
  { id: 'FR1', group: 'Fiabilidad del diseño', text: 'El espacio digital se corresponde con el espacio real.' },
  { id: 'FR2', group: 'Fiabilidad del diseño', text: 'Ver el mobiliario real del hotel hace el diseño más fiable que con modelos genéricos.' },
  { id: 'FR3', group: 'Fiabilidad del diseño', text: 'Después de ver el diseño tengo una idea clara de cómo quedará el evento.' },
  { id: 'IU1', group: 'Intención de uso', text: 'Si estuviera disponible, utilizaría MICE Design para planificar o contratar eventos.' },
];

export const DEFAULT_TASKS = [
  'Crear el espacio a partir de las medidas del plano.',
  'Añadir dos salidas de emergencia y una columna.',
  'Generar un montaje de banquete para 120 personas.',
  'Usar la silla escaneada del hotel en todas las mesas.',
  'Cambiar el color de la mantelería y mover una mesa.',
  'Revisar el aforo y corregir un aviso de seguridad.',
  'Recorrer el espacio en primera persona.',
  'Generar la orden de montaje en PDF.',
];

type TaskResult = { time: number; outcome: '' | 'sí' | 'con ayuda' | 'no'; errors: number };

interface Response {
  id: string;
  date: string;
  participant: string;
  role: string;
  age: string;
  experience: string;
  tasks: TaskResult[];
  sus: (number | null)[];
  tam: Record<string, number | null>;
  comments: string;
}

const KEY = 'mice-design-evaluacion';

function load(): Response[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}
function persist(r: Response[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(r));
  } catch {
    /* almacenamiento no disponible */
  }
}

export function susScore(s: (number | null)[]) {
  if (s.some((v) => v === null)) return null;
  const sum = s.reduce<number>((acc, v, i) => acc + (i % 2 === 0 ? (v as number) - 1 : 5 - (v as number)), 0);
  return sum * 2.5;
}

/** Interpretación adjetiva (Bangor, Kortum y Miller, 2009). */
export function susAdjective(score: number) {
  if (score >= 85.5) return 'Excelente';
  if (score >= 72.6) return 'Buena';
  if (score >= 52.1) return 'Aceptable';
  if (score >= 38.6) return 'Pobre';
  return 'Inaceptable';
}

const blank = (tasks: string[]): Response => ({
  id: Math.random().toString(36).slice(2, 9),
  date: new Date().toISOString(),
  participant: '',
  role: 'Personal comercial / eventos del hotel',
  age: '',
  experience: '3',
  tasks: tasks.map(() => ({ time: 0, outcome: '', errors: 0 })),
  sus: Array(10).fill(null),
  tam: Object.fromEntries(TAM_ITEMS.map((t) => [t.id, null])),
  comments: '',
});

export default function Survey({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<'tareas' | 'sus' | 'tam' | 'resultados'>('tareas');
  const [tasks, setTasks] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY + '-tareas') || 'null') ?? DEFAULT_TASKS;
    } catch {
      return DEFAULT_TASKS;
    }
  });
  const [all, setAll] = useState<Response[]>(load);
  const [cur, setCur] = useState<Response>(() => blank(tasks));
  const [running, setRunning] = useState<number | null>(null);
  const startRef = useRef(0);
  const [, force] = useState(0);

  useEffect(() => {
    if (running === null) return;
    const t = setInterval(() => force((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [running]);

  const toggleTimer = (i: number) => {
    if (running === i) {
      const elapsed = (Date.now() - startRef.current) / 1000;
      const t = [...cur.tasks];
      t[i] = { ...t[i], time: Math.round((t[i].time + elapsed) * 10) / 10 };
      setCur({ ...cur, tasks: t });
      setRunning(null);
    } else if (running === null) {
      startRef.current = Date.now();
      setRunning(i);
    }
  };

  const save = () => {
    const next = [...all.filter((r) => r.id !== cur.id), cur];
    setAll(next);
    persist(next);
    setCur(blank(tasks));
    setTab('resultados');
  };

  const score = susScore(cur.sus);

  const stats = useMemo(() => {
    const scores = all.map((r) => susScore(r.sus)).filter((s): s is number => s !== null);
    const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const sd = scores.length > 1 ? Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1)) : 0;
    const groups = [...new Set(TAM_ITEMS.map((t) => t.group))].map((g) => {
      const ids = TAM_ITEMS.filter((t) => t.group === g).map((t) => t.id);
      const vals = all.flatMap((r) => ids.map((id) => r.tam[id]).filter((v): v is number => v !== null));
      return { group: g, mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0, n: vals.length };
    });
    const taskStats = tasks.map((_, i) => {
      const rs = all.map((r) => r.tasks[i]).filter((t) => t && t.outcome);
      return {
        success: rs.length ? rs.filter((t) => t.outcome === 'sí').length / rs.length : 0,
        help: rs.length ? rs.filter((t) => t.outcome === 'con ayuda').length / rs.length : 0,
        time: rs.length ? rs.reduce((a, t) => a + t.time, 0) / rs.length : 0,
        n: rs.length,
      };
    });
    return { scores, mean, sd, groups, taskStats };
  }, [all, tasks]);

  const exportCsv = () => {
    const head = [
      'id',
      'fecha',
      'participante',
      'perfil',
      'edad',
      'experiencia_3d',
      ...tasks.flatMap((_, i) => [`T${i + 1}_tiempo_s`, `T${i + 1}_resultado`, `T${i + 1}_errores`]),
      ...SUS_ITEMS.map((_, i) => `SUS${i + 1}`),
      'SUS_puntuacion',
      ...TAM_ITEMS.map((t) => t.id),
      'comentarios',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = all.map((r) =>
      [
        r.id,
        r.date,
        r.participant,
        r.role,
        r.age,
        r.experience,
        ...tasks.flatMap((_, i) => [r.tasks[i]?.time ?? '', r.tasks[i]?.outcome ?? '', r.tasks[i]?.errors ?? '']),
        ...r.sus,
        susScore(r.sus) ?? '',
        ...TAM_ITEMS.map((t) => r.tam[t.id] ?? ''),
        r.comments,
      ]
        .map(esc)
        .join(';'),
    );
    downloadBlob(new Blob(['﻿' + [head.map(esc).join(';'), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' }), 'mice-design_evaluacion.csv');
  };

  return (
    <div className="survey">
      <header className="survey-head">
        <button className="btn ghost" onClick={onBack}>
          ← Volver
        </button>
        <h1>Evaluación con usuarios</h1>
        <nav className="tabs">
          {(['tareas', 'sus', 'tam', 'resultados'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {{ tareas: '1. Tareas', sus: '2. SUS', tam: '3. Aceptación (TAM)', resultados: `Resultados (${all.length})` }[t]}
            </button>
          ))}
        </nav>
      </header>

      <main className="survey-body">
        {tab !== 'resultados' && (
          <div className="card">
            <div className="grid4">
              <label className="field">
                <span className="field-label">Código del participante</span>
                <input value={cur.participant} onChange={(e) => setCur({ ...cur, participant: e.target.value })} placeholder="P01" />
              </label>
              <label className="field">
                <span className="field-label">Perfil</span>
                <select value={cur.role} onChange={(e) => setCur({ ...cur, role: e.target.value })}>
                  <option>Personal comercial / eventos del hotel</option>
                  <option>Cliente / organizador de eventos</option>
                  <option>Dirección del hotel</option>
                  <option>Otro</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Edad</span>
                <select value={cur.age} onChange={(e) => setCur({ ...cur, age: e.target.value })}>
                  <option value="">—</option>
                  <option>18-24</option>
                  <option>25-34</option>
                  <option>35-44</option>
                  <option>45-54</option>
                  <option>55+</option>
                </select>
              </label>
              <label className="field">
                <span className="field-label">Experiencia con 3D (1-5)</span>
                <select value={cur.experience} onChange={(e) => setCur({ ...cur, experience: e.target.value })}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {tab === 'tareas' && (
          <div className="card">
            <p className="hint">
              Pide al participante que realice cada tarea en la herramienta (en otra pestaña o dispositivo). Cronometra cada una y anota si la completa sin ayuda, con ayuda o no la
              completa, y el número de errores.
            </p>
            <table className="task-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tarea</th>
                  <th>Tiempo</th>
                  <th>Completada</th>
                  <th>Errores</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => {
                  const r = cur.tasks[i] ?? { time: 0, outcome: '', errors: 0 };
                  const live = running === i ? r.time + (Date.now() - startRef.current) / 1000 : r.time;
                  const upd = (patch: Partial<TaskResult>) => {
                    const ts = [...cur.tasks];
                    ts[i] = { ...r, ...patch };
                    setCur({ ...cur, tasks: ts });
                  };
                  return (
                    <tr key={i}>
                      <td>T{i + 1}</td>
                      <td>
                        <input
                          className="task-text"
                          value={t}
                          onChange={(e) => {
                            const n = [...tasks];
                            n[i] = e.target.value;
                            setTasks(n);
                            try {
                              localStorage.setItem(KEY + '-tareas', JSON.stringify(n));
                            } catch {
                              /* noop */
                            }
                          }}
                        />
                      </td>
                      <td>
                        <button className={`btn small ${running === i ? 'danger' : ''}`} disabled={running !== null && running !== i} onClick={() => toggleTimer(i)}>
                          {running === i ? '■' : '▶'} {live.toFixed(1)} s
                        </button>
                      </td>
                      <td>
                        <select value={r.outcome} onChange={(e) => upd({ outcome: e.target.value as TaskResult['outcome'] })}>
                          <option value="">—</option>
                          <option value="sí">Sí, sin ayuda</option>
                          <option value="con ayuda">Con ayuda</option>
                          <option value="no">No</option>
                        </select>
                      </td>
                      <td>
                        <input type="number" min={0} className="tiny" value={r.errors} onChange={(e) => upd({ errors: parseInt(e.target.value) || 0 })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button className="btn primary" onClick={() => setTab('sus')}>
              Siguiente: cuestionario SUS →
            </button>
          </div>
        )}

        {tab === 'sus' && (
          <div className="card">
            <p className="hint">Indica tu grado de acuerdo: 1 = totalmente en desacuerdo · 5 = totalmente de acuerdo.</p>
            {SUS_ITEMS.map((q, i) => (
              <Likert key={i} n={i + 1} text={q} max={5} value={cur.sus[i]} onChange={(v) => setCur({ ...cur, sus: cur.sus.map((x, j) => (j === i ? v : x)) })} />
            ))}
            <div className="callout">
              Puntuación SUS: <strong>{score === null ? 'responde todas las preguntas' : `${score.toFixed(1)} / 100 · ${susAdjective(score)}`}</strong>
            </div>
            <button className="btn primary" onClick={() => setTab('tam')}>
              Siguiente: aceptación tecnológica →
            </button>
          </div>
        )}

        {tab === 'tam' && (
          <div className="card">
            <p className="hint">1 = totalmente en desacuerdo · 7 = totalmente de acuerdo.</p>
            {[...new Set(TAM_ITEMS.map((t) => t.group))].map((g) => (
              <div key={g}>
                <h3>{g}</h3>
                {TAM_ITEMS.filter((t) => t.group === g).map((t) => (
                  <Likert key={t.id} n={t.id} text={t.text} max={7} value={cur.tam[t.id]} onChange={(v) => setCur({ ...cur, tam: { ...cur.tam, [t.id]: v } })} />
                ))}
              </div>
            ))}
            <label className="field">
              <span className="field-label">Comentarios y sugerencias</span>
              <textarea rows={3} value={cur.comments} onChange={(e) => setCur({ ...cur, comments: e.target.value })} />
            </label>
            <button className="btn primary" onClick={save}>
              Guardar respuesta del participante
            </button>
          </div>
        )}

        {tab === 'resultados' && (
          <div className="card">
            <div className="stats">
              <div className="stat">
                <span>Participantes</span>
                <strong>{all.length}</strong>
              </div>
              <div className="stat">
                <span>SUS medio</span>
                <strong>{stats.scores.length ? stats.mean.toFixed(1) : '—'}</strong>
                <em>{stats.scores.length ? `${susAdjective(stats.mean)} · DE ${stats.sd.toFixed(1)}` : ''}</em>
              </div>
              {stats.groups.map((g) => (
                <div className="stat" key={g.group}>
                  <span>{g.group}</span>
                  <strong>{g.n ? g.mean.toFixed(2) : '—'}</strong>
                  <em>media sobre 7</em>
                </div>
              ))}
            </div>
            <h3>Tareas</h3>
            <table className="task-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tarea</th>
                  <th>Éxito sin ayuda</th>
                  <th>Con ayuda</th>
                  <th>Tiempo medio</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t, i) => (
                  <tr key={i}>
                    <td>T{i + 1}</td>
                    <td>{t}</td>
                    <td>{stats.taskStats[i].n ? `${Math.round(stats.taskStats[i].success * 100)} %` : '—'}</td>
                    <td>{stats.taskStats[i].n ? `${Math.round(stats.taskStats[i].help * 100)} %` : '—'}</td>
                    <td>{stats.taskStats[i].n ? `${stats.taskStats[i].time.toFixed(1)} s` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3>Respuestas</h3>
            <table className="task-table">
              <thead>
                <tr>
                  <th>Participante</th>
                  <th>Perfil</th>
                  <th>SUS</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {all.map((r) => (
                  <tr key={r.id}>
                    <td>{r.participant || r.id}</td>
                    <td>{r.role}</td>
                    <td>{susScore(r.sus)?.toFixed(1) ?? 'incompleto'}</td>
                    <td>
                      <ConfirmButton
                        title="Eliminar respuesta"
                        onConfirm={() => {
                          const n = all.filter((x) => x.id !== r.id);
                          setAll(n);
                          persist(n);
                        }}
                      >
                        ✕
                      </ConfirmButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row gap">
              <button className="btn primary" onClick={exportCsv} disabled={!all.length}>
                Exportar CSV (Excel / SPSS)
              </button>
              <button className="btn" onClick={() => setTab('tareas')}>
                + Nuevo participante
              </button>
            </div>
            <p className="hint">Las respuestas se guardan solo en este navegador. Exporta el CSV al terminar cada sesión.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function Likert({ n, text, max, value, onChange }: { n: number | string; text: string; max: number; value: number | null; onChange: (v: number) => void }) {
  return (
    <div className="likert">
      <p>
        <span className="likert-n">{n}.</span> {text}
      </p>
      <div className="likert-opts" role="radiogroup">
        {Array.from({ length: max }, (_, i) => i + 1).map((v) => (
          <button key={v} role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}
