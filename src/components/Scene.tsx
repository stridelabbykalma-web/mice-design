import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera, PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { create } from 'zustand';
import { useStore } from '../store';
import type { CatalogDef, Item, Project, Space } from '../types';
import { findDef, footprint, itemDims } from '../catalog';
import { FurnitureMesh, useGltf } from './Furniture';
import { assetUrl } from '../lib/db';
import { DEG, snapToWall, snapValue, corners } from '../lib/geometry';
import { analyze, problemItemIds } from '../lib/safety';

// ---------- API expuesta fuera del Canvas (capturas, exportación) ----------
export const sceneApi: {
  gl?: THREE.WebGLRenderer;
  scene?: THREE.Scene;
  exportRoot?: THREE.Object3D;
  modelObject?: THREE.Object3D | null;
} = {};

// Estado efímero de interacción (no se guarda en el proyecto).
const useInteraction = create<{ dragging: boolean; ghost: THREE.Vector3 | null; walkLocked: boolean }>(() => ({
  dragging: false,
  ghost: null,
  walkLocked: false,
}));

let hitItemThisPress = false;
let dragState: { ids: string[]; start: THREE.Vector3; orig: Map<string, { x: number; z: number }>; moved: boolean } | null = null;

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

function floorPoint(e: { clientX: number; clientY: number }, el: HTMLElement, camera: THREE.Camera, raycaster: THREE.Raycaster) {
  const r = el.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const p = new THREE.Vector3();
  return raycaster.ray.intersectPlane(floorPlane, p) ? p : null;
}

function Polyline({ points, color, overlay = false }: { points: THREE.Vector3[]; color: string; overlay?: boolean }) {
  const obj = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints(points);
    const m = new THREE.LineBasicMaterial({ color, depthTest: !overlay, transparent: overlay });
    const l = new THREE.Line(g, m);
    if (overlay) l.renderOrder = 10;
    return l;
  }, [points, color, overlay]);
  useEffect(() => () => {
    obj.geometry.dispose();
    (obj.material as THREE.Material).dispose();
  }, [obj]);
  return <primitive object={obj} />;
}

// ---------- Iluminación ----------
function Lighting({ project }: { project: Project }) {
  const { space, lighting, items, customCatalog } = project;
  const presets = {
    dia: { amb: 0.55, hemi: 0.7, sun: 2.4, sunColor: '#fff6e5', bg: space.outdoor ? '#a9cbe8' : '#dfe6ee', ceiling: 0.0 },
    tarde: { amb: 0.4, hemi: 0.45, sun: 1.6, sunColor: '#ffd2a1', bg: '#e9d8c8', ceiling: 0.6 },
    noche: { amb: 0.14, hemi: 0.15, sun: 0.25, sunColor: '#9fb3ff', bg: '#141a26', ceiling: 1.6 },
    gala: { amb: 0.06, hemi: 0.06, sun: 0.1, sunColor: '#7d6bff', bg: '#0b0a14', ceiling: 0.5 },
  }[lighting];
  const maxDim = Math.max(space.width, space.depth);
  const lightsOn = lighting === 'noche' || lighting === 'gala';
  const emitters = items
    .filter((i) => i.type === 'uplight' || i.type === 'foco' || findDef(i.type, customCatalog)?.category === 'iluminacion')
    .slice(0, 12);

  // Rejilla de luminarias de techo (interiores)
  const ceilingLights = useMemo(() => {
    if (space.outdoor) return [];
    const nx = Math.max(1, Math.min(3, Math.round(space.width / 8)));
    const nz = Math.max(1, Math.min(3, Math.round(space.depth / 8)));
    const pts: [number, number][] = [];
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) pts.push([((i + 0.5) / nx - 0.5) * space.width, ((j + 0.5) / nz - 0.5) * space.depth]);
    return pts;
  }, [space.width, space.depth, space.outdoor]);

  return (
    <>
      <color attach="background" args={[presets.bg]} />
      <ambientLight intensity={presets.amb} />
      <hemisphereLight args={['#ffffff', '#8a7f70', presets.hemi]} />
      <directionalLight
        position={[maxDim * 0.4, maxDim * 0.9, maxDim * 0.6]}
        intensity={presets.sun}
        color={presets.sunColor}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0005}
        shadow-camera-left={-maxDim}
        shadow-camera-right={maxDim}
        shadow-camera-top={maxDim}
        shadow-camera-bottom={-maxDim}
        shadow-camera-far={maxDim * 4}
      />
      {presets.ceiling > 0 &&
        ceilingLights.map(([x, z], i) => (
          <pointLight key={i} position={[x, space.height - 0.2, z]} intensity={presets.ceiling * 6} distance={14} decay={1.4} color="#ffe2b8" />
        ))}
      {emitters.map((it) => (
        <pointLight
          key={it.id}
          position={[it.x, it.type === 'foco' ? 2.3 : 0.5, it.z]}
          intensity={lightsOn ? 9 : 2}
          distance={it.type === 'foco' ? 12 : 6}
          decay={1.5}
          color={it.color ?? findDef(it.type, customCatalog)?.color}
        />
      ))}
    </>
  );
}

// ---------- Espacio: suelo, paredes, plano/satélite y modelo de fotogrametría ----------
function UnderlayMesh({ space }: { space: Space }) {
  const u = space.underlay;
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    if (!u) return setTex(null);
    assetUrl(u.assetId).then((url) => {
      if (!url) return;
      new THREE.TextureLoader().load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 8;
        if (alive) setTex(t);
      });
    });
    return () => {
      alive = false;
    };
  }, [u?.assetId]);
  if (!u || !tex) return null;
  return (
    <mesh position={[u.offsetX, 0.004, u.offsetZ]} rotation={[-Math.PI / 2, 0, u.rotation * DEG]} receiveShadow>
      <planeGeometry args={[u.widthM, u.widthM * u.aspect]} />
      <meshStandardMaterial map={tex} transparent opacity={u.opacity} roughness={1} depthWrite={false} />
    </mesh>
  );
}

function ScannedSpace({ space }: { space: Space }) {
  const m = space.model;
  const obj = useGltf(m?.assetId);
  useEffect(() => {
    sceneApi.modelObject = obj;
  }, [obj]);
  if (!m || !obj) return null;
  return (
    <group position={[m.offsetX, m.offsetY, m.offsetZ]} rotation={[0, m.rotation * DEG, 0]} scale={m.scale}>
      <primitive object={obj} />
    </group>
  );
}

function Walls({ space, view }: { space: Space; view: string }) {
  const refs = useRef<(THREE.Mesh | null)[]>([]);
  const t = 0.15;
  const { width: W, depth: D, height: H } = space;
  const walls = [
    { pos: [0, H / 2, -D / 2 - t / 2], size: [W + 2 * t, H, t], n: [0, 0, 1] },
    { pos: [0, H / 2, D / 2 + t / 2], size: [W + 2 * t, H, t], n: [0, 0, -1] },
    { pos: [-W / 2 - t / 2, H / 2, 0], size: [t, H, D], n: [1, 0, 0] },
    { pos: [W / 2 + t / 2, H / 2, 0], size: [t, H, D], n: [-1, 0, 0] },
  ];
  // Las paredes que quedan entre la cámara y la sala se vuelven translúcidas.
  useFrame(({ camera }) => {
    walls.forEach((w, i) => {
      const mesh = refs.current[i];
      if (!mesh) return;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      const toCam = new THREE.Vector3().subVectors(camera.position, new THREE.Vector3(...(w.pos as [number, number, number])));
      const facing = toCam.dot(new THREE.Vector3(...(w.n as [number, number, number]))) < 0;
      const target = view === 'paseo' ? 1 : facing ? 0.08 : 1;
      mat.opacity += (target - mat.opacity) * 0.2;
      mat.transparent = mat.opacity < 0.99;
      mat.depthWrite = mat.opacity > 0.5;
    });
  });
  if (view === 'planta') return null;
  return (
    <>
      {walls.map((w, i) => (
        <mesh key={i} ref={(m) => (refs.current[i] = m)} position={w.pos as [number, number, number]} receiveShadow castShadow>
          <boxGeometry args={w.size as [number, number, number]} />
          <meshStandardMaterial color={space.wallColor} roughness={0.95} transparent />
        </mesh>
      ))}
      {view === 'paseo' && (
        <mesh position={[0, H + 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial color="#f4f1ec" side={THREE.DoubleSide} />
        </mesh>
      )}
    </>
  );
}

function Floor({ space, view }: { space: Space; view: string }) {
  const { width: W, depth: D } = space;
  const grid = useMemo(() => {
    const g = new THREE.GridHelper(Math.ceil(Math.max(W, D)) + 2, Math.ceil(Math.max(W, D)) + 2, '#9aa3ad', '#c3c9cf');
    (g.material as THREE.Material).transparent = true;
    (g.material as THREE.Material).opacity = 0.35;
    return g;
  }, [W, D]);
  const border = useMemo(() => {
    const pts = [
      [-W / 2, -D / 2],
      [W / 2, -D / 2],
      [W / 2, D / 2],
      [-W / 2, D / 2],
      [-W / 2, -D / 2],
    ].map(([x, z]) => new THREE.Vector3(x, 0.02, z));
    return pts;
  }, [W, D]);
  const hideFloor = !!space.model && !space.showWalls;
  return (
    <>
      {space.outdoor && (
        <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color="#6f8f57" roughness={1} />
        </mesh>
      )}
      {!hideFloor && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[W, D]} />
          <meshStandardMaterial color={space.floorColor} roughness={0.85} transparent={space.outdoor} opacity={space.outdoor ? 0.25 : 1} />
        </mesh>
      )}
      {(view === 'planta' || space.outdoor) && <primitive object={grid} position={[0, 0.006, 0]} />}
      <Polyline points={border} color={space.outdoor ? '#ffffff' : '#5b6672'} />
      {view === 'planta' && (
        <>
          <Html position={[0, 0, -D / 2 - 0.6]} center className="dim-label">
            {W.toFixed(2).replace('.', ',')} m
          </Html>
          <Html position={[-W / 2 - 0.6, 0, 0]} center className="dim-label">
            {D.toFixed(2).replace('.', ',')} m
          </Html>
          <Html position={[0, 0, -D / 2 - 1.4]} center className="dim-label north">
            ▲ Frente / escenario
          </Html>
        </>
      )}
    </>
  );
}

// ---------- Elementos ----------
function Outline({ item, def, color }: { item: Item; def?: CatalogDef; color: string }) {
  const f = footprint(item, def);
  const pts = useMemo(() => {
    const c = corners({ x: 0, z: 0, w: f.w + 0.06, d: f.d + 0.06, rot: 0 });
    return [...c, c[0]].map((p) => new THREE.Vector3(p.x, 0, p.z));
  }, [f.w, f.d]);
  return (
    <group position={[0, 0.025, 0]}>
      <Polyline points={pts} color={color} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[f.w + 0.06, f.d + 0.06]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} depthWrite={false} />
      </mesh>
    </group>
  );
}

const ItemNode = memo(function ItemNode({
  item,
  def,
  custom,
  selected,
  problem,
  wallHeight,
  lightsOn,
  showLabel,
  interactive,
  elev,
}: {
  elev: number;
  item: Item;
  def?: CatalogDef;
  custom: CatalogDef[];
  selected: boolean;
  problem: boolean;
  wallHeight: number;
  lightsOn: boolean;
  showLabel: boolean;
  interactive: boolean;
}) {
  const onDown = (e: ThreeEvent<PointerEvent>) => {
    if (!interactive || e.button !== 0) return;
    const st = useStore.getState();
    if (st.tool !== 'select') return;
    e.stopPropagation();
    hitItemThisPress = true;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = st.selection;
    if (additive) {
      st.select([item.id], true);
      return;
    }
    if (!ids.includes(item.id)) {
      ids = [item.id];
      st.select(ids);
    }
    const p = new THREE.Vector3();
    if (!e.ray.intersectPlane(floorPlane, p)) return;
    const proj = st.project!;
    dragState = {
      ids,
      start: p,
      orig: new Map(proj.items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, z: i.z }])),
      moved: false,
    };
    useInteraction.setState({ dragging: true });
  };
  return (
    <group position={[item.x, elev, item.z]} rotation={[0, item.rot * DEG, 0]} onPointerDown={onDown} userData={{ itemId: item.id }}>
      <FurnitureMesh item={item} def={def} custom={custom} wallHeight={wallHeight} lightsOn={lightsOn} />
      {(selected || problem) && <Outline item={item} def={def} color={problem ? '#e5484d' : '#2f80ed'} />}
      {showLabel && item.label && (
        <Html position={[0, 1, 0]} center className="item-label" zIndexRange={[10, 0]}>
          {item.label}
        </Html>
      )}
    </group>
  );
});

function Items({ project, view }: { project: Project; view: string }) {
  const selection = useStore((s) => s.selection);
  const clientMode = useStore((s) => s.clientMode);
  const sel = useMemo(() => new Set(selection), [selection]);
  const problems = useMemo(() => problemItemIds(analyze(project).checks), [project]);
  const lightsOn = project.lighting === 'noche' || project.lighting === 'gala';
  // Lo que se coloca encima de un escenario se eleva a su altura.
  const stages = project.items.filter((i) => i.type === 'escenario');
  const elevation = (it: Item) => {
    if (it.type === 'escenario' || it.type === 'pantalla' || !stages.length) return 0;
    for (const st of stages) {
      const { w, d, h } = itemDims(st, findDef(st.type, project.customCatalog));
      const t = -st.rot * DEG;
      const dx = it.x - st.x;
      const dz = it.z - st.z;
      const lx = dx * Math.cos(t) + dz * Math.sin(t);
      const lz = -dx * Math.sin(t) + dz * Math.cos(t);
      if (Math.abs(lx) <= w / 2 && Math.abs(lz) <= d / 2) return h;
    }
    return 0;
  };
  return (
    <group>
      {project.items.map((it) => {
        const def = findDef(it.type, project.customCatalog);
        return (
          <ItemNode
            elev={elevation(it)}
            key={it.id}
            item={it}
            def={def}
            custom={project.customCatalog}
            selected={sel.has(it.id)}
            problem={!clientMode && problems.has(it.id)}
            wallHeight={project.space.height}
            lightsOn={lightsOn}
            showLabel={view === 'planta' && !!def?.chairs}
            interactive={!clientMode && view !== 'paseo'}
          />
        );
      })}
    </group>
  );
}

function Ghost({ project }: { project: Project }) {
  const placingType = useStore((s) => s.placingType);
  const tool = useStore((s) => s.tool);
  const ghost = useInteraction((s) => s.ghost);
  if (tool !== 'place' || !placingType || !ghost) return null;
  const def = findDef(placingType, project.customCatalog);
  if (!def) return null;
  const pos = placementFor(def, ghost, project.space, useStore.getState().snap);
  const it: Item = { id: 'ghost', type: def.type, x: pos.x, z: pos.z, rot: pos.rot, chairs: def.chairs };
  return (
    <group position={[pos.x, 0, pos.z]} rotation={[0, pos.rot * DEG, 0]}>
      <FurnitureMesh item={it} def={def} custom={project.customCatalog} wallHeight={project.space.height} lightsOn={false} />
      <Outline item={it} def={def} color="#27ae60" />
    </group>
  );
}

export function placementFor(def: CatalogDef, p: THREE.Vector3, space: Space, snap: boolean) {
  if (def.wallMount && !space.outdoor) return snapToWall(p.x, p.z, space.width, space.depth, def.d);
  const step = 0.1;
  return { x: snap ? snapValue(p.x, step) : p.x, z: snap ? snapValue(p.z, step) : p.z, rot: 0 };
}

function MeasureViz() {
  const pts = useStore((s) => s.measure);
  const linePts = useMemo(() => pts.map((p) => new THREE.Vector3(p.x, p.y + 0.03, p.z)), [pts]);
  if (!pts.length) return null;
  const dist = pts.length === 2 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y, pts[1].z - pts[0].z) : 0;
  return (
    <group>
      {pts.map((p, i) => (
        <mesh key={i} position={[p.x, p.y + 0.03, p.z]}>
          <sphereGeometry args={[0.07, 12, 10]} />
          <meshBasicMaterial color="#f2994a" depthTest={false} />
        </mesh>
      ))}
      {pts.length === 2 && (
        <>
          <Polyline points={linePts} color="#f2994a" overlay />
          <Html position={[(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2 + 0.3, (pts[0].z + pts[1].z) / 2]} center className="measure-label">
            {dist.toFixed(2).replace('.', ',')} m
          </Html>
        </>
      )}
    </group>
  );
}

// ---------- Interacción (arrastrar, colocar, medir, deseleccionar) ----------
function Interaction({ wrap }: { wrap: React.RefObject<HTMLDivElement> }) {
  const { camera, raycaster, scene } = useThree();
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    let down: { x: number; y: number } | null = null;

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      down = { x: e.clientX, y: e.clientY };
    };
    const onMove = (e: PointerEvent) => {
      const st = useStore.getState();
      if (!st.project) return;
      const p = floorPoint(e, el, camera, raycaster);
      if (dragState && p) {
        const dx = p.x - dragState.start.x;
        const dz = p.z - dragState.start.z;
        if (!dragState.moved && Math.hypot(dx, dz) < 0.02) return;
        if (!dragState.moved) st.checkpoint();
        dragState.moved = true;
        const proj = st.project;
        const ids = dragState.ids;
        const orig = dragState.orig;
        st.updateItems(
          ids,
          (it) => {
            const o = orig.get(it.id)!;
            const def = findDef(it.type, proj.customCatalog);
            let x = o.x + dx;
            let z = o.z + dz;
            if (st.snap) {
              x = snapValue(x, 0.05);
              z = snapValue(z, 0.05);
            }
            if (def?.wallMount && ids.length === 1 && !proj.space.outdoor) {
              return snapToWall(x, z, proj.space.width, proj.space.depth, itemDims(it, def).d);
            }
            return { x, z };
          },
          false,
        );
        return;
      }
      if (st.tool === 'place') useInteraction.setState({ ghost: p });
    };
    const onUp = (e: PointerEvent) => {
      const st = useStore.getState();
      const wasClick = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5;
      down = null;
      if (dragState) {
        dragState = null;
        useInteraction.setState({ dragging: false });
        hitItemThisPress = false;
        return;
      }
      if (!wasClick || hitItemThisPress || !st.project) {
        hitItemThisPress = false;
        return;
      }
      if (st.clientMode || st.view === 'paseo') return;
      if (st.tool === 'place' && st.placingType) {
        const p = floorPoint(e, el, camera, raycaster);
        const def = findDef(st.placingType, st.project.customCatalog);
        if (!p || !def) return;
        const pos = placementFor(def, p, st.project.space, st.snap);
        const id = st.addItem({ type: def.type, ...pos, chairs: def.chairs, centerpiece: def.chairs ? true : undefined });
        if (!e.shiftKey) {
          st.setTool('select');
          st.select([id]);
          useInteraction.setState({ ghost: null });
        }
      } else if (st.tool === 'measure') {
        // Mide sobre el modelo escaneado si existe; si no, sobre el suelo.
        const r = el.getBoundingClientRect();
        raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hits = raycaster.intersectObjects(scene.children, true).filter((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
        const p = hits[0]?.point ?? floorPoint(e, el, camera, raycaster);
        if (p) st.addMeasurePoint({ x: p.x, y: p.y, z: p.z });
      } else {
        st.select([]);
      }
    };
    const onLeave = () => useInteraction.setState({ ghost: null });
    el.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    el.addEventListener('pointerleave', onLeave);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointerleave', onLeave);
    };
  }, [camera, raycaster, scene, wrap]);
  return null;
}

// ---------- Cámaras ----------
function WalkControls({ space }: { space: Space }) {
  const { camera } = useThree();
  const keys = useRef<Record<string, boolean>>({});
  useEffect(() => {
    camera.position.set(0, 1.65, space.depth / 2 - 1.5);
    camera.lookAt(0, 1.5, 0);
    const d = (e: KeyboardEvent) => (keys.current[e.code] = true);
    const u = (e: KeyboardEvent) => (keys.current[e.code] = false);
    window.addEventListener('keydown', d);
    window.addEventListener('keyup', u);
    return () => {
      window.removeEventListener('keydown', d);
      window.removeEventListener('keyup', u);
    };
  }, [camera, space.depth]);
  useFrame((_, dt) => {
    const k = keys.current;
    const speed = (k.ShiftLeft ? 4 : 2) * dt;
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = new THREE.Vector3();
    if (k.KeyW || k.ArrowUp) mv.add(fwd);
    if (k.KeyS || k.ArrowDown) mv.sub(fwd);
    if (k.KeyD || k.ArrowRight) mv.add(right);
    if (k.KeyA || k.ArrowLeft) mv.sub(right);
    if (mv.lengthSq()) camera.position.addScaledVector(mv.normalize(), speed);
    const lim = space.outdoor ? 60 : 0;
    camera.position.x = Math.max(-space.width / 2 + 0.3 - lim, Math.min(space.width / 2 - 0.3 + lim, camera.position.x));
    camera.position.z = Math.max(-space.depth / 2 + 0.3 - lim, Math.min(space.depth / 2 - 0.3 + lim, camera.position.z));
    camera.position.y = 1.65;
  });
  return (
    <PointerLockControls
      selector="#walk-start"
      onLock={() => useInteraction.setState({ walkLocked: true })}
      onUnlock={() => useInteraction.setState({ walkLocked: false })}
    />
  );
}

function PlanCamera({ space, wrap }: { space: Space; wrap: React.RefObject<HTMLDivElement> }) {
  const [zoom, setZoom] = useState(20);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      setZoom(Math.min(r.width / (space.width + 4), r.height / (space.depth + 4)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [space.width, space.depth, wrap]);
  return <OrthographicCamera makeDefault position={[0, 60, 0.001]} zoom={zoom} near={0.1} far={200} />;
}

function Cameras({ space, view, wrap }: { space: Space; view: string; wrap: React.RefObject<HTMLDivElement> }) {
  const dragging = useInteraction((s) => s.dragging);
  const maxDim = Math.max(space.width, space.depth);
  if (view === 'paseo')
    return (
      <>
        <PerspectiveCamera makeDefault fov={70} near={0.05} far={500} />
        <WalkControls space={space} />
      </>
    );
  if (view === 'planta')
    return (
      <>
        <PlanCamera space={space} wrap={wrap} />
        <OrbitControls makeDefault enableRotate={false} enabled={!dragging} screenSpacePanning target={[0, 0, 0]} />
      </>
    );
  return (
    <>
      <PerspectiveCamera makeDefault fov={45} near={0.05} far={1000} position={[maxDim * 0.55, maxDim * 0.75, maxDim * 0.95]} />
      <OrbitControls makeDefault enabled={!dragging} target={[0, 0.5, 0]} maxPolarAngle={Math.PI / 2 - 0.03} minDistance={1.5} maxDistance={maxDim * 4} />
    </>
  );
}

function ApiBridge({ root }: { root: React.RefObject<THREE.Group> }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    sceneApi.gl = gl;
    sceneApi.scene = scene;
    sceneApi.exportRoot = root.current ?? undefined;
  }, [gl, scene, root]);
  return null;
}

export default function Scene() {
  const project = useStore((s) => s.project)!;
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const walkLocked = useInteraction((s) => s.walkLocked);
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<THREE.Group>(null);
  const { space } = project;
  return (
    <div ref={wrap} className={`scene-wrap tool-${tool}`}>
      <Canvas shadows dpr={[1, 2]} gl={{ preserveDrawingBuffer: true, antialias: true }} key={view}>
        <Cameras space={space} view={view} wrap={wrap} />
        <Lighting project={project} />
        <group ref={root} name="mice-design-escena">
          <Floor space={space} view={view} />
          <UnderlayMesh space={space} />
          <ScannedSpace space={space} />
          {space.showWalls && !space.outdoor && <Walls space={space} view={view} />}
          <Items project={project} view={view} />
        </group>
        <Ghost project={project} />
        <MeasureViz />
        <Interaction wrap={wrap} />
        <ApiBridge root={root} />
      </Canvas>
      {view === 'paseo' && !walkLocked && (
        <div className="walk-overlay">
          <button id="walk-start" className="btn primary">
            Haz clic para recorrer el espacio
          </button>
          <p>W A S D o flechas para moverte · ratón para mirar · Mayús para ir más rápido · Esc para salir</p>
        </div>
      )}
    </div>
  );
}
