import { BUILD } from '../lib/version';
import { EXAMPLE_ROOMS, exampleProject } from '../lib/examples';
import { roomArea } from '../lib/outline';
import { useEffect, useState } from 'react';
import type { Project, SpaceMethod } from '../types';
import { db, downloadBlob, importProject } from '../lib/db';
import { exportLibrary, importLibrary, useLibrary } from '../lib/library';
import { projectFromRoom } from '../lib/rooms';
import { SyncSection, usePendingOpen } from './SyncPanel';
import { HeadsetMeasure } from './XrButton';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/sync';
import { blankSpace, demoProject, demoScanProject } from '../lib/demo';
import { newProject, useStore } from '../store';
import { ConfirmButton, Field, FileButton, NumberInput, isEmbedded, m } from './ui';

const METHODS: { id: SpaceMethod; title: string; text: string; icon: string; when: string }[] = [
  {
    id: 'plano',
    title: 'Desde el plano',
    icon: '📐',
    text: 'Introduce las medidas del salón y, si quieres, superpón el plano del hotel (imagen) a escala.',
    when: 'Medidas exactas. Ideal si el hotel tiene planos.',
  },
  {
    id: 'fotogrametria',
    title: 'Fotogrametría / escaneo 3D',
    icon: '📷',
    text: 'Importa el modelo 3D (.glb) reconstruido a partir de fotos o del LiDAR del móvil.',
    when: 'Máxima fidelidad en materiales y acabados.',
  },
  {
    id: 'satelite',
    title: 'Vista satélite',
    icon: '🛰️',
    text: 'Busca la dirección del hotel y usa la imagen satélite como base para eventos al aire libre.',
    when: 'Terrazas, jardines y piscinas.',
  },
  {
    id: 'video',
    title: 'A partir de vídeo',
    icon: '🎥',
    text: 'Usa un vídeo del espacio como referencia y extrae fotogramas para reconstruirlo.',
    when: 'Cuando no hay planos ni sesión fotográfica.',
  },
];

export default function StartScreen({ onSurvey }: { onSurvey: () => void }) {
  const openProject = useStore((s) => s.openProject);
  const [projects, setProjects] = useState<Project[]>([]);
  const [method, setMethod] = useState<SpaceMethod | null>(null);
  const [name, setName] = useState('');
  const [hotel, setHotel] = useState('');
  const [spaceName, setSpaceName] = useState('');
  const [dims, setDims] = useState({ w: 20, d: 14, h: 3.5 });
  const [error, setError] = useState('');
  const role = useAuth((a) => a.hotel?.role);

  const refresh = () => db.listProjects().then(setProjects);
  const lastSync = useSync((s) => s.last);
  useEffect(() => {
    refresh();
  }, [lastSync]);

  // Código de gafas con proyecto: se abre solo en cuanto llega de la nube
  usePendingOpen(async (id) => {
    const p = await db.getProject(id);
    if (p) openProject(p);
  });
  const viewer = useAuth((s) => s.hotel?.role === 'viewer');
  const hotelName = useAuth((s) => s.hotel?.name);
  if (viewer)
    return (
      <div className="start">
        <main className="start-main">
          <div className="brand dark">
            <span className="logo">◆</span> MICE Design · {hotelName}
          </div>
          <SyncSection />
          <h2>Proyectos</h2>
          {projects.length === 0 ? (
            <p className="muted">Cargando los proyectos del hotel…</p>
          ) : (
            <div className="project-list">
              {projects.map((p) => (
                <div key={p.id} className="project-card">
                  <button className="project-open big" onClick={() => openProject(p)}>
                    <strong>{p.name}</strong>
                    <span>{p.space.name}</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    );

  const create = () => {
    if (!method) return;
    const space = blankSpace(method, spaceName || (method === 'satelite' ? 'Jardín' : 'Salón'), dims.w, dims.d, dims.h);
    const p = newProject(space, name || 'Nuevo evento', hotel);
    db.saveProject(p);
    openProject(p);
  };

  const openDemo = () => {
    const p = demoProject();
    db.saveProject(p);
    openProject(p);
  };

  return (
    <div className="start">
      <header className="start-hero">
        <div className="brand">
          <span className="logo">◆</span> MICE Design
        </div>
        <h1>Diseña el evento en el espacio real del hotel, antes de que ocurra.</h1>
        <p>
          Recrea el salón, la terraza o el jardín a partir del plano, de la fotogrametría, de la vista satélite o de un vídeo; móntalo con el
          mobiliario real del hotel y enséñaselo al cliente en 3D.
        </p>
        <div className="row gap">
          <button
            className="btn primary"
            onClick={async () => {
              const p = await demoScanProject();
              db.saveProject(p);
              openProject(p);
            }}
          >
            Ejemplo: gemelo digital de una sala
          </button>
          <button className="btn" onClick={openDemo}>
            Ejemplo: salón desde plano
          </button>
          <FileButton
            accept=".json,application/json"
            onFile={async (f) => {
              try {
                const p = await importProject(f);
                openProject(p);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Importar proyecto (.mice.json)
          </FileButton>
          <button className="btn ghost" onClick={onSurvey}>
            Evaluación con usuarios (SUS / TAM)
          </button>
        </div>
        {error && <p className="error">{error}</p>}
        {isEmbedded && (
          <p className="embed-note">
            Vista previa incrustada: el diseño 3D, los montajes y la evaluación funcionan completos; imprimir, descargar archivos y la búsqueda por satélite
            requieren abrir la app instalada.
          </p>
        )}
      </header>

      <main className="start-main">
        <HeadsetMeasure
          viewer={role === 'viewer'}
          create={(roomName) => {
            // Sin nombre, la sala lleva la fecha y la hora para poder distinguirla de otras
            const room = roomName.trim() || `Sala medida el ${new Date().toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`;
            const p = newProject(blankSpace('fotogrametria', room, 10, 8, 3), `Evento en ${room}`, hotel);
            db.saveProject(p).then(refresh);
            return p;
          }}
        />

        <h2>Salas de ejemplo</h2>
        <p className="hint">Salas típicas de hotel con su evento ya montado por fases. Ábrelas para probar la app o como punto de partida.</p>
        <div className="project-list">
          {EXAMPLE_ROOMS.map((ex) => (
            <div key={ex.id} className="project-card">
              <button
                className="project-open"
                onClick={() => {
                  const p = exampleProject(ex.id);
                  db.saveProject(p);
                  openProject(p);
                }}
              >
                <strong>{ex.name}</strong>
                <span>{ex.description}</span>
                <span className="muted">Abrir ejemplo →</span>
              </button>
            </div>
          ))}
        </div>

        <h2>1. ¿Cómo quieres crear el espacio digital?</h2>
        <div className="method-grid">
          {METHODS.map((m) => (
            <button key={m.id} className={`method ${method === m.id ? 'active' : ''}`} onClick={() => setMethod(m.id)}>
              <span className="method-icon">{m.icon}</span>
              <strong>{m.title}</strong>
              <span>{m.text}</span>
              <em>{m.when}</em>
            </button>
          ))}
        </div>

        {method && (
          <div className="card new-form">
            <h2>2. Datos del proyecto</h2>
            <div className="grid3">
              <Field label="Nombre del evento">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Convención anual 2027" />
              </Field>
              <Field label="Hotel">
                <input value={hotel} onChange={(e) => setHotel(e.target.value)} placeholder="Hotel …" />
              </Field>
              <Field label="Espacio">
                <input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} placeholder={method === 'satelite' ? 'Jardín de la piscina' : 'Salón Mediterráneo'} />
              </Field>
            </div>
            <div className="grid3">
              <Field label={method === 'satelite' ? 'Ancho de la zona del evento' : 'Ancho del espacio'}>
                <NumberInput value={dims.w} min={2} max={200} onChange={(w) => setDims({ ...dims, w })} suffix="m" />
              </Field>
              <Field label={method === 'satelite' ? 'Fondo de la zona del evento' : 'Fondo del espacio'}>
                <NumberInput value={dims.d} min={2} max={200} onChange={(d) => setDims({ ...dims, d })} suffix="m" />
              </Field>
              <Field label="Altura libre">
                <NumberInput value={dims.h} min={2} max={30} onChange={(h) => setDims({ ...dims, h })} suffix="m" />
              </Field>
            </div>
            <p className="hint">
              {method === 'fotogrametria'
                ? 'Las medidas se ajustarán automáticamente al importar el modelo 3D.'
                : 'Podrás cambiar las medidas y añadir columnas, puertas y salidas en el editor.'}
            </p>
            <button className="btn primary" onClick={create}>
              Crear espacio y abrir el editor →
            </button>
          </div>
        )}

        <SyncSection />

        <HotelSection />

        <h2>Proyectos guardados</h2>
        {projects.length === 0 ? (
          <p className="muted">Todavía no hay proyectos. Se guardan automáticamente.</p>
        ) : (
          <div className="project-list">
            {projects.map((p) => (
              <div key={p.id} className="project-card">
                <button className="project-open" onClick={() => openProject(p)}>
                  <strong>{p.name}</strong>
                  <span>
                    {p.hotel ? `${p.hotel} · ` : ''}
                    {p.space.name} · {p.space.width}×{p.space.depth} m
                  </span>
                  <span className="muted">
                    {p.items.length} elementos · {new Date(p.updatedAt).toLocaleString('es-ES')}
                  </span>
                </button>
                <ConfirmButton
                  title="Eliminar"
                  onConfirm={async () => {
                    await db.deleteProject(p.id);
                    window.dispatchEvent(new CustomEvent('mice-deleted', { detail: { kind: 'project', id: p.id } }));
                    refresh();
                  }}
                >
                  ✕
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
        <p className="muted" style={{ marginTop: 24, textAlign: 'center' }}>Versión del {BUILD}</p>
      </main>
      <footer className="start-foot">MICE Design · Prototipo del Trabajo de Fin de Grado · curso 2026-2027</footer>
    </div>
  );
}

function HotelSection() {
  const openProject = useStore((s) => s.openProject);
  const { entries, loaded, load, remove } = useLibrary();
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);
  const rooms = entries.filter((e) => e.kind === 'sala' && e.room);
  const nTables = entries.filter((e) => e.kind === 'mesa').length;
  const nFurniture = entries.filter((e) => e.kind === 'mueble').length;

  return (
    <>
      <h2>Catálogo del hotel</h2>
      <p className="muted">
        {plural(rooms.length, 'sala', 'salas')} · {plural(nTables, 'mesa decorada', 'mesas decoradas')} · {plural(nFurniture, 'mueble escaneado', 'muebles escaneados')}. Se digitalizan una vez y sirven para todos los eventos.
      </p>
      {rooms.length > 0 && (
        <div className="project-list">
          {rooms.map((e) => (
            <div key={e.id} className="project-card">
              <button
                className="project-open"
                onClick={() => {
                  const p = projectFromRoom(e.room!, `Evento en ${e.name}`, '');
                  db.saveProject(p);
                  openProject(p);
                }}
              >
                <strong>{e.name}</strong>
                <span>
                  {m(e.room!.space.width, 1)} × {m(e.room!.space.depth, 1)} m · {m(roomArea(e.room!.space), 0)} m²
                  {e.room!.space.model ? ' · escaneo 3D' : ''}
                </span>
                <span className="muted">Nuevo evento en esta sala →</span>
              </button>
              <ConfirmButton title="Eliminar la sala del catálogo" onConfirm={() => remove(e.id)}>
                ✕
              </ConfirmButton>
            </div>
          ))}
        </div>
      )}
      <div className="row gap wrap" style={{ marginTop: 10 }}>
        <button
          className="btn small"
          disabled={!entries.length}
          onClick={async () => downloadBlob(await exportLibrary(), 'catalogo-hotel.mice-hotel.json')}
        >
          Copia de seguridad del catálogo
        </button>
        <FileButton
          accept=".json,application/json"
          className="btn small"
          onFile={async (f) => {
            try {
              const n = await importLibrary(f);
              setMsg(`${n} elementos importados.`);
            } catch (err) {
              setMsg((err as Error).message);
            }
          }}
        >
          Importar catálogo
        </FileButton>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
