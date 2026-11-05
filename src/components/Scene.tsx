import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { Html, OrbitControls, OrthographicCamera, PerspectiveCamera, PointerLockControls } from '@react-three/drei';
import * as THREE from 'three';
import { create } from 'zustand';
import { useStore } from '../store';
import type { CatalogDef, Item, Project, Space, WallSide } from '../types';
import { findDef, footprint, itemDims } from '../catalog';
import { sceneApi } from './sceneApi';
import { ChairInstances, InstancedChairsContext } from './ChairInstances';
import { FurnitureMesh, useAssetTexture, useGltf } from './Furniture';
import { assetUrl } from '../lib/db';
import { DEG, snapValue, corners } from '../lib/geometry';
import { inwardNormal, roomOutline, snapToRoomWall } from '../lib/outline';
import { analyze, problemItemIds } from '../lib/safety';
import { decimal, t, tableLabel } from '../lib/i18n';
import { attachedDecor, isDecorDef, isTableDef, onTableTop, tableAt } from '../lib/tables';

// ---------- API expuesta fuera del Canvas (capturas, exportación) ----------
export { sceneApi };

// Estado efímero de interacción (no se guarda en el proyecto).
const useInteraction = create<{ dragging: boolean; ghost: THREE.Vector3 | null; walkLocked: boolean; splat: 'loading' | 'ok' | 'error' | null }>(() => ({
  dragging: false,
  ghost: null,
  walkLocked: false,
  splat: null,
}));

let hitItemThisPress = false;
let dragState: { ids: string[]; start: THREE.Vector3; orig: Map<string, { x: number; z: number }>; moved: boolean } | null = null;

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Móviles y tabletas: menos resolución de dibujo para ganar fluidez y batería. */
const IS_MOBILE = typeof navigator !== 'undefined' && (/iPhone|iPad|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Mac/.test(navigator.userAgent)));

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

/**
 * Uniformes compartidos por todos los materiales del escaneo. Permiten, sin modificar el
 * modelo, quitar el mobiliario que se capturó (vaciar), ocultar el techo y la pared que
 * queda delante de la cámara para ver el interior.
 */
const scanUniforms = {
  uRoom: { value: new THREE.Vector3(10, 10, 3) }, // ancho, fondo, alto
  uEmpty: { value: 0 },
  uBand: { value: 0.4 },
  uFloorKeep: { value: 0.02 },
  uCeilKeep: { value: 0.5 },
  uCeilCut: { value: 0 },
  uSides: { value: new THREE.Vector4(0, 0, 0, 0) }, // -X, +X, -Z, +Z
};

function patchScanMaterial(mat: THREE.Material) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, scanUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vScanWorld;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvScanWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vScanWorld;
uniform vec3 uRoom; uniform float uEmpty; uniform float uBand; uniform float uFloorKeep;
uniform float uCeilKeep; uniform float uCeilCut; uniform vec4 uSides;`,
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
{
  vec3 p = vScanWorld;
  float hw = uRoom.x * 0.5; float hd = uRoom.y * 0.5;
  if (uCeilCut > 0.5 && p.y > uRoom.z - 0.12) discard;
  if (uSides.x > 0.5 && p.x < -hw + 0.3) discard;
  if (uSides.y > 0.5 && p.x >  hw - 0.3) discard;
  if (uSides.z > 0.5 && p.z < -hd + 0.3) discard;
  if (uSides.w > 0.5 && p.z >  hd - 0.3) discard;
  if (uEmpty > 0.5 && abs(p.x) < hw - uBand && abs(p.z) < hd - uBand && p.y > uFloorKeep && p.y < uRoom.z - uCeilKeep) discard;
}`,
      );
  };
  mat.customProgramCacheKey = () => 'mice-scan';
  mat.needsUpdate = true;
}

function ScannedSpace({ space, view }: { space: Space; view: string }) {
  const m = space.model;
  const src = useGltf(m?.assetId);
  const realColors = m?.realColors !== false;
  const brightness = m?.brightness ?? 1;

  // Copia del modelo con materiales preparados: colores reales (sin luz simulada) o PBR.
  const obj = useMemo(() => {
    if (!src) return null;
    const clone = src.clone(true);
    clone.traverse((o) => {
      const pts = o as THREE.Points;
      if (pts.isPoints) {
        const pm = (pts.material as THREE.PointsMaterial).clone();
        pm.color.multiplyScalar(brightness);
        patchScanMaterial(pm);
        pts.material = pm;
        return;
      }
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const conv = (orig: THREE.Material) => {
        const om = orig as THREE.MeshStandardMaterial;
        let mat: THREE.Material;
        if (realColors) {
          mat = new THREE.MeshBasicMaterial({
            map: om.map ?? null,
            color: (om.color ?? new THREE.Color('#ffffff')).clone().multiplyScalar(brightness),
            vertexColors: om.vertexColors,
            transparent: om.transparent,
            opacity: om.opacity,
            alphaTest: om.alphaTest,
            side: THREE.DoubleSide,
          });
        } else {
          const c = om.clone() as THREE.MeshStandardMaterial;
          c.side = THREE.DoubleSide;
          if (c.color) c.color.multiplyScalar(brightness);
          mat = c;
        }
        patchScanMaterial(mat);
        return mat;
      };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
      mesh.castShadow = !realColors;
      mesh.receiveShadow = !realColors;
    });
    return clone;
  }, [src, realColors, brightness]);

  useEffect(() => {
    sceneApi.modelObject = obj;
  }, [obj]);

  useFrame(({ camera }) => {
    const u = scanUniforms;
    u.uRoom.value.set(space.width, space.depth, space.height);
    u.uEmpty.value = m?.emptyInterior ? 1 : 0;
    u.uBand.value = m?.keepBand ?? 0.4;
    u.uCeilKeep.value = m?.keepCeiling ?? 1;
    const inside = view === 'paseo';
    u.uCeilCut.value = inside ? 0 : 1;
    const c = camera.position;
    // En la vista 3D se recorta la pared que queda entre la cámara y la sala.
    const cut = view === '3d';
    u.uSides.value.set(
      cut && c.x < -space.width / 2 ? 1 : 0,
      cut && c.x > space.width / 2 ? 1 : 0,
      cut && c.z < -space.depth / 2 ? 1 : 0,
      cut && c.z > space.depth / 2 ? 1 : 0,
    );
  });

  if (!m || !obj) return null;
  return (
    <group position={[m.offsetX, m.offsetY, m.offsetZ]} rotation={[0, m.rotation * DEG, 0]} scale={m.scale}>
      <group rotation={[(m.tilt ?? 0) * DEG, 0, 0]}>
        <primitive object={obj} />
      </group>
    </group>
  );
}

function WallPhoto({ assetId, w, h, offset }: { assetId: string; w: number; h: number; offset: number }) {
  const tex = useAssetTexture(assetId);
  if (!tex) return null;
  return (
    <mesh position={[0, 0, offset]}>
      <planeGeometry args={[w, h]} />
      {/* Colores reales de la foto, sin el sombreado simulado */}
      <meshBasicMaterial map={tex} transparent />
    </mesh>
  );
}

/** Lado de una sala rectangular que corresponde a cada tramo del contorno rectangular. */
const RECT_SIDES: WallSide[] = ['norte', 'este', 'sur', 'oeste'];

/** Foto real del tramo i de pared (por lado en salas rectangulares, por tramo en las demás). */
function edgePhoto(space: Space, i: number) {
  if (space.outline && space.outline.length >= 3) return space.edgePhotos?.['e' + i];
  return space.wallPhotos?.[RECT_SIDES[i]];
}

/**
 * Escena de Gaussian splatting: millones de «manchas» con color y transparencia que
 * reproducen la sala casi como una fotografía. La librería se carga solo cuando hace falta.
 */
function SplatSpace({ space }: { space: Space }) {
  const sp = space.splat;
  const holder = useRef<THREE.Group>(null);
  const [status, setStatus] = useState<'loading' | 'ok' | 'error' | null>(null);
  useEffect(() => {
    if (!sp) return;
    let alive = true;
    let viewer: (THREE.Object3D & { dispose?: () => Promise<void> | void; addSplatScene: (p: string, o: object) => Promise<void> }) | null = null;
    setStatus('loading');
    (async () => {
      try {
        const [GS, url] = await Promise.all([import('@mkkellogg/gaussian-splats-3d'), assetUrl(sp.assetId)]);
        if (!alive || !url || !holder.current) return;
        viewer = new GS.DropInViewer({ gpuAcceleratedSort: false, sharedMemoryForWorkers: false, dynamicScene: false, sceneRevealMode: 2 /* instantánea */ }) as unknown as typeof viewer;
        holder.current.add(viewer!);
        const format = { ply: GS.SceneFormat.Ply, splat: GS.SceneFormat.Splat, ksplat: GS.SceneFormat.KSplat }[sp.format];
        await viewer!.addSplatScene(url, { format, showLoadingUI: false, splatAlphaRemovalThreshold: 5, progressiveLoad: false });
        if (alive) setStatus('ok');
      } catch (e) {
        console.warn('Gaussian splatting', e);
        if (alive) setStatus('error');
      }
    })();
    return () => {
      alive = false;
      if (viewer) {
        holder.current?.remove(viewer);
        try {
          viewer.dispose?.();
        } catch {
          /* noop */
        }
      }
    };
  }, [sp?.assetId, sp?.format]);
  useEffect(() => {
    sceneApi.splatStatus = status;
    useInteraction.setState({ splat: sp ? status : null });
  }, [status, sp]);
  if (!sp) return null;
  return (
    <group position={[sp.offsetX, sp.offsetY, sp.offsetZ]} rotation={[0, sp.rotation * DEG, 0]} scale={sp.scale}>
      <group rotation={[sp.tilt * DEG, 0, 0]}>
        <group ref={holder} />
      </group>
    </group>
  );
}

function Walls({ space, view }: { space: Space; view: string }) {
  const refs = useRef<(THREE.Group | null)[]>([]);
  const t = 0.15;
  const H = space.height;
  const pts = roomOutline(space);
  // Un tramo de pared por cada lado del contorno: centro, giro y normal hacia el interior.
  const walls = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const n = inwardNormal(pts, i);
    const mx = (a.x + b.x) / 2;
    const mz = (a.z + b.z) / 2;
    return {
      len,
      n,
      center: new THREE.Vector3(mx - (n.x * t) / 2, H / 2, mz - (n.z * t) / 2),
      inner: new THREE.Vector3(mx + n.x * 0.003, H / 2, mz + n.z * 0.003),
      rot: Math.atan2(-(b.z - a.z), b.x - a.x),
      faceRot: Math.atan2(n.x, n.z),
    };
  });
  // Las paredes que quedan entre la cámara y la sala se vuelven translúcidas.
  useFrame(({ camera, invalidate }) => {
    let animating = false;
    walls.forEach((w, i) => {
      const g = refs.current[i];
      if (!g) return;
      const toCamX = camera.position.x - w.center.x;
      const toCamZ = camera.position.z - w.center.z;
      const facing = toCamX * w.n.x + toCamZ * w.n.z < 0;
      const target = view === 'paseo' ? 1 : facing ? 0.08 : 1;
      g.traverse((o) => {
        const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (!mat) return;
        if (Math.abs(target - mat.opacity) > 0.005) {
          mat.opacity += (target - mat.opacity) * 0.2;
          animating = true;
        } else mat.opacity = target;
        mat.transparent = mat.opacity < 0.99;
        mat.depthWrite = mat.opacity > 0.5;
      });
    });
    // Con el dibujo bajo demanda, se piden fotogramas solo mientras dura la transición
    if (animating) invalidate();
  });
  if (view === 'planta') return null;
  return (
    <>
      {walls.map((w, i) => {
        const photo = edgePhoto(space, i);
        return (
          <group key={i} ref={(g) => (refs.current[i] = g)}>
            <mesh position={w.center} rotation={[0, w.rot, 0]} receiveShadow castShadow>
              <boxGeometry args={[w.len + t, H, t]} />
              <meshStandardMaterial color={space.wallColor} roughness={0.95} transparent />
            </mesh>
            {photo && (
              <group position={w.inner} rotation={[0, w.faceRot, 0]}>
                <WallPhoto assetId={photo.assetId} w={w.len} h={H} offset={0} />
              </group>
            )}
          </group>
        );
      })}
      {view === 'paseo' && <Ceiling space={space} />}
    </>
  );
}

/** Geometría del suelo o del techo con la forma de la sala. */
function roomShapeGeometry(space: Space, kind: 'suelo' | 'techo') {
  const pts = roomOutline(space);
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, kind === 'suelo' ? -p.z : p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(kind === 'suelo' ? -Math.PI / 2 : Math.PI / 2);
  if (kind === 'techo') {
    // La foto del techo cubre el rectángulo de la sala, con el frente arriba en la imagen.
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + space.width / 2) / space.width, 1 - (pos.getZ(i) + space.depth / 2) / space.depth);
    uv.needsUpdate = true;
  }
  return g;
}

/** Techo (solo en el paseo): liso o con la foto real. */
function Ceiling({ space }: { space: Space }) {
  const tex = useAssetTexture(space.ceilingPhoto?.assetId);
  const geo = useMemo(() => roomShapeGeometry(space, 'techo'), [space.outline, space.width, space.depth]);
  return (
    <mesh position={[0, space.height + 0.01, 0]} geometry={geo}>
      {tex ? <meshBasicMaterial map={tex} side={THREE.DoubleSide} /> : <meshStandardMaterial color="#f4f1ec" side={THREE.DoubleSide} />}
    </mesh>
  );
}

function FloorMaterial({ space }: { space: Space }) {
  const tex = useAssetTexture(space.floorPhoto?.assetId);
  const tiled = useMemo(() => {
    if (!tex) return null;
    const t = tex.clone();
    const tile = space.floorPhoto?.tileM ?? 1;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / tile, 1 / tile);
    t.needsUpdate = true;
    return t;
  }, [tex, space.floorPhoto?.tileM]);
  return (
    <meshStandardMaterial
      color={tiled ? '#ffffff' : space.floorColor}
      map={tiled}
      roughness={0.85}
      transparent={space.outdoor}
      opacity={space.outdoor ? 0.25 : 1}
    />
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
  const outline = roomOutline(space);
  const border = useMemo(() => [...outline, outline[0]].map((p) => new THREE.Vector3(p.x, 0.02, p.z)), [outline]);
  const floorGeo = useMemo(() => roomShapeGeometry(space, 'suelo'), [space.outline, W, D]);
  const isPoly = !!space.outline && space.outline.length >= 3;
  const hideFloor = (!!space.model || !!space.splat) && !space.showWalls;
  const floorLang = useStore((s) => (s.clientMode ? s.project?.event.language : 'es'));
  return (
    <>
      {space.outdoor && (
        <mesh position={[0, -0.01, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[400, 400]} />
          <meshStandardMaterial color="#6f8f57" roughness={1} />
        </mesh>
      )}
      {!hideFloor && (
        <mesh geometry={floorGeo} receiveShadow>
          <FloorMaterial space={space} />
        </mesh>
      )}
      {(view === 'planta' || space.outdoor) && <primitive object={grid} position={[0, 0.006, 0]} />}
      <Polyline points={border} color={space.outdoor ? '#ffffff' : '#5b6672'} />
      {view === 'planta' && (
        <>
          {isPoly ? (
            // Cota de cada tramo de pared, fuera de la sala
            outline.map((a, i) => {
              const b = outline[(i + 1) % outline.length];
              const n = inwardNormal(outline, i);
              return (
                <Html zIndexRange={[10, 0]} key={i} position={[(a.x + b.x) / 2 - n.x * 0.6, 0, (a.z + b.z) / 2 - n.z * 0.6]} center className="dim-label">
                  {i + 1} · {decimal(floorLang, Math.hypot(b.x - a.x, b.z - a.z))} m
                </Html>
              );
            })
          ) : (
            <>
              <Html zIndexRange={[10, 0]} position={[0, 0, -D / 2 - 0.6]} center className="dim-label">
                {decimal(floorLang, W)} m
              </Html>
              <Html zIndexRange={[10, 0]} position={[-W / 2 - 0.6, 0, 0]} center className="dim-label">
                {decimal(floorLang, D)} m
              </Html>
            </>
          )}
          <Html zIndexRange={[10, 0]} position={[0, 0, -D / 2 - 1.4]} center className="dim-label north">
            {floorLang === 'en' ? '▲ Front / stage' : '▲ Frente / escenario'}
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

/** Pulsación sobre un elemento: seleccionar y empezar a arrastrar (también desde sillas agrupadas). */
export function itemPointerDown(e: ThreeEvent<PointerEvent>, itemId: string) {
    if (e.button !== 0) return;
    const st = useStore.getState();
    if (st.tool !== 'select') return;
    e.stopPropagation();
    hitItemThisPress = true;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let ids = st.selection;
    if (additive) {
      st.select([itemId], true);
      return;
    }
    if (!ids.includes(itemId)) {
      ids = [itemId];
      st.select(ids);
    }
    const p = new THREE.Vector3();
    if (!e.ray.intersectPlane(floorPlane, p)) return;
    const proj = st.project!;
    // Al mover una mesa se mueve con su decoración
    const extra = proj.items
      .filter((t) => ids.includes(t.id) && isTableDef(findDef(t.type, proj.customCatalog)))
      .flatMap((t) => attachedDecor(proj, t).map((d) => d.id))
      .filter((id) => !ids.includes(id));
    ids = [...ids, ...extra];
    dragState = {
      ids,
      start: p,
      orig: new Map(proj.items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, z: i.z }])),
      moved: false,
    };
    useInteraction.setState({ dragging: true });
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
  twin,
  seats,
}: {
  /** Ocupación «sentados/plazas» si hay invitados. */
  seats?: string;
  twin: boolean;
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
    if (interactive) itemPointerDown(e, item.id);
  };
  return (
    <group position={[item.x, elev + (item.y ?? 0), item.z]} rotation={[0, item.rot * DEG, 0]} onPointerDown={onDown} userData={{ itemId: item.id }}>
      <FurnitureMesh item={item} def={def} custom={custom} wallHeight={wallHeight} lightsOn={lightsOn} twin={twin} />
      {(selected || problem) && <Outline item={item} def={def} color={problem ? '#e5484d' : '#2f80ed'} />}
      {showLabel && item.label && (
        <Html position={[0, 1, 0]} center className="item-label" zIndexRange={[10, 0]}>
          {tableLabel(useStore.getState().clientMode ? useStore.getState().project?.event.language : 'es', item.label)}
          {seats !== undefined && <span className="occ"> {seats}</span>}
        </Html>
      )}
    </group>
  );
});

function Items({ project, view }: { project: Project; view: string }) {
  const selection = useStore((s) => s.selection);
  const clientMode = useStore((s) => s.clientMode);
  const sel = useMemo(() => new Set(selection), [selection]);
  // Durante el arrastre no se recalcula la seguridad (se actualiza al soltar)
  const dragging = useInteraction((s) => s.dragging);
  const lastProblems = useRef<Set<string>>(new Set());
  const problems = useMemo(() => {
    if (dragging) return lastProblems.current;
    return (lastProblems.current = problemItemIds(analyze(project).checks));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging ? null : project, dragging]);
  const lightsOn = project.lighting === 'noche' || project.lighting === 'gala';
  // Lo que se coloca encima de un escenario se eleva a su altura.
  const stages = project.items.filter((i) => i.type === 'escenario');
  const tables = project.items.filter((i) => isTableDef(findDef(i.type, project.customCatalog)));
  const occ = useMemo(() => {
    if (!project.guests?.length) return null;
    const m = new Map<string, number>();
    project.guests.forEach((g) => g.tableId && m.set(g.tableId, (m.get(g.tableId) ?? 0) + 1));
    return m;
  }, [project.guests]);
  const elevation = (it: Item) => {
    // La decoración de mesa se apoya en el tablero de la mesa sobre la que está.
    if (isDecorDef(findDef(it.type, project.customCatalog))) {
      for (const t of tables) {
        const tdef = findDef(t.type, project.customCatalog);
        if (onTableTop(t, tdef, it.x, it.z)) return itemDims(t, tdef).h;
      }
    }
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
  // Misma función mientras no cambien los elementos (para no recalcular las sillas agrupadas)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const elevationFn = useMemo(() => elevation, [project.items, project.customCatalog]);
  const interactiveScene = !clientMode && view !== 'paseo';
  return (
    <group>
      <ChairInstances project={project} elevation={elevationFn} onDown={interactiveScene ? itemPointerDown : undefined} />
      <InstancedChairsContext.Provider value={true}>
      {project.items.map((it) => {
        const def = findDef(it.type, project.customCatalog);
        return (
          <ItemNode
            elev={elevation(it)}
            twin={!!project.space.model}
            seats={occ && def?.chairs !== undefined ? `${occ.get(it.id) ?? 0}/${it.chairs ?? def.chairs}` : undefined}
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
      </InstancedChairsContext.Provider>
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
  const pos = placementFor(def, ghost, project.space, useStore.getState().snap && !isDecorDef(def));
  const tpl = useStore.getState().placingTemplate;
  const it: Item = { id: 'ghost', type: def.type, x: pos.x, z: pos.z, rot: pos.rot, chairs: tpl?.base.chairs ?? def.chairs, chairType: tpl?.base.chairType, color: tpl?.base.color };
  let y = def.mountY ?? 0;
  if (isDecorDef(def)) {
    const t = tableAt(project, pos.x, pos.z);
    if (t) y = itemDims(t, findDef(t.type, project.customCatalog)).h;
  }
  return (
    <group position={[pos.x, y, pos.z]} rotation={[0, pos.rot * DEG, 0]}>
      <FurnitureMesh item={it} def={def} custom={project.customCatalog} wallHeight={project.space.height} lightsOn={false} />
      <Outline item={it} def={def} color="#27ae60" />
    </group>
  );
}

export function placementFor(def: CatalogDef, p: THREE.Vector3, space: Space, snap: boolean) {
  if (def.wallMount && !space.outdoor) return snapToRoomWall(p.x, p.z, space, def.d);
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
          <Html zIndexRange={[10, 0]} position={[(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2 + 0.3, (pts[0].z + pts[1].z) / 2]} center className="measure-label">
            {dist.toFixed(2).replace('.', ',')} m
          </Html>
        </>
      )}
    </group>
  );
}

/** Comentarios del cliente señalados en el plano (numerados). */
function CommentPins() {
  const comments = useStore((s) => s.comments);
  const pending = useStore((s) => s.pendingPin);
  const pins = [...comments.filter((c) => Number.isFinite(c.x)), ...(pending ? [{ id: 'nuevo', n: 0, x: pending.x, z: pending.z, resolved: false }] : [])];
  if (!pins.length) return null;
  return (
    <group>
      {pins.map((c) => (
        <group key={c.id} position={[c.x, 0, c.z]}>
          <mesh position={[0, 1.6, 0]}>
            <sphereGeometry args={[0.18, 16, 12]} />
            <meshBasicMaterial color={c.resolved ? '#2e8540' : c.id === 'nuevo' ? '#2f80ed' : '#e5484d'} depthTest={false} transparent />
          </mesh>
          <mesh position={[0, 0.8, 0]}>
            <cylinderGeometry args={[0.02, 0.02, 1.6, 6]} />
            <meshBasicMaterial color={c.resolved ? '#2e8540' : '#e5484d'} depthTest={false} transparent opacity={0.6} />
          </mesh>
          <Html zIndexRange={[10, 0]} position={[0, 1.6, 0]} center className="pin-label">
            {c.n || '+'}
          </Html>
        </group>
      ))}
    </group>
  );
}

/** Contorno que se está dibujando en la planta. */
function OutlineDraft() {
  const pts = useStore((s) => s.drawPts);
  const tool = useStore((s) => s.tool);
  const line = useMemo(() => (pts.length ? [...pts, pts[0]].map((p) => new THREE.Vector3(p.x, 0.05, p.z)) : []), [pts]);
  if (tool !== 'outline' || !pts.length) return null;
  return (
    <group>
      {pts.length > 1 && <Polyline points={line} color="#e5484d" overlay />}
      {pts.map((p, i) => (
        <mesh key={i} position={[p.x, 0.05, p.z]}>
          <sphereGeometry args={[0.12, 12, 10]} />
          <meshBasicMaterial color={i === 0 ? '#2e8540' : '#e5484d'} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

// ---------- Interacción (arrastrar, colocar, medir, deseleccionar) ----------
function Interaction({ wrap }: { wrap: React.RefObject<HTMLDivElement> }) {
  const { camera, raycaster, scene, gl } = useThree();
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
              return snapToRoomWall(x, z, proj.space, itemDims(it, def).d);
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
      if (st.pinMode) {
        // El cliente señala en el plano el punto al que se refiere su comentario
        const p = floorPoint(e, el, camera, raycaster);
        if (p) st.setCloud({ pendingPin: { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 }, pinMode: false });
        return;
      }
      if (st.clientMode || st.view === 'paseo') return;
      if (st.tool === 'place' && st.placingType) {
        const p = floorPoint(e, el, camera, raycaster);
        const def = findDef(st.placingType, st.project.customCatalog);
        if (!p || !def) return;
        const pos = placementFor(def, p, st.project.space, st.snap && !isDecorDef(def));
        if (st.placingTemplate) {
          const id = st.placeTemplate(st.placingTemplate, pos.x, pos.z);
          if (!e.shiftKey) {
            st.setTool('select');
            st.select([id]);
            useInteraction.setState({ ghost: null });
          }
          return;
        }
        const id = st.addItem({ type: def.type, ...pos, chairs: def.chairs, centerpiece: def.chairs ? true : undefined, y: def.mountY });
        if (!e.shiftKey) {
          st.setTool('select');
          st.select([id]);
          useInteraction.setState({ ghost: null });
        }
      } else if (st.tool === 'outline') {
        const p = floorPoint(e, el, camera, raycaster);
        if (p) st.setDrawPts([...st.drawPts, { x: snapValue(p.x, 0.05), z: snapValue(p.z, 0.05) }]);
      } else if (st.tool === 'eyedropper') {
        // Lee el color real del píxel (escaneo, foto de pared, etc.).
        const c = gl.domElement;
        const r = c.getBoundingClientRect();
        const px = ((e.clientX - r.left) * c.width) / r.width;
        const py = ((e.clientY - r.top) * c.height) / r.height;
        const tmp = document.createElement('canvas');
        tmp.width = tmp.height = 1;
        const ctx = tmp.getContext('2d')!;
        ctx.drawImage(c, px, py, 1, 1, 0, 0, 1, 1);
        const [R, G, B] = ctx.getImageData(0, 0, 1, 1).data;
        st.setPicked('#' + [R, G, B].map((v) => v.toString(16).padStart(2, '0')).join(''));
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
  }, [camera, raycaster, scene, wrap, gl]);
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
  const { gl, scene, get } = useThree();
  useEffect(() => {
    sceneApi.gl = gl;
    sceneApi.scene = scene;
    sceneApi.camera = () => get().camera;
    sceneApi.exportRoot = root.current ?? undefined;
  }, [gl, scene, root]);
  return null;
}

export default function Scene() {
  const project = useStore((s) => s.project)!;
  const view = useStore((s) => s.view);
  const tool = useStore((s) => s.tool);
  const walkLocked = useInteraction((s) => s.walkLocked);
  const splat = useInteraction((s) => s.splat);
  const clientMode = useStore((s) => s.clientMode);
  const clientLang = clientMode ? project.event.language : 'es';
  const wrap = useRef<HTMLDivElement>(null);
  const root = useRef<THREE.Group>(null);
  const { space } = project;
  return (
    <div ref={wrap} className={`scene-wrap tool-${tool}`}>
      <Canvas
        shadows
        dpr={IS_MOBILE ? [1, 1.5] : [1, 2]}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        // Solo se dibuja cuando algo cambia, salvo en el paseo y con splats (que lo necesitan)
        frameloop={view === 'paseo' || space.splat ? 'always' : 'demand'}
        key={view}
      >
        <Cameras space={space} view={view} wrap={wrap} />
        <Lighting project={project} />
        <group ref={root} name="mice-design-escena">
          <Floor space={space} view={view} />
          <UnderlayMesh space={space} />
          <ScannedSpace space={space} view={view} />
          <SplatSpace space={space} />
          {space.showWalls && !space.outdoor && <Walls space={space} view={view} />}
          <Items project={project} view={view} />
        </group>
        <Ghost project={project} />
        <MeasureViz />
        <CommentPins />
        <OutlineDraft />
        <Interaction wrap={wrap} />
        <ApiBridge root={root} />
      </Canvas>
      {splat === 'loading' && <div className="scene-status">Cargando la captura fotorrealista…</div>}
      {splat === 'error' && <div className="scene-status error">No se pudo abrir el splat. Comprueba que es un .ply de Gaussian splatting, un .splat o un .ksplat.</div>}
      {view === 'paseo' && !walkLocked && (
        <div className="walk-overlay">
          <button id="walk-start" className="btn primary">
            {t(clientLang, 'Haz clic para recorrer el espacio')}
          </button>
          <p>{t(clientLang, 'W A S D o flechas para moverte · ratón para mirar · Mayús para ir más rápido · Esc para salir')}</p>
        </div>
      )}
    </div>
  );
}
