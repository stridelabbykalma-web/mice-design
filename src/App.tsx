import { useEffect, useState } from 'react';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { useStore } from './store';
import Scene, { sceneApi } from './components/Scene';
import StartScreen from './components/StartScreen';
import SpacePanel, { VideoReference } from './components/SpacePanel';
import { CatalogPanel, EventPanel, LayoutPanel, PropertiesPanel, SafetyPanel } from './components/Panels';
import OrderSheet from './components/OrderSheet';
import Survey from './components/Survey';
import { RectifyHost } from './components/Rectify';
import { PhotoMeasureHost } from './components/PhotoMeasure';
import { CompareModal, VariantMenu } from './components/Variants';
import { downloadBlob, exportProject } from './lib/db';
import { analyze, capacitySummary } from './lib/safety';
import { LAYOUT_INFO } from './lib/layouts';
import type { LayoutType, LightingPreset, ViewMode } from './types';
import { m } from './components/ui';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function capture(view: ViewMode): Promise<string | undefined> {
  const st = useStore.getState();
  const prev = st.view;
  const sel = st.selection;
  st.select([]);
  if (prev !== view) {
    st.setView(view);
    // Tiempo para montar la vista y cargar texturas y escaneos
    await sleep(st.project?.space.model ? 2000 : 1200);
  } else await sleep(150);
  const url = sceneApi.gl?.domElement.toDataURL('image/png');
  if (prev !== view) st.setView(prev);
  st.select(sel);
  return url;
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase() || 'proyecto';

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
      const st = useStore.getState();
      if (!st.project || st.clientMode) return;
      const mod = e.ctrlKey || e.metaKey;
      const sel = st.selection;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        return e.shiftKey ? st.redo() : st.undo();
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        return st.redo();
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        return st.duplicate(sel);
      }
      if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        return st.select(st.project.items.map((i) => i.id));
      }
      if (e.key === 'Escape') {
        st.setTool('select');
        st.select([]);
        return;
      }
      if (st.view === 'paseo') return;
      if (e.key === 'm' || e.key === 'M') return st.setTool(st.tool === 'measure' ? 'select' : 'measure');
      if (!sel.length) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        return st.removeItems(sel);
      }
      const rot = { q: -15, e: 15, r: 90 }[e.key.toLowerCase()];
      if (rot) return st.rotateItems(sel, rot);
      const step = e.shiftKey ? 0.5 : 0.1;
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        st.updateItems(st.withDecor(sel), (i) => ({ x: Math.round((i.x + mv[0]) * 100) / 100, z: Math.round((i.z + mv[1]) * 100) / 100 }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

const PANELS = [
  { id: 'espacio', label: 'Espacio', icon: '▢' },
  { id: 'catalogo', label: 'Catálogo', icon: '◈' },
  { id: 'montaje', label: 'Montajes', icon: '▦' },
  { id: 'evento', label: 'Evento y presupuesto', icon: '€' },
  { id: 'seguridad', label: 'Aforo y seguridad', icon: '⚠' },
];

function Editor() {
  const project = useStore((s) => s.project)!;
  const st = useStore();
  const [order, setOrder] = useState<{ plan?: string; view?: string } | null>(null);
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState('');
  const [mobilePanel, setMobilePanel] = useState(false);
  useKeyboard();

  const res = analyze(project);
  const errors = res.checks.filter((c) => c.severity === 'error').length;
  const cap = capacitySummary(project);

  const openOrder = async () => {
    setBusy('Preparando la orden de montaje…');
    const view = await capture(st.view === 'planta' || st.view === 'paseo' ? '3d' : st.view);
    const plan = await capture('planta');
    setBusy('');
    setOrder({ plan, view });
  };

  const exportGlb = () => {
    const root = sceneApi.exportRoot;
    if (!root) return;
    new GLTFExporter().parse(
      root,
      (out) => downloadBlob(new Blob([out as ArrayBuffer], { type: 'model/gltf-binary' }), `${slug(project.name)}.glb`),
      () => setBusy(''),
      { binary: true, onlyVisible: true },
    );
  };

  if (st.clientMode) return <ClientView />;

  return (
    <div className="editor">
      <header className="toolbar">
        <button className="btn ghost" onClick={st.closeProject} title="Volver a proyectos">
          ← <span className="hide-sm">Proyectos</span>
        </button>
        <div className="title">
          <strong>{project.name}</strong>
          <span>
            {project.space.name} · {m(project.space.width, 1)}×{m(project.space.depth, 1)} m · {cap.total} pax
          </span>
        </div>
        <VariantMenu onCompare={() => setCompare(true)} />
        <div className="seg" role="group" aria-label="Vista">
          {(['3d', 'planta', 'paseo'] as ViewMode[]).map((v) => (
            <button key={v} className={st.view === v ? 'active' : ''} onClick={() => st.setView(v)}>
              {{ '3d': '3D', planta: 'Planta', paseo: 'Paseo' }[v]}
            </button>
          ))}
        </div>
        <div className="seg hide-sm" role="group" aria-label="Herramienta">
          <button className={st.tool !== 'measure' ? 'active' : ''} onClick={() => st.setTool('select')} title="Seleccionar y mover (Esc)">
            ↖ Mover
          </button>
          <button className={st.tool === 'measure' ? 'active' : ''} onClick={() => st.setTool(st.tool === 'measure' ? 'select' : 'measure')} title="Medir distancias (M)">
            📏 Medir
          </button>
        </div>
        <button className="icon-btn hide-sm" onClick={st.undo} disabled={!st.past.length} title="Deshacer (Ctrl+Z)">
          ↶
        </button>
        <button className="icon-btn hide-sm" onClick={st.redo} disabled={!st.future.length} title="Rehacer (Ctrl+Y)">
          ↷
        </button>
        <select className="light-select" value={project.lighting} onChange={(e) => st.setLighting(e.target.value as LightingPreset)} title="Ambiente de iluminación">
          <option value="dia">☀️ Día</option>
          <option value="tarde">🌇 Tarde</option>
          <option value="noche">🌙 Noche</option>
          <option value="gala">✨ Gala</option>
        </select>
        <div className="spacer" />
        <details className="menu">
          <summary className="btn">Exportar ▾</summary>
          <div className="menu-list" onClick={(e) => (e.currentTarget.closest('details') as HTMLDetailsElement).removeAttribute('open')}>
            <button
              onClick={async () => {
                const url = await capture(st.view);
                if (url) downloadBlob(await (await fetch(url)).blob(), `${slug(project.name)}_${st.view}.png`);
              }}
            >
              Imagen de la vista actual (PNG)
            </button>
            <button onClick={openOrder}>Orden de montaje / propuesta (PDF)</button>
            <button onClick={exportGlb}>Modelo 3D del evento (.glb)</button>
            <button
              onClick={async () => {
                setBusy('Empaquetando proyecto…');
                downloadBlob(await exportProject(project), `${slug(project.name)}.mice.json`);
                setBusy('');
              }}
            >
              Proyecto completo (.mice.json)
            </button>
          </div>
        </details>
        <button className="btn primary" onClick={() => st.setClientMode(true)} title="Presentación para el cliente">
          Vista cliente
        </button>
      </header>

      <div className="workspace">
        <nav className="rail">
          {PANELS.map((p) => (
            <button
              key={p.id}
              className={st.panel === p.id ? 'active' : ''}
              onClick={() => {
                st.setPanel(p.id);
                setMobilePanel(true);
              }}
              title={p.label}
            >
              <span className="rail-icon">{p.icon}</span>
              <span className="rail-label">{p.label}</span>
              {p.id === 'seguridad' && errors > 0 && <span className="dot">{errors}</span>}
            </button>
          ))}
        </nav>
        <aside className={`sidebar ${mobilePanel ? 'mobile-open' : ''}`}>
          <div className="sidebar-head">
            <h2>{PANELS.find((p) => p.id === st.panel)?.label}</h2>
            <button className="icon-btn show-sm" onClick={() => setMobilePanel(false)}>
              ✕
            </button>
          </div>
          {st.panel === 'espacio' && <SpacePanel />}
          {st.panel === 'catalogo' && <CatalogPanel />}
          {st.panel === 'montaje' && <LayoutPanel />}
          {st.panel === 'evento' && <EventPanel onOrder={openOrder} />}
          {st.panel === 'seguridad' && <SafetyPanel />}
        </aside>
        <main className="viewport">
          <Scene />
          {st.tool === 'place' && (
            <div className="hint-bar">
              Haz clic en el espacio para colocar · Mayús para colocar varios · Esc para cancelar
              <button className="link" onClick={() => st.setTool('select')}>
                Cancelar
              </button>
            </div>
          )}
          {st.tool === 'eyedropper' && (
            <div className="hint-bar">
              {st.picked ? <span className="swatch" style={{ background: st.picked }} /> : null}
              {st.picked ? 'Aplicar a:' : 'Haz clic en el espacio para copiar un color real'}
              {st.picked && (
                <>
                  {st.selection.length > 0 && (
                    <button className="link" onClick={() => st.updateItems(st.selection, () => ({ color: st.picked! }))}>
                      selección
                    </button>
                  )}
                  <button className="link" onClick={() => st.updateSpace({ wallColor: st.picked! })}>
                    paredes
                  </button>
                  <button className="link" onClick={() => st.updateSpace({ floorColor: st.picked! })}>
                    suelo
                  </button>
                  <button
                    className="link"
                    onClick={() => {
                      const ids = project.items.filter((i) => i.type.startsWith('mesa') || i.type === 'buffet').map((i) => i.id);
                      st.updateItems(ids, () => ({ color: st.picked! }));
                    }}
                  >
                    mantelerías
                  </button>
                </>
              )}
              <button className="link" onClick={() => st.setTool('select')}>
                Terminar
              </button>
            </div>
          )}
          {st.tool === 'measure' && (
            <div className="hint-bar">
              Marca dos puntos para medir · M o Esc para salir
              <button className="link" onClick={() => st.setTool('select')}>
                Terminar
              </button>
            </div>
          )}
          {st.view !== 'paseo' && <PropertiesPanel />}
          <VideoReference />
          {busy && <div className="busy">{busy}</div>}
        </main>
      </div>
      {order && <OrderSheet images={order} onClose={() => setOrder(null)} />}
      {compare && <CompareModal capture={capture} onClose={() => setCompare(false)} />}
      <RectifyHost />
      <PhotoMeasureHost />
    </div>
  );
}

function ClientView() {
  const project = useStore((s) => s.project)!;
  const st = useStore();
  const cap = capacitySummary(project);
  const ev = project.event;
  return (
    <div className="editor client">
      <header className="toolbar">
        <div className="title">
          <strong>{ev.name || project.name}</strong>
          <span>
            {project.hotel ? `${project.hotel} · ` : ''}
            {project.space.name}
          </span>
        </div>
        <div className="seg">
          {(['3d', 'planta', 'paseo'] as ViewMode[]).map((v) => (
            <button key={v} className={st.view === v ? 'active' : ''} onClick={() => st.setView(v)}>
              {{ '3d': 'Vista 3D', planta: 'Plano', paseo: 'Recorrido' }[v]}
            </button>
          ))}
        </div>
        <VariantMenu client />
        <select className="light-select" value={project.lighting} onChange={(e) => st.setLighting(e.target.value as LightingPreset)}>
          <option value="dia">☀️ Día</option>
          <option value="tarde">🌇 Tarde</option>
          <option value="noche">🌙 Noche</option>
          <option value="gala">✨ Gala</option>
        </select>
        <div className="spacer" />
        <button className="btn" onClick={() => st.setClientMode(false)}>
          Salir de la vista cliente
        </button>
      </header>
      <main className="viewport">
        <Scene />
        <div className="client-card">
          <h3>{ev.client || 'Propuesta de evento'}</h3>
          <dl>
            {ev.date && (
              <>
                <dt>Fecha</dt>
                <dd>{new Date(ev.date + 'T12:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
              </>
            )}
            {ev.time && (
              <>
                <dt>Horario</dt>
                <dd>{ev.time}</dd>
              </>
            )}
            <dt>Montaje</dt>
            <dd>{ev.layout ? LAYOUT_INFO[ev.layout as LayoutType].name : 'Personalizado'}</dd>
            <dt>Asistentes</dt>
            <dd>{ev.pax || cap.total}</dd>
            <dt>Espacio</dt>
            <dd>
              {m(project.space.width * project.space.depth, 0)} m² · {m(project.space.height, 1)} m de altura
            </dd>
          </dl>
          {ev.notes && <p>{ev.notes}</p>}
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const project = useStore((s) => s.project);
  const [survey, setSurvey] = useState(false);
  if (survey) return <Survey onBack={() => setSurvey(false)} />;
  return project ? <Editor /> : <StartScreen onSurvey={() => setSurvey(true)} />;
}
