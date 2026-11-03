import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import type { CatalogDef, Category, Item, LayoutType } from '../types';
import { BASE_CATALOG, CATEGORY_LABELS, findDef, itemCapacity, itemDims } from '../catalog';
import { addAsset, uid } from '../lib/db';
import { loadGltf } from './Furniture';
import { requestRectify } from './Rectify';
import { attachedDecor, isDecorDef, isTableDef, makeTemplate, placeSettingsFor, tableAt } from '../lib/tables';
import { saveFurnitureToLibrary, useLibrary } from '../lib/library';
import { LAYOUT_INFO, LayoutOptions, defaultOptions, generateLayout, generatedTypes } from '../lib/layouts';
import { analyze, capacitySummary } from '../lib/safety';
import { ConfirmButton, Field, FileButton, NumberInput, Section, Toggle, eur, m } from './ui';

// ===================== Catálogo =====================

const ICON: Record<string, string> = {
  'mesa-redonda-180': '◯',
  'mesa-redonda-150': '○',
  'mesa-imperial': '▭',
  'mesa-escuela': '▬',
  'mesa-coctel': '•',
  buffet: '▤',
  barra: '▥',
  silla: '⑁',
  'silla-conferencia': '⑁',
  sofa: '⊔',
  butaca: '⊓',
  escenario: '▣',
  atril: '⊥',
  pantalla: '▢',
  'pista-baile': '▦',
  planta: '✿',
  photocall: '▯',
  alfombra: '▱',
  uplight: '✦',
  foco: '✧',
  totem: '▮',
  'atril-bienvenida': '⚑',
  columna: '■',
  tabique: '▬',
  puerta: '⊓',
  salida: '⇥',
  ventana: '⊞',
  'toma-corriente': '⚡',
  cubierto: '◎',
  bajoplato: '○',
  copa: 'Y',
  vela: '¦',
  candelabro: 'Ш',
  'centro-alto': '✾',
  'centro-bajo': '❀',
  'numero-mesa': '#',
  'menu-carta': '▯',
  'camino-mesa': '▭',
  cuadro: '▣',
  espejo: '◫',
};

/** Color del icono: los colores muy claros se muestran en gris para que se vean. */
function iconColor(hex: string) {
  const n = parseInt(hex.replace('#', ''), 16);
  const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.8 ? '#8a8174' : hex;
}

export function CatalogPanel() {
  const project = useStore((s) => s.project)!;
  const placingType = useStore((s) => s.placingType);
  const startPlacing = useStore((s) => s.startPlacing);
  const [q, setQ] = useState('');
  const all = [...project.customCatalog, ...BASE_CATALOG];
  const filtered = all.filter((d) => d.name.toLowerCase().includes(q.toLowerCase()));
  const cats = Object.keys(CATEGORY_LABELS) as Category[];

  return (
    <div className="panel">
      <input className="search" placeholder="Buscar mobiliario…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
      <p className="hint">Haz clic en un elemento y después en el espacio para colocarlo. Mantén Mayús para colocar varios seguidos.</p>
      <HotelLibrary />
      <ScannedFurniture />
      {cats.map((c) => {
        const list = filtered.filter((d) => d.category === c);
        if (!list.length) return null;
        return (
          <Section key={c} title={CATEGORY_LABELS[c]} defaultOpen={c !== 'arquitectura' || project.items.length === 0}>
            <div className="catalog-grid">
              {list.map((d) => (
                <button key={d.type} className={`cat-item ${placingType === d.type ? 'active' : ''}`} onClick={() => startPlacing(d.type)} title={d.description ?? d.name}>
                  <span className="cat-icon" style={{ color: iconColor(d.color) }}>
                    {d.modelAssetId ? '◈' : ICON[d.type] ?? '◻'}
                  </span>
                  <span className="cat-name">{d.name}</span>
                  <span className="cat-meta">
                    {m(d.w)}×{m(d.d)} m{d.price ? ` · ${eur(d.price)}` : ''}
                  </span>
                </button>
              ))}
            </div>
          </Section>
        );
      })}
    </div>
  );
}

/** Tamaño del modelo en sus unidades, con la corrección de eje aplicada. */
async function measureModel(assetId: string, tilt: number) {
  const g = new THREE.Group();
  const o = (await loadGltf(assetId)).clone(true);
  o.rotation.x = (tilt * Math.PI) / 180;
  g.add(o);
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g).getSize(new THREE.Vector3());
}

/** Propone medidas en metros: los escáneres de mano (Revo Scan…) suelen exportar en milímetros. */
function guessDims(size: THREE.Vector3) {
  const max = Math.max(size.x, size.y, size.z);
  const k = max > 50 ? 0.001 : max > 5 ? 0.01 : 1; // mm, cm o m
  const r = (v: number) => Math.round(v * k * 100) / 100;
  return { w: r(size.x), d: r(size.z), h: r(size.y) };
}

type Kind = 'silla' | 'mesa-redonda' | 'mesa-rect' | 'sofa' | 'decoracion' | 'mesa-deco' | 'pared' | 'techo' | 'otro';

function ScannedFurniture() {
  const project = useStore((s) => s.project)!;
  const addCustomDef = useStore((s) => s.addCustomDef);
  const updateCustomDef = useStore((s) => s.updateCustomDef);
  const removeCustomDef = useStore((s) => s.removeCustomDef);
  const [draft, setDraft] = useState<null | { assetId: string; file: string; name: string; kind: Kind; w: number; d: number; h: number; fit: boolean; price: number; chairs: number; native: THREE.Vector3; tilt: number }>(null);
  const [err, setErr] = useState('');

  const onFile = async (f: File) => {
    setErr('');
    try {
      const id = await addAsset(f, f.name);
      const size = await measureModel(id, 0);
      setDraft({ assetId: id, file: f.name, name: f.name.replace(/\.(glb|gltf|ply)$/i, ''), kind: 'otro', ...guessDims(size), fit: true, price: 0, chairs: 0, native: size, tilt: 0 });
    } catch {
      setErr('No se pudo leer el modelo .glb.');
    }
  };

  const save = () => {
    if (!draft) return;
    const k = draft.kind;
    const def: CatalogDef = {
      type: uid('hotel_'),
      name: draft.name || 'Pieza del hotel',
      category: 'hotel',
      w: draft.w,
      d: draft.d,
      h: draft.h,
      price: draft.price,
      color: '#b08d57',
      modelAssetId: draft.assetId,
      fitToDims: draft.fit,
      tilt: draft.tilt || undefined,
      seats: k === 'silla' ? 1 : k === 'sofa' ? Math.max(1, Math.round(draft.w / 0.65)) : undefined,
      chairs: k === 'mesa-redonda' || k === 'mesa-rect' ? draft.chairs : undefined,
      wallMount: k === 'pared' ? true : undefined,
      onTable: k === 'mesa-deco' ? true : undefined,
      mountY: k === 'pared' ? 1.3 : k === 'techo' ? Math.max(2, (project.space.height || 3) - draft.h) : undefined,
      description: `Escaneado: ${draft.file}`,
    };
    addCustomDef(def);
    saveFurnitureToLibrary(def);
    setDraft(null);
  };

  return (
    <Section title={CATEGORY_LABELS.hotel} badge={project.customCatalog.length ? String(project.customCatalog.length) : undefined} defaultOpen>
      <p className="hint">
        Digitaliza los muebles reales del hotel (fotogrametría o escáner 3D) e impórtalos en <strong>.glb</strong>. Aparecerán en el diseño con sus medidas y acabados reales,
        y podrás usarlos en los montajes automáticos.
      </p>
      {!draft && (
        <FileButton accept=".glb,.gltf,.ply,model/gltf-binary" onFile={onFile}>
          + Añadir mueble escaneado (.glb / .ply)
        </FileButton>
      )}
      {err && <p className="error">{err}</p>}
      {draft && (
        <div className="sub">
          <Field label="Nombre">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label="Tipo de pieza">
            <select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as Kind;
                setDraft({ ...draft, kind, chairs: kind === 'mesa-redonda' ? Math.max(4, Math.round((Math.PI * (draft.w + 0.6)) / 0.6)) : kind === 'mesa-rect' ? Math.max(2, Math.floor(draft.w / 0.6) * 2) : 0 });
              }}
            >
              <option value="silla">Silla (1 plaza)</option>
              <option value="mesa-redonda">Mesa redonda (con sillas alrededor)</option>
              <option value="mesa-rect">Mesa rectangular (con sillas)</option>
              <option value="sofa">Sofá / banco</option>
              <option value="decoracion">Decoración de suelo (jarrón, escultura, biombo…)</option>
              <option value="mesa-deco">Decoración de mesa (centro, jarrón, lámpara de mesa…)</option>
              <option value="pared">Decoración de pared (cuadro con relieve, aplique, espejo…)</option>
              <option value="techo">Lámpara de techo / colgante</option>
              <option value="otro">Otro</option>
            </select>
          </Field>
          <Field label="Eje vertical" hint="Si el mueble aparece tumbado, el escáner lo exportó con otro eje hacia arriba.">
            <select
              value={draft.tilt}
              onChange={async (e) => {
                const tilt = parseFloat(e.target.value);
                const size = await measureModel(draft.assetId, tilt);
                setDraft({ ...draft, tilt, native: size, ...guessDims(size) });
              }}
            >
              <option value={0}>Correcto (Y hacia arriba)</option>
              <option value={-90}>Corregir: Z hacia arriba</option>
              <option value={90}>Corregir: −Z hacia arriba</option>
            </select>
          </Field>
          <p className="hint">
            Tamaño del modelo: {m(draft.native.x)} × {m(draft.native.z)} × {m(draft.native.y)} (unidades del archivo). Introduce las medidas reales tomadas en el hotel:
          </p>
          <div className="grid3">
            <Field label="Ancho">
              <NumberInput value={draft.w} min={0.05} onChange={(w) => setDraft({ ...draft, w })} suffix="m" />
            </Field>
            <Field label="Fondo">
              <NumberInput value={draft.d} min={0.05} onChange={(d) => setDraft({ ...draft, d })} suffix="m" />
            </Field>
            <Field label="Alto">
              <NumberInput value={draft.h} min={0.05} onChange={(h) => setDraft({ ...draft, h })} suffix="m" />
            </Field>
          </div>
          <Toggle checked={draft.fit} onChange={(fit) => setDraft({ ...draft, fit })} label="Ajustar el modelo a estas medidas" />
          <div className="grid2">
            {(draft.kind === 'mesa-redonda' || draft.kind === 'mesa-rect') && (
              <Field label="Sillas por mesa">
                <NumberInput value={draft.chairs} step={1} min={0} max={20} onChange={(chairs) => setDraft({ ...draft, chairs })} />
              </Field>
            )}
            <Field label="Precio por unidad">
              <NumberInput value={draft.price} step={1} min={0} onChange={(price) => setDraft({ ...draft, price })} suffix="€" />
            </Field>
          </div>
          <div className="row gap">
            <button className="btn primary small" onClick={save}>
              Añadir al catálogo
            </button>
            <button className="btn small" onClick={() => setDraft(null)}>
              Cancelar
            </button>
          </div>
        </div>
      )}
      {project.customCatalog.length > 0 && (
        <ul className="custom-list">
          {project.customCatalog.map((c) => (
            <li key={c.type}>
              <input value={c.name} onChange={(e) => updateCustomDef(c.type, { name: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
              <span className="muted">
                {m(c.w)}×{m(c.d)}×{m(c.h)} m
              </span>
              <ConfirmButton title="Eliminar del catálogo (y del diseño)" onConfirm={() => removeCustomDef(c.type)}>
                ✕
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

// ===================== Montajes =====================

export function LayoutPanel() {
  const project = useStore((s) => s.project)!;
  const addItems = useStore((s) => s.addItems);
  const updateEvent = useStore((s) => s.updateEvent);
  const [opts, setOpts] = useState<LayoutOptions>(() => ({ ...defaultOptions((project.event.layout || 'banquete') as LayoutType), pax: project.event.pax || 0 }));
  const [replace, setReplace] = useState(true);
  const [result, setResult] = useState('');
  const all = [...project.customCatalog, ...BASE_CATALOG];

  const tableOptions = all.filter((d) => {
    if (d.chairs === undefined && d.standing === undefined) return false;
    if (opts.type === 'banquete') return d.w === d.d && d.chairs !== undefined;
    if (opts.type === 'coctel') return d.standing !== undefined || d.type.startsWith('hotel_');
    return d.w !== d.d && d.chairs !== undefined;
  });
  const chairOptions = all.filter((d) => d.seats === 1);

  const preview = useMemo(() => generateLayout(project, opts), [project, opts]);

  const libTables = useLibrary((s) => s.entries).filter((e) => e.kind === 'mesa' && e.table && e.table.base.type === opts.tableType);
  const [decorId, setDecorId] = useState('');
  const apply = () => {
    const r = generateLayout(project, opts);
    addItems(r.items, replace ? generatedTypes(project) : undefined);
    // Mesa decorada del hotel: se aplica a todas las mesas generadas
    const tpl = libTables.find((e) => e.id === decorId)?.table;
    if (tpl) {
      const p = useStore.getState().project!;
      const ids = p.items.filter((i) => i.type === opts.tableType).map((i) => i.id);
      useStore.getState().applyTemplate({ ...tpl, base: { ...tpl.base, chairType: opts.chairType || tpl.base.chairType } }, ids);
    }
    updateEvent({ layout: opts.type, pax: project.event.pax || r.pax });
    setResult(r.warning ?? `Montaje generado: ${r.pax} personas.`);
  };

  return (
    <div className="panel">
      <Section title="Tipo de montaje">
        <div className="layout-grid">
          {(Object.keys(LAYOUT_INFO) as LayoutType[]).map((t) => (
            <button key={t} className={`layout-card ${opts.type === t ? 'active' : ''}`} onClick={() => setOpts({ ...defaultOptions(t), pax: opts.pax })}>
              <LayoutIcon type={t} />
              <strong>{LAYOUT_INFO[t].name}</strong>
            </button>
          ))}
        </div>
        <p className="hint">{LAYOUT_INFO[opts.type].description}</p>
      </Section>
      <Section title="Parámetros">
        <div className="grid2">
          <Field label="Personas" hint="0 = el máximo que quepa">
            <NumberInput value={opts.pax} step={10} min={0} onChange={(pax) => setOpts({ ...opts, pax: Math.round(pax) })} />
          </Field>
          <Field label="Margen a paredes">
            <NumberInput value={opts.margin} min={0.3} max={5} onChange={(margin) => setOpts({ ...opts, margin })} suffix="m" />
          </Field>
          {(opts.type === 'teatro' || opts.type === 'escuela') && (
            <Field label="Ancho de pasillos">
              <NumberInput value={opts.aisle} min={0.8} max={4} onChange={(aisle) => setOpts({ ...opts, aisle })} suffix="m" />
            </Field>
          )}
        </div>
        {opts.type !== 'teatro' && tableOptions.length > 0 && (
          <Field label="Mesa">
            <select value={opts.tableType} onChange={(e) => setOpts({ ...opts, tableType: e.target.value })}>
              {tableOptions.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.category === 'hotel' ? '◈ ' : ''}
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {libTables.length > 0 && (
          <Field label="Decoración de las mesas" hint="Mesas decoradas guardadas en el hotel para este tipo de mesa">
            <select value={decorId} onChange={(e) => setDecorId(e.target.value)}>
              <option value="">Sin decoración</option>
              {libTables.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        {opts.type !== 'coctel' && (
          <Field label="Silla">
            <select value={opts.chairType} onChange={(e) => setOpts({ ...opts, chairType: e.target.value })}>
              {chairOptions.map((d) => (
                <option key={d.type} value={d.type}>
                  {d.category === 'hotel' ? '◈ ' : ''}
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="row gap wrap">
          {(opts.type === 'teatro' || opts.type === 'escuela' || opts.type === 'u') && (
            <>
              <Toggle checked={opts.stage} onChange={(stage) => setOpts({ ...opts, stage })} label="Escenario" />
              <Toggle checked={opts.screen} onChange={(screen) => setOpts({ ...opts, screen })} label="Pantalla" />
            </>
          )}
          {opts.type === 'banquete' && <Toggle checked={opts.staggered} onChange={(staggered) => setOpts({ ...opts, staggered })} label="Mesas al tresbolillo" />}
        </div>
        <Toggle checked={replace} onChange={setReplace} label="Sustituir el mobiliario actual (se conservan la arquitectura y la decoración de pared y techo)" />
        <div className="callout">
          Vista previa: <strong>{preview.pax} personas</strong>
          {preview.warning && <div className="warn-text">{preview.warning}</div>}
        </div>
        <button className="btn primary block" onClick={apply}>
          Generar montaje
        </button>
        {result && <p className="hint">{result}</p>}
      </Section>
    </div>
  );
}

function LayoutIcon({ type }: { type: LayoutType }) {
  const dots: JSX.Element[] = [];
  const c = 'currentColor';
  if (type === 'teatro') for (let r = 0; r < 4; r++) for (let k = 0; k < 7; k++) dots.push(<rect key={`${r}${k}`} x={6 + k * 7 + (k > 2 ? 4 : 0)} y={18 + r * 7} width={4} height={4} fill={c} />);
  if (type === 'escuela') for (let r = 0; r < 3; r++) for (let k = 0; k < 2; k++) dots.push(<rect key={`${r}${k}`} x={8 + k * 26} y={18 + r * 10} width={22} height={4} fill={c} />);
  if (type === 'banquete') for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) dots.push(<circle key={`${r}${k}`} cx={14 + k * 18 + (r % 2) * 6} cy={14 + r * 13} r={5} fill="none" stroke={c} strokeWidth={2} />);
  if (type === 'coctel') for (let r = 0; r < 3; r++) for (let k = 0; k < 4; k++) dots.push(<circle key={`${r}${k}`} cx={10 + k * 14} cy={14 + r * 13} r={2.5} fill={c} />);
  if (type === 'u') dots.push(<path key="u" d="M14 14 V44 H50 V14" fill="none" stroke={c} strokeWidth={4} />);
  if (type === 'imperial') dots.push(<rect key="i" x={10} y={24} width={44} height={10} fill="none" stroke={c} strokeWidth={3} />);
  return (
    <svg viewBox="0 0 64 54" className="layout-icon" aria-hidden>
      {type !== 'banquete' && type !== 'coctel' && type !== 'imperial' && <rect x={18} y={3} width={28} height={5} fill={c} opacity={0.4} />}
      {dots}
    </svg>
  );
}

// ===================== Propiedades del elemento seleccionado =====================

export function PropertiesPanel() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const updateItems = useStore((s) => s.updateItems);
  const removeItems = useStore((s) => s.removeItems);
  const duplicate = useStore((s) => s.duplicate);
  const items = project.items.filter((i) => selection.includes(i.id));
  if (!items.length) return null;
  const first = items[0];
  const def = findDef(first.type, project.customCatalog);
  const dims = itemDims(first, def);
  const ids = items.map((i) => i.id);
  const set = (fn: (it: Item) => Partial<Item>) => updateItems(ids, fn);
  const sameType = items.every((i) => i.type === first.type);
  const chairDefs = [...project.customCatalog, ...BASE_CATALOG].filter((d) => d.seats === 1);

  return (
    <div className="props">
      <div className="props-head">
        <strong>{items.length > 1 ? `${items.length} elementos` : def?.name ?? first.type}</strong>
        <button className="icon-btn" onClick={() => useStore.getState().select([])} title="Deseleccionar (Esc)">
          ✕
        </button>
      </div>
      {items.length === 1 && (
        <div className="grid3">
          <Field label="X">
            <NumberInput value={first.x} onChange={(x) => set(() => ({ x }))} suffix="m" />
          </Field>
          <Field label="Z">
            <NumberInput value={first.z} onChange={(z) => set(() => ({ z }))} suffix="m" />
          </Field>
          <Field label="Giro">
            <NumberInput value={first.rot} step={15} onChange={(rot) => set(() => ({ rot }))} suffix="°" />
          </Field>
        </div>
      )}
      <div className="row gap wrap">
        <button className="btn small" onClick={() => useStore.getState().rotateItems(ids, -15)} title="Q">
          ⟲ 15°
        </button>
        <button className="btn small" onClick={() => useStore.getState().rotateItems(ids, 15)} title="E">
          ⟳ 15°
        </button>
        <button className="btn small" onClick={() => useStore.getState().rotateItems(ids, 90)} title="R">
          ⟳ 90°
        </button>
        <button className="btn small" onClick={() => duplicate(ids)} title="Ctrl+D">
          Duplicar
        </button>
        <button className="btn small danger" onClick={() => removeItems(ids)} title="Supr">
          Eliminar
        </button>
      </div>
      {sameType && def?.resizable && (
        <div className="grid3">
          <Field label="Ancho">
            <NumberInput value={dims.w} min={0.1} onChange={(w) => set(() => ({ w }))} suffix="m" />
          </Field>
          <Field label="Fondo">
            <NumberInput value={dims.d} min={0.03} onChange={(d) => set(() => ({ d }))} suffix="m" />
          </Field>
          <Field label="Alto">
            <NumberInput value={first.h ?? dims.h} min={0.01} onChange={(h) => set(() => ({ h }))} suffix="m" />
          </Field>
        </div>
      )}
      {items.length === 1 && first.type === 'cuadro' && (
        <div className="callout">
          <strong>Obra real</strong>
          <p className="hint">Haz una foto al cuadro (aunque sea de lado) y marca sus esquinas: la app la endereza. Indica su ancho real y el alto se calcula solo.</p>
          <FileButton
            accept="image/*"
            className="btn small"
            camera
            onFile={async (f) => {
              const r = await requestRectify(f, 'Cuadro: marca las esquinas del lienzo', 'Arrastra las 4 esquinas hasta los bordes del cuadro (sin el marco) para enderezarlo aunque la foto esté hecha de lado.');
              if (!r) return;
              const id = await addAsset(new File([r.blob], 'cuadro.jpg', { type: 'image/jpeg' }), 'cuadro.jpg');
              const w = itemDims(first, def).w;
              updateItems([first.id], () => ({ imageAssetId: id, h: Math.round((w / r.aspect) * 100) / 100 }));
            }}
          >
            {first.imageAssetId ? 'Cambiar foto del cuadro' : 'Subir foto del cuadro'}
          </FileButton>
        </div>
      )}
      {sameType && (def?.wallMount || def?.mountY !== undefined || def?.category === 'decoracion' || def?.category === 'iluminacion' || def?.category === 'hotel') && (
        <Field label={first.type === 'cuadro' || first.type === 'espejo' ? 'Altura del centro sobre el suelo' : 'Altura sobre el suelo'}>
          <NumberInput value={first.y ?? 0} min={0} max={20} step={0.05} onChange={(y) => set(() => ({ y }))} suffix="m" />
        </Field>
      )}
      {sameType && def && !def.modelAssetId && def.category !== 'arquitectura' && (
        <Field label={def.category === 'iluminacion' ? 'Color de la luz' : def.chairs !== undefined ? 'Color de la mantelería' : 'Color'}>
          <input type="color" value={first.color ?? def.color} onChange={(e) => updateItems(ids, () => ({ color: e.target.value }), false)} />
        </Field>
      )}
      {sameType && def?.chairs !== undefined && (
        <>
          <div className="grid2">
            <Field label="Sillas">
              <NumberInput value={first.chairs ?? def.chairs} step={1} min={0} max={24} onChange={(chairs) => set(() => ({ chairs: Math.round(chairs) }))} />
            </Field>
            <Field label="Tipo de silla">
              <select value={first.chairType ?? 'silla'} onChange={(e) => set(() => ({ chairType: e.target.value }))}>
                {chairDefs.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.category === 'hotel' ? '◈ ' : ''}
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Toggle checked={!!first.centerpiece} onChange={(centerpiece) => set(() => ({ centerpiece }))} label="Centro de mesa" />
        </>
      )}
      {items.length === 1 && (def?.chairs !== undefined || ['photocall', 'totem', 'atril-bienvenida'].includes(first.type)) && (
        <Field label={def?.chairs !== undefined ? 'Nombre / número de mesa' : 'Texto'}>
          {first.type === 'totem' || first.type === 'atril-bienvenida' ? (
            <textarea rows={2} value={first.label ?? ''} onChange={(e) => updateItems(ids, () => ({ label: e.target.value }), false)} onKeyDown={(e) => e.stopPropagation()} />
          ) : (
            <input value={first.label ?? ''} onChange={(e) => updateItems(ids, () => ({ label: e.target.value }), false)} onKeyDown={(e) => e.stopPropagation()} />
          )}
        </Field>
      )}
      {items.length === 1 && isTableDef(def) && <TableDecorPanel table={first} />}
      {items.length === 1 && isDecorDef(def) && (() => {
        const t = tableAt(project, first.x, first.z);
        return t ? (
          <button className="btn small" onClick={() => useStore.getState().select([t.id])}>
            Seleccionar la mesa ({t.label ?? 'mesa'})
          </button>
        ) : null;
      })()}
      <p className="hint keys">Arrastra para mover · Q/E girar · R 90° · flechas desplazar · Supr eliminar · Ctrl+Z deshacer</p>
    </div>
  );
}

// ===================== Evento y presupuesto =====================

export function budgetLines(project: ReturnType<typeof useStore.getState>['project'] & object) {
  const lines = new Map<string, { name: string; qty: number; price: number }>();
  const add = (type: string, qty: number) => {
    const d = findDef(type, project.customCatalog);
    if (!d || d.category === 'arquitectura') return;
    const l = lines.get(type) ?? { name: d.name, qty: 0, price: d.price };
    l.qty += qty;
    lines.set(type, l);
  };
  for (const it of project.items) {
    add(it.type, 1);
    const d = findDef(it.type, project.customCatalog);
    const chairs = it.chairs ?? d?.chairs ?? 0;
    if (chairs) add(it.chairType ?? 'silla', chairs);
  }
  return [...lines.values()].sort((a, b) => b.qty * b.price - a.qty * a.price);
}

export function EventPanel({ onOrder }: { onOrder: () => void }) {
  const project = useStore((s) => s.project)!;
  const updateEvent = useStore((s) => s.updateEvent);
  const renameProject = useStore((s) => s.renameProject);
  const ev = project.event;
  const cap = capacitySummary(project);
  const lines = budgetLines(project);
  const furniture = lines.reduce((a, l) => a + l.qty * l.price, 0);
  const pax = ev.pax || cap.total;
  const fnb = pax * ev.pricePerPax;
  const subtotal = furniture + fnb + ev.roomPrice;
  const iva = subtotal * 0.21;

  return (
    <div className="panel">
      <Section title="Datos del evento">
        <Field label="Proyecto">
          <input value={project.name} onChange={(e) => renameProject(e.target.value, project.hotel)} onKeyDown={(e) => e.stopPropagation()} />
        </Field>
        <div className="grid2">
          <Field label="Hotel">
            <input value={project.hotel} onChange={(e) => renameProject(project.name, e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label="Cliente">
            <input value={ev.client} onChange={(e) => updateEvent({ client: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label="Fecha">
            <input type="date" value={ev.date} onChange={(e) => updateEvent({ date: e.target.value })} />
          </Field>
          <Field label="Horario">
            <input value={ev.time} placeholder="09:00 – 18:00" onChange={(e) => updateEvent({ time: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </Field>
          <Field label="Asistentes previstos">
            <NumberInput value={ev.pax} step={10} min={0} onChange={(p) => updateEvent({ pax: Math.round(p) })} />
          </Field>
          <Field label="Tipo de montaje">
            <select value={ev.layout} onChange={(e) => updateEvent({ layout: e.target.value as LayoutType | '' })}>
              <option value="">—</option>
              {(Object.keys(LAYOUT_INFO) as LayoutType[]).map((t) => (
                <option key={t} value={t}>
                  {LAYOUT_INFO[t].name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <p className="hint">
          Plazas en el diseño: {cap.seated} sentadas{cap.standing ? ` · ${cap.standing} de pie` : ''}.
        </p>
        <Field label="Notas para el montaje y el cliente">
          <textarea rows={3} value={ev.notes} onChange={(e) => updateEvent({ notes: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
        </Field>
      </Section>
      <Section title="Presupuesto orientativo">
        <div className="grid2">
          <Field label="Alquiler del espacio">
            <NumberInput value={ev.roomPrice} step={50} min={0} onChange={(roomPrice) => updateEvent({ roomPrice })} suffix="€" />
          </Field>
          <Field label="Menú / servicio por persona">
            <NumberInput value={ev.pricePerPax} step={1} min={0} onChange={(pricePerPax) => updateEvent({ pricePerPax })} suffix="€" />
          </Field>
        </div>
        <table className="budget">
          <tbody>
            {lines.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td className="num-cell">{l.qty}</td>
                <td className="num-cell">{eur(l.qty * l.price)}</td>
              </tr>
            ))}
            <tr className="sep">
              <td>Mobiliario y montaje</td>
              <td />
              <td className="num-cell">{eur(furniture)}</td>
            </tr>
            <tr>
              <td>Alquiler del espacio</td>
              <td />
              <td className="num-cell">{eur(ev.roomPrice)}</td>
            </tr>
            <tr>
              <td>Servicio ({pax} pax × {eur(ev.pricePerPax)})</td>
              <td />
              <td className="num-cell">{eur(fnb)}</td>
            </tr>
            <tr>
              <td>IVA (21 %)</td>
              <td />
              <td className="num-cell">{eur(iva)}</td>
            </tr>
            <tr className="total">
              <td>Total</td>
              <td />
              <td className="num-cell">{eur(subtotal + iva)}</td>
            </tr>
          </tbody>
        </table>
        {pax > 0 && <p className="hint">Coste por asistente: {eur((subtotal + iva) / pax)} (IVA incl.). Precios orientativos editables en el catálogo del hotel.</p>}
        <button className="btn primary block" onClick={onOrder}>
          Orden de montaje / propuesta (PDF)
        </button>
      </Section>
    </div>
  );
}

// ===================== Seguridad y aforo =====================

export function SafetyPanel() {
  const project = useStore((s) => s.project)!;
  const select = useStore((s) => s.select);
  const res = useMemo(() => analyze(project), [project]);
  const icon = { ok: '✓', aviso: '!', error: '✕' };
  const errors = res.checks.filter((c) => c.severity === 'error').length;
  const warns = res.checks.filter((c) => c.severity === 'aviso').length;
  return (
    <div className="panel">
      <div className={`safety-summary ${errors ? 'error' : warns ? 'aviso' : 'ok'}`}>
        <strong>{errors ? `${errors} problema(s) que corregir` : warns ? `${warns} aviso(s)` : 'Todo correcto'}</strong>
        <span>
          {res.occupancy} personas · {m(res.area, 0)} m² · aforo máx. {res.maxOccupancy}
        </span>
      </div>
      <ul className="checks">
        {res.checks.map((c) => (
          <li key={c.id} className={c.severity}>
            <span className="check-icon">{icon[c.severity]}</span>
            <div>
              <strong>{c.title}</strong>
              <p>{c.detail}</p>
              {c.itemIds && c.itemIds.length > 0 && (
                <button className="link" onClick={() => select(c.itemIds!)}>
                  Seleccionar elementos afectados
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      <p className="hint">
        Comprobaciones orientativas basadas en el Código Técnico de la Edificación, DB-SI 3 (densidad de ocupación, número y anchura de salidas, recorridos de evacuación). No sustituyen
        al proyecto técnico ni al plan de autoprotección del hotel.
      </p>
      <Section title="Capacidad por elemento" defaultOpen={false}>
        <ul className="plain">
          {Object.entries(
            project.items.reduce<Record<string, number>>((acc, it) => {
              const c = itemCapacity(it, findDef(it.type, project.customCatalog));
              if (c.seated || c.standing) acc[findDef(it.type, project.customCatalog)?.name ?? it.type] = (acc[findDef(it.type, project.customCatalog)?.name ?? it.type] ?? 0) + c.seated + c.standing;
              return acc;
            }, {}),
          ).map(([k, v]) => (
            <li key={k}>
              {k}: <strong>{v}</strong> pax
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

// ===================== Decoración de una mesa =====================

function TableDecorPanel({ table }: { table: Item }) {
  const project = useStore((s) => s.project)!;
  const addItems = useStore((s) => s.addItems);
  const removeItems = useStore((s) => s.removeItems);
  const applyTemplate = useStore((s) => s.applyTemplate);
  const addLib = useLibrary((s) => s.add);
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const def = findDef(table.type, project.customCatalog);
  const decor = attachedDecor(project, table);
  const sameType = project.items.filter((i) => i.type === table.type && i.id !== table.id);

  return (
    <div className="callout decor-panel">
      <strong>Decoración de la mesa</strong>
      <p className="hint">
        {decor.length ? `${decor.length} piezas sobre la mesa.` : 'Sin decoración.'} Coloca piezas desde Catálogo → Decoración de mesa: se apoyan solas en el tablero y se mueven y giran con la
        mesa.
      </p>
      <div className="row gap wrap">
        <button
          className="btn small"
          onClick={() => {
            const old = decor.filter((d) => d.type === 'cubierto').map((d) => d.id);
            if (old.length) removeItems(old);
            addItems(placeSettingsFor(table, def));
          }}
        >
          Cubierto en cada silla
        </button>
        {decor.length > 0 && (
          <button className="btn small danger" onClick={() => removeItems(decor.map((d) => d.id))}>
            Quitar decoración
          </button>
        )}
      </div>
      {decor.length > 0 && sameType.length > 0 && (
        <button
          className="btn small"
          onClick={() => {
            applyTemplate(makeTemplate(project, table), sameType.map((t) => t.id));
            setMsg(`Decoración copiada en ${sameType.length} mesas.`);
          }}
        >
          Copiar esta decoración a las {sameType.length} mesas iguales
        </button>
      )}
      <div className="row gap">
        <input placeholder="Nombre (p. ej. Boda clásica)" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        <button
          className="btn small"
          onClick={async () => {
            const tpl = makeTemplate(project, table);
            await addLib('mesa', name.trim() || `${def?.name ?? 'Mesa'} decorada`, { table: tpl });
            setName('');
            setMsg('Guardada en el catálogo del hotel: Catálogo → Mesas decoradas del hotel.');
          }}
        >
          Guardar en el hotel
        </button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

// ===================== Catálogo del hotel (compartido entre proyectos) =====================

function HotelLibrary() {
  const project = useStore((s) => s.project)!;
  const selection = useStore((s) => s.selection);
  const st = useStore();
  const { entries, loaded, load, remove } = useLibrary();
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!loaded) load();
  }, [loaded, load]);
  const tables = entries.filter((e) => e.kind === 'mesa' && e.table);
  const inProject = new Set(project.customCatalog.map((c) => c.type));
  const furniture = entries.filter((e) => e.kind === 'mueble' && e.def && !inProject.has(e.def.type));
  const selectedTables = project.items.filter((i) => selection.includes(i.id) && isTableDef(findDef(i.type, project.customCatalog)));

  return (
    <Section title="🏨 Catálogo del hotel" badge={entries.length ? String(entries.length) : undefined}>
      <p className="hint">Mesas decoradas, muebles escaneados y salas guardadas una vez y disponibles en todos los eventos.</p>
      <h4 className="sub-title">Mesas decoradas</h4>
      {tables.length === 0 ? (
        <p className="hint">Decora una mesa (selecciónala y usa «Decoración de la mesa») y guárdala en el hotel.</p>
      ) : (
        <ul className="lib-list">
          {tables.map((e) => (
            <li key={e.id}>
              <button className="lib-name" onClick={() => st.startPlacingTemplate(e.table!)} title="Colocar esta mesa decorada">
                <strong>{e.name}</strong>
                <span>
                  {e.table!.base.chairs ?? 0} sillas · {e.table!.decor.length} piezas
                </span>
              </button>
              {selectedTables.length > 0 && (
                <button
                  className="btn small"
                  onClick={() => {
                    st.applyTemplate(e.table!, selectedTables.map((t) => t.id));
                    setMsg(`Aplicada a ${selectedTables.length} mesa(s).`);
                  }}
                >
                  Aplicar a {selectedTables.length}
                </button>
              )}
              <ConfirmButton title="Eliminar del catálogo del hotel" onConfirm={() => remove(e.id)}>
                ✕
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      {furniture.length > 0 && (
        <>
          <h4 className="sub-title">Muebles del hotel no usados en este evento</h4>
          <ul className="lib-list">
            {furniture.map((e) => (
              <li key={e.id}>
                <button
                  className="lib-name"
                  onClick={() => {
                    st.ensureDefs([e.def!]);
                    st.startPlacing(e.def!.type);
                  }}
                >
                  <strong>◈ {e.name}</strong>
                  <span>
                    {m(e.def!.w)}×{m(e.def!.d)}×{m(e.def!.h)} m
                  </span>
                </button>
                <ConfirmButton title="Eliminar del catálogo del hotel" onConfirm={() => remove(e.id)}>
                  ✕
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </>
      )}
      {msg && <p className="hint">{msg}</p>}
    </Section>
  );
}
