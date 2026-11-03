import { useEffect, useState } from 'react';
import type { Project, SpaceMethod } from '../types';
import { db, importProject } from '../lib/db';
import { blankSpace, demoProject } from '../lib/demo';
import { newProject, useStore } from '../store';
import { ConfirmButton, Field, FileButton, NumberInput, isEmbedded } from './ui';

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

  const refresh = () => db.listProjects().then(setProjects);
  useEffect(() => {
    refresh();
  }, []);

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
          <button className="btn primary" onClick={openDemo}>
            Abrir proyecto de ejemplo
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

        <h2>Proyectos guardados</h2>
        {projects.length === 0 ? (
          <p className="muted">Todavía no hay proyectos. Se guardan automáticamente en este navegador.</p>
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
                    refresh();
                  }}
                >
                  ✕
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="start-foot">MICE Design · Prototipo del Trabajo de Fin de Grado · curso 2026-2027</footer>
    </div>
  );
}
