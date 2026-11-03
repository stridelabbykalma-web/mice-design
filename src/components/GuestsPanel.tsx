import { useMemo, useState } from 'react';
import { useStore } from '../store';
import type { Guest } from '../types';
import { autoAssign, dietSummary, guestsFromCsv, seatingCsv, seatingTables, tableCapacity } from '../lib/guests';
import { downloadBlob, uid } from '../lib/db';
import { ConfirmButton, FileButton, Section } from './ui';

export default function GuestsPanel() {
  const project = useStore((s) => s.project)!;
  const setGuests = useStore((s) => s.setGuests);
  const select = useStore((s) => s.select);
  const guests = project.guests ?? [];
  const tables = seatingTables(project);
  const valid = new Set(tables.map((t) => t.id));
  const [q, setQ] = useState('');
  const [onlyFree, setOnlyFree] = useState(false);
  const [msg, setMsg] = useState('');
  const [newName, setNewName] = useState('');
  const [newGroup, setNewGroup] = useState('');

  const seated = guests.filter((g) => g.tableId && valid.has(g.tableId)).length;
  const capacity = tables.reduce((a, t) => a + tableCapacity(project, t), 0);
  const occupancy = useMemo(() => {
    const m = new Map<string, number>();
    guests.forEach((g) => g.tableId && m.set(g.tableId, (m.get(g.tableId) ?? 0) + 1));
    return m;
  }, [guests]);
  const diets = dietSummary(guests);

  const update = (id: string, patch: Partial<Guest>) => setGuests(guests.map((g) => (g.id === id ? { ...g, ...patch } : g)));
  const shown = guests.filter(
    (g) =>
      (!onlyFree || !g.tableId || !valid.has(g.tableId)) &&
      (!q || `${g.name} ${g.group ?? ''} ${g.diet ?? ''}`.toLowerCase().includes(q.toLowerCase())),
  );

  return (
    <div className="panel">
      <div className={`safety-summary ${seated === guests.length && guests.length ? 'ok' : 'aviso'}`}>
        <strong>
          {seated} de {guests.length} invitados sentados
        </strong>
        <span>
          {tables.length} mesas · {capacity} plazas{capacity < guests.length ? ` · faltan ${guests.length - capacity} plazas` : ''}
        </span>
      </div>

      <Section title="Lista de invitados">
        <p className="hint">
          Importa un CSV (de Excel: «Guardar como CSV») con columnas como <em>Nombre</em>, <em>Grupo</em> o <em>Empresa</em>, <em>Mesa</em>, <em>Dieta</em> o <em>Alergias</em> y <em>Notas</em>.
        </p>
        <div className="row gap wrap">
          <FileButton
            accept=".csv,text/csv,.txt"
            className="btn small"
            onFile={async (f) => {
              const r = guestsFromCsv(await f.text(), project);
              setGuests([...guests, ...r.guests]);
              setMsg(`${r.guests.length} invitados importados${r.withTable ? `, ${r.withTable} ya con mesa` : ''}.`);
            }}
          >
            Importar CSV
          </FileButton>
          <button
            className="btn small"
            disabled={!guests.length || !tables.length}
            onClick={() => {
              const next = autoAssign(project, guests);
              setGuests(next);
              const left = next.filter((g) => !g.tableId).length;
              const byGroup = new Map<string, Set<string>>();
              next.forEach((g) => g.group && g.tableId && byGroup.set(g.group, (byGroup.get(g.group) ?? new Set()).add(g.tableId)));
              const split = [...byGroup.values()].filter((t) => t.size > 1).length;
              setMsg(
                (left ? `${left} invitados sin sitio: faltan mesas o sillas. ` : 'Todos los invitados tienen mesa. ') +
                  (split ? `${split} grupo(s) se han tenido que repartir en varias mesas por falta de sitio.` : 'Cada grupo se sienta en la misma mesa.'),
              );
            }}
          >
            Asignar mesas automáticamente
          </button>
          <button
            className="btn small"
            disabled={!guests.length}
            onClick={() => downloadBlob(new Blob([seatingCsv(project)], { type: 'text/csv;charset=utf-8' }), 'plano-de-mesas.csv')}
          >
            Exportar plano (CSV)
          </button>
        </div>
        {msg && <p className="hint">{msg}</p>}
        <div className="row gap add-guest">
          <input placeholder="Nombre" value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <input placeholder="Grupo" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          <button
            className="btn small"
            disabled={!newName.trim()}
            onClick={() => {
              setGuests([...guests, { id: uid('g_'), name: newName.trim(), group: newGroup.trim() || undefined }]);
              setNewName('');
            }}
          >
            Añadir
          </button>
        </div>
        {guests.length > 0 && (
          <>
            <div className="row gap">
              <input className="search" placeholder="Buscar invitado, grupo o dieta…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
            </div>
            <label className="toggle">
              <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} />
              <span>Solo invitados sin mesa</span>
            </label>
            <ul className="guest-list">
              {shown.map((g) => (
                <li key={g.id}>
                  <div className="guest-info">
                    <strong>{g.name}</strong>
                    <span>
                      {[g.group, g.diet && `🍽 ${g.diet}`].filter(Boolean).join(' · ') || ' '}
                    </span>
                  </div>
                  <select value={g.tableId && valid.has(g.tableId) ? g.tableId : ''} onChange={(e) => update(g.id, { tableId: e.target.value || undefined })}>
                    <option value="">Sin mesa</option>
                    {tables.map((t) => {
                      const full = (occupancy.get(t.id) ?? 0) >= tableCapacity(project, t) && g.tableId !== t.id;
                      return (
                        <option key={t.id} value={t.id} disabled={full}>
                          {t.label ?? 'Mesa'} ({occupancy.get(t.id) ?? 0}/{tableCapacity(project, t)})
                        </option>
                      );
                    })}
                  </select>
                  <ConfirmButton title="Quitar invitado" onConfirm={() => setGuests(guests.filter((x) => x.id !== g.id))}>
                    ✕
                  </ConfirmButton>
                </li>
              ))}
            </ul>
          </>
        )}
      </Section>

      {tables.length > 0 && (
        <Section title="Mesas" defaultOpen={false}>
          <ul className="plain table-occ">
            {tables.map((t) => {
              const n = occupancy.get(t.id) ?? 0;
              const cap = tableCapacity(project, t);
              return (
                <li key={t.id}>
                  <button className="link" onClick={() => select([t.id])}>
                    {t.label ?? 'Mesa'}
                  </button>{' '}
                  <span className={n > cap ? 'error' : n === cap ? 'ok-text' : 'muted'}>
                    {n}/{cap}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}

      {diets.length > 0 && (
        <Section title="Dietas y alergias (para cocina)">
          <ul className="plain">
            {diets.map(([d, n]) => (
              <li key={d}>
                {d}: <strong>{n}</strong>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** Invitados de una mesa (en el panel de propiedades). */
export function TableGuests({ tableId }: { tableId: string }) {
  const project = useStore((s) => s.project)!;
  const list = (project.guests ?? []).filter((g) => g.tableId === tableId);
  if (!list.length) return null;
  return (
    <div className="callout">
      <strong>Invitados ({list.length})</strong>
      <ul className="plain">
        {list.map((g) => (
          <li key={g.id}>
            {g.name}
            {g.diet ? <span className="muted"> · {g.diet}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
