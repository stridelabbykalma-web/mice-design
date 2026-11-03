import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { sceneApi } from './sceneApi';
import type { CatalogDef, Item } from '../types';
import { findDef, isRoundTable, itemDims, rectChairLayout } from '../catalog';
import { assetUrl, getAsset } from '../lib/db';

// ---------- Texturas de texto (sin dependencias de fuentes externas) ----------
const textCache = new Map<string, THREE.CanvasTexture>();
export function textTexture(text: string, bg: string, fg: string, w = 512, h = 256) {
  const key = `${text}|${bg}|${fg}|${w}|${h}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  const size = Math.min(h / (lines.length * 1.3), (w * 1.6) / Math.max(...lines.map((l) => l.length)));
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * size * 1.2));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  textCache.set(key, t);
  return t;
}

// ---------- Modelos GLB (fotogrametría / escaneo 3D) ----------
const gltfCache = new Map<string, Promise<THREE.Object3D>>();
let gltfLoader: GLTFLoader | null = null;
/** Cargador glTF compatible con las exportaciones habituales de apps de escaneo (Draco, Meshopt, KTX2). */
function getGltfLoader() {
  if (gltfLoader) return gltfLoader;
  const base = new URL('./', document.baseURI).href;
  const draco = new DRACOLoader().setDecoderPath(base + 'draco/');
  const ktx2 = new KTX2Loader().setTranscoderPath(base + 'basis/');
  const gl = sceneApi.gl;
  if (gl) ktx2.detectSupport(gl);
  gltfLoader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2).setMeshoptDecoder(MeshoptDecoder);
  return gltfLoader;
}

/** PLY de fotogrametría: malla con colores por vértice o, si no tiene caras, nube de puntos. */
function plyToObject(geo: THREE.BufferGeometry): THREE.Object3D {
  const hasColor = !!geo.getAttribute('color');
  if (geo.index) {
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    return new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: hasColor, color: hasColor ? '#ffffff' : '#cccccc', roughness: 0.9 }));
  }
  return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.012, vertexColors: hasColor, color: hasColor ? '#ffffff' : '#cccccc' }));
}

export function loadGltf(assetId: string): Promise<THREE.Object3D> {
  let p = gltfCache.get(assetId);
  if (!p) {
    p = Promise.all([assetUrl(assetId), getAsset(assetId)]).then(
      ([url, asset]) =>
        new Promise<THREE.Object3D>((resolve, reject) => {
          if (!url) return reject(new Error('Archivo no encontrado'));
          if (asset && /\.ply$/i.test(asset.name)) {
            new PLYLoader().load(url, (geo) => resolve(plyToObject(geo)), undefined, reject);
            return;
          }
          getGltfLoader().load(
            url,
            (g) => {
              g.scene.traverse((o) => {
                const m = o as THREE.Mesh;
                if (m.isMesh) {
                  m.castShadow = true;
                  m.receiveShadow = true;
                }
              });
              resolve(g.scene);
            },
            undefined,
            reject,
          );
        }),
    );
    p.catch(() => gltfCache.delete(assetId));
    gltfCache.set(assetId, p);
  }
  return p;
}

export function useGltf(assetId?: string) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);
  useEffect(() => {
    let alive = true;
    setObj(null);
    if (assetId) loadGltf(assetId).then((o) => alive && setObj(o)).catch(() => alive && setObj(null));
    return () => {
      alive = false;
    };
  }, [assetId]);
  return obj;
}

/** Mueble escaneado: se centra en planta, se apoya en el suelo y (opcionalmente) se ajusta a sus medidas reales. */
function ScannedModel({ def, w, d, h }: { def: CatalogDef; w: number; d: number; h: number }) {
  const src = useGltf(def.modelAssetId);
  const prepared = useMemo(() => {
    if (!src) return null;
    const clone = src.clone(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const holder = new THREE.Group();
    clone.position.set(-center.x, -box.min.y, -center.z);
    holder.add(clone);
    if (def.fitToDims !== false && size.x > 0 && size.y > 0 && size.z > 0) holder.scale.set(w / size.x, h / size.y, d / size.z);
    return holder;
  }, [src, def.fitToDims, w, d, h]);
  if (!prepared)
    return (
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={def.color} transparent opacity={0.4} />
      </mesh>
    );
  return <primitive object={prepared} />;
}

// ---------- Piezas procedurales ----------

function Chair({ color = '#c9a45c', conference = false }: { color?: string; conference?: boolean }) {
  const seatH = 0.46;
  const legs: [number, number][] = [
    [-0.19, -0.19],
    [0.19, -0.19],
    [-0.19, 0.19],
    [0.19, 0.19],
  ];
  return (
    <group>
      <mesh position={[0, seatH, 0]} castShadow>
        <boxGeometry args={[0.44, 0.06, 0.44]} />
        <meshStandardMaterial color={conference ? '#3d4b5f' : '#f3efe6'} roughness={0.8} />
      </mesh>
      <mesh position={[0, seatH + 0.24, 0.2]} castShadow>
        <boxGeometry args={[0.42, 0.42, 0.04]} />
        <meshStandardMaterial color={conference ? '#3d4b5f' : color} roughness={0.5} metalness={conference ? 0 : 0.4} />
      </mesh>
      {legs.map(([x, z], i) => (
        <mesh key={i} position={[x, seatH / 2, z]}>
          <cylinderGeometry args={[0.012, 0.012, seatH, 6]} />
          <meshStandardMaterial color={conference ? '#222' : color} metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/** Silla genérica o escaneada, según el tipo elegido. */
function ChairOf({ type, custom, color }: { type?: string; custom: CatalogDef[]; color?: string }) {
  const def = type ? findDef(type, custom) : undefined;
  if (def?.modelAssetId) return <ScannedModel def={def} w={def.w} d={def.d} h={def.h} />;
  return <Chair color={color ?? def?.color} conference={type === 'silla-conferencia'} />;
}

function Centerpiece() {
  return (
    <group position={[0, 0.77, 0]}>
      <mesh position={[0, 0.12, 0]}>
        <cylinderGeometry args={[0.06, 0.08, 0.24, 12]} />
        <meshStandardMaterial color="#d8e3e8" transparent opacity={0.6} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.3, 0]}>
        <sphereGeometry args={[0.16, 12, 10]} />
        <meshStandardMaterial color="#e6b8c2" roughness={0.9} />
      </mesh>
    </group>
  );
}

function RoundTable({ r, h, color, chairs, chairType, custom, centerpiece }: { r: number; h: number; color: string; chairs: number; chairType?: string; custom: CatalogDef[]; centerpiece?: boolean }) {
  const chairR = r + 0.32;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[r + 0.02, r + 0.12, h, 40]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {centerpiece && <Centerpiece />}
      {Array.from({ length: chairs }, (_, i) => {
        const a = (i / chairs) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * chairR, 0, Math.cos(a) * chairR]} rotation={[0, a, 0]}>
            <ChairOf type={chairType} custom={custom} />
          </group>
        );
      })}
    </group>
  );
}

function RectTable({ type, w, d, h, color, chairs, chairType, custom, centerpiece }: { type: string; w: number; d: number; h: number; color: string; chairs: number; chairType?: string; custom: CatalogDef[]; centerpiece?: boolean }) {
  const lay = rectChairLayout(type, w, d, chairs);
  const row = (n: number, z: number, rot: number) =>
    Array.from({ length: n }, (_, i) => (
      <group key={`${z}-${i}`} position={[-w / 2 + (w / n) * (i + 0.5), 0, z]} rotation={[0, rot, 0]}>
        <ChairOf type={chairType} custom={custom} />
      </group>
    ));
  const longCloth = type !== 'mesa-escuela';
  return (
    <group>
      <mesh position={[0, h - 0.02, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, 0.04, d]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {longCloth ? (
        <mesh position={[0, (h - 0.04) / 2, 0]} castShadow>
          <boxGeometry args={[w + 0.02, h - 0.04, d + 0.02]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      ) : (
        // Faldón frontal de la mesa de escuela
        <mesh position={[0, h * 0.6, -d / 2]} castShadow>
          <boxGeometry args={[w, h * 0.7, 0.02]} />
          <meshStandardMaterial color={color} roughness={0.95} />
        </mesh>
      )}
      {!longCloth &&
        [-1, 1].map((s) => (
          <mesh key={s} position={[s * (w / 2 - 0.05), (h - 0.04) / 2, 0]}>
            <boxGeometry args={[0.04, h - 0.04, d * 0.8]} />
            <meshStandardMaterial color="#555" />
          </mesh>
        ))}
      {centerpiece && <Centerpiece />}
      {row(lay.back, d / 2 + 0.3, 0)}
      {row(lay.front, -d / 2 - 0.3, Math.PI)}
      {lay.ends >= 1 && (
        <group position={[-w / 2 - 0.3, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
          <ChairOf type={chairType} custom={custom} />
        </group>
      )}
      {lay.ends >= 2 && (
        <group position={[w / 2 + 0.3, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
          <ChairOf type={chairType} custom={custom} />
        </group>
      )}
    </group>
  );
}

function Box({ w, h, d, y, color, ...mat }: { w: number; h: number; d: number; y?: number; color: string; emissive?: string; roughness?: number; metalness?: number; map?: THREE.Texture; transparent?: boolean; opacity?: number }) {
  return (
    <mesh position={[0, y ?? h / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[w, h, d]} />
      <meshStandardMaterial color={color} {...mat} />
    </mesh>
  );
}

function danceFloorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  for (let i = 0; i < 8; i++)
    for (let j = 0; j < 8; j++) {
      ctx.fillStyle = (i + j) % 2 ? '#111' : '#f2f2f2';
      ctx.fillRect(i * 32, j * 32, 32, 32);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
let danceTex: THREE.Texture | null = null;

export function FurnitureMesh({ item, def, custom, wallHeight, lightsOn, twin = false }: { item: Item; def?: CatalogDef; custom: CatalogDef[]; wallHeight: number; lightsOn: boolean; twin?: boolean }) {
  const { w, d, h } = itemDims(item, def);
  const color = item.color ?? def?.color ?? '#cccccc';
  const chairs = item.chairs ?? def?.chairs ?? 0;
  if (!def) return <Box w={w} h={h} d={d} color="#f0f" />;

  // En un gemelo digital la arquitectura real ya está en el escaneo: solo se marca.
  if (twin && def.category === 'arquitectura') {
    const exit = item.type === 'salida';
    const hh = item.type === 'columna' || item.type === 'tabique' ? item.h ?? wallHeight : h;
    const y0 = item.type === 'ventana' ? 1.0 : 0;
    return (
      <group>
        <mesh position={[0, y0 + hh / 2, 0]}>
          <boxGeometry args={[w + 0.02, hh, Math.max(d, 0.06)]} />
          <meshBasicMaterial color={exit ? '#1e8a3c' : item.type === 'puerta' ? '#2f80ed' : '#8a8f98'} transparent opacity={0.18} depthWrite={false} />
        </mesh>
        {exit && (
          <mesh position={[0, h + 0.18, d / 2 + 0.03]}>
            <planeGeometry args={[0.6, 0.25]} />
            <meshBasicMaterial map={textTexture('SALIDA', '#1e8a3c', '#ffffff', 256, 106)} />
          </mesh>
        )}
      </group>
    );
  }

  if (def.modelAssetId) {
    // Mueble del hotel escaneado. Si es una mesa, se le añaden sus sillas.
    return (
      <group>
        <ScannedModel def={def} w={w} d={d} h={h} />
        {chairs > 0 &&
          (def.w === def.d ? (
            <RoundChairsOnly r={w / 2} chairs={chairs} chairType={item.chairType} custom={custom} />
          ) : (
            <RectChairsOnly type={item.type} w={w} d={d} chairs={chairs} chairType={item.chairType} custom={custom} />
          ))}
      </group>
    );
  }

  switch (item.type) {
    case 'mesa-redonda-180':
    case 'mesa-redonda-150':
      return <RoundTable r={w / 2} h={h} color={color} chairs={chairs} chairType={item.chairType} custom={custom} centerpiece={item.centerpiece} />;
    case 'mesa-imperial':
    case 'mesa-escuela':
      return <RectTable type={item.type} w={w} d={d} h={h} color={color} chairs={chairs} chairType={item.chairType} custom={custom} centerpiece={item.centerpiece} />;
    case 'mesa-coctel':
      return (
        <group>
          <mesh position={[0, h / 2, 0]} castShadow>
            <cylinderGeometry args={[w / 2, w / 2.4, h, 24]} />
            <meshStandardMaterial color={color} roughness={0.8} />
          </mesh>
          <mesh position={[0, h, 0]}>
            <cylinderGeometry args={[w / 2 + 0.02, w / 2 + 0.02, 0.03, 24]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      );
    case 'buffet':
      return (
        <group>
          <Box w={w} h={h} d={d} color={color} roughness={0.95} />
          {[-0.7, 0, 0.7].map((x) => (
            <mesh key={x} position={[x * (w / 2.4), h + 0.06, 0]}>
              <boxGeometry args={[0.5, 0.1, 0.32]} />
              <meshStandardMaterial color="#c0c0c0" metalness={0.8} roughness={0.25} />
            </mesh>
          ))}
        </group>
      );
    case 'barra':
      return (
        <group>
          <Box w={w} h={h} d={d} color={color} roughness={0.6} />
          <Box w={w + 0.05} h={0.04} d={d + 0.1} y={h} color="#e8e1d5" roughness={0.3} />
        </group>
      );
    case 'silla':
      return <Chair color={color} />;
    case 'silla-conferencia':
      return <Chair conference />;
    case 'sofa':
      return (
        <group>
          <Box w={w} h={0.42} d={d} color={color} roughness={0.9} />
          <mesh position={[0, 0.62, d / 2 - 0.09]} castShadow>
            <boxGeometry args={[w, 0.4, 0.18]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (w / 2 - 0.09), 0.55, 0]} castShadow>
              <boxGeometry args={[0.18, 0.26, d]} />
              <meshStandardMaterial color={color} roughness={0.9} />
            </mesh>
          ))}
        </group>
      );
    case 'butaca':
      return (
        <group>
          <Box w={w} h={0.42} d={d} color={color} roughness={0.9} />
          <mesh position={[0, 0.62, d / 2 - 0.09]} castShadow>
            <boxGeometry args={[w, 0.4, 0.18]} />
            <meshStandardMaterial color={color} roughness={0.9} />
          </mesh>
        </group>
      );
    case 'escenario':
      return (
        <group>
          <Box w={w} h={h} d={d} color={color} roughness={0.7} />
          <mesh position={[0, h / 2, d / 2 + 0.005]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color="#111" roughness={1} />
          </mesh>
        </group>
      );
    case 'atril':
      return (
        <group>
          <Box w={w} h={h} d={d} color={color} roughness={0.5} />
          <mesh position={[0, h * 0.6, -d / 2 - 0.002]} rotation={[0, Math.PI, 0]}>
            <planeGeometry args={[w * 0.7, w * 0.35]} />
            <meshBasicMaterial map={textTexture('MICE', '#3b3f46', '#e0c27a')} />
          </mesh>
        </group>
      );
    case 'pantalla': {
      const legH = Math.max(0.6, Math.min(1.2, wallHeight - h - 0.1));
      return (
        <group>
          <mesh position={[0, legH + h / 2, 0]} castShadow>
            <boxGeometry args={[w + 0.1, h + 0.1, 0.05]} />
            <meshStandardMaterial color="#111" />
          </mesh>
          <mesh position={[0, legH + h / 2, 0.03]}>
            <planeGeometry args={[w, h]} />
            <meshStandardMaterial color="#ffffff" emissive="#5a7fa8" emissiveIntensity={lightsOn ? 0.8 : 0.3} map={textTexture('MICE Design\nBienvenidos', '#0d2440', '#ffffff', 1024, 576)} />
          </mesh>
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * (w / 2), legH / 2, 0]}>
              <cylinderGeometry args={[0.025, 0.025, legH, 8]} />
              <meshStandardMaterial color="#222" metalness={0.7} />
            </mesh>
          ))}
        </group>
      );
    }
    case 'pista-baile':
      if (!danceTex) danceTex = danceFloorTexture();
      return (
        <mesh position={[0, 0.015, 0]} receiveShadow>
          <boxGeometry args={[w, 0.03, d]} />
          <meshStandardMaterial map={danceTex} roughness={0.2} metalness={0.2} />
        </mesh>
      );
    case 'planta':
      return (
        <group>
          <mesh position={[0, 0.25, 0]} castShadow>
            <cylinderGeometry args={[0.22, 0.17, 0.5, 16]} />
            <meshStandardMaterial color="#d8d2c4" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.05, 0]} castShadow>
            <sphereGeometry args={[0.38, 14, 12]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
          <mesh position={[0.08, 1.4, 0.05]} castShadow>
            <sphereGeometry args={[0.26, 12, 10]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        </group>
      );
    case 'photocall':
      return (
        <group>
          <Box w={w} h={h} d={0.08} color={color} />
          <mesh position={[0, h / 2, 0.045]}>
            <planeGeometry args={[w * 0.95, h * 0.95]} />
            <meshStandardMaterial map={textTexture(item.label || 'PHOTOCALL', '#ffffff', '#0f4c81', 512, 410)} />
          </mesh>
          <Box w={w} h={0.05} d={d} y={0.025} color="#333" />
        </group>
      );
    case 'cuadro':
      return <PhotoFrame assetId={item.imageAssetId} w={w} h={h} d={d} frame={color} />;
    case 'espejo':
      return (
        <group>
          <mesh castShadow>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={color} metalness={0.7} roughness={0.35} />
          </mesh>
          <mesh position={[0, 0, d / 2 + 0.002]}>
            <planeGeometry args={[w - 0.12, h - 0.12]} />
            <meshStandardMaterial color="#dfe8ee" metalness={0.9} roughness={0.08} emissive="#9fb2c0" emissiveIntensity={0.15} />
          </mesh>
        </group>
      );
    case 'alfombra':
      return (
        <mesh position={[0, 0.006, 0]} receiveShadow>
          <boxGeometry args={[w, 0.012, d]} />
          <meshStandardMaterial color={color} roughness={1} />
        </mesh>
      );
    case 'uplight':
      return (
        <group>
          <Box w={w} h={h} d={d} color="#1a1a1a" metalness={0.6} />
          <mesh position={[0, h + 0.001, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <circleGeometry args={[w * 0.4, 16]} />
            <meshBasicMaterial color={color} />
          </mesh>
        </group>
      );
    case 'foco':
      return (
        <group>
          <mesh position={[0, h / 2, 0]}>
            <cylinderGeometry args={[0.02, 0.03, h, 8]} />
            <meshStandardMaterial color="#222" metalness={0.7} />
          </mesh>
          <mesh position={[0, h, 0.05]} rotation={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.12, 0.09, 0.25, 16]} />
            <meshStandardMaterial color="#222" emissive={color} emissiveIntensity={lightsOn ? 0.6 : 0} />
          </mesh>
        </group>
      );
    case 'totem':
    case 'atril-bienvenida': {
      const isTotem = item.type === 'totem';
      const text = item.label || (isTotem ? 'Congreso\n→ Salón' : 'Bienvenidos');
      return (
        <group>
          {isTotem ? (
            <Box w={w} h={h} d={0.12} color={color} />
          ) : (
            [-1, 1].map((s) => (
              <mesh key={s} position={[s * 0.25, h / 2, 0]}>
                <cylinderGeometry args={[0.015, 0.015, h, 6]} />
                <meshStandardMaterial color="#c9a45c" metalness={0.7} />
              </mesh>
            ))
          )}
          <mesh position={[0, isTotem ? h * 0.6 : h * 0.7, isTotem ? 0.065 : 0.01]}>
            <planeGeometry args={[w * 0.9, isTotem ? h * 0.6 : w * 0.9]} />
            <meshStandardMaterial map={textTexture(text, isTotem ? color : '#ffffff', isTotem ? '#ffffff' : '#333333', 384, isTotem ? 768 : 384)} />
          </mesh>
        </group>
      );
    }
    case 'columna':
      return <Box w={w} h={item.h ?? wallHeight} d={d} color={color} roughness={0.8} />;
    case 'tabique':
      return <Box w={w} h={item.h ?? wallHeight} d={d} color={color} roughness={0.9} />;
    case 'puerta':
    case 'salida': {
      const exit = item.type === 'salida';
      return (
        <group>
          <Box w={w} h={h} d={d} color={exit ? '#c9d6cc' : color} roughness={0.6} />
          <mesh position={[0, h / 2, d / 2 + 0.003]}>
            <planeGeometry args={[0.02, h * 0.95]} />
            <meshBasicMaterial color="#333" />
          </mesh>
          {exit && (
            <mesh position={[0, h + 0.18, d / 2 + 0.01]}>
              <planeGeometry args={[0.6, 0.25]} />
              <meshBasicMaterial map={textTexture('SALIDA', '#1e8a3c', '#ffffff', 256, 106)} />
            </mesh>
          )}
        </group>
      );
    }
    case 'ventana':
      return (
        <group>
          <mesh position={[0, 1.0 + h / 2, 0]}>
            <boxGeometry args={[w, h, d]} />
            <meshStandardMaterial color={color} transparent opacity={0.45} emissive="#bcd7ea" emissiveIntensity={0.5} roughness={0.05} />
          </mesh>
        </group>
      );
    case 'toma-corriente':
      return (
        <mesh position={[0, 0.3, 0]}>
          <boxGeometry args={[w, h, d]} />
          <meshStandardMaterial color={color} />
        </mesh>
      );
    default:
      return <Box w={w} h={h} d={d} color={color} />;
  }
}

function RoundChairsOnly({ r, chairs, chairType, custom }: { r: number; chairs: number; chairType?: string; custom: CatalogDef[] }) {
  const R = r + 0.32;
  return (
    <>
      {Array.from({ length: chairs }, (_, i) => {
        const a = (i / chairs) * Math.PI * 2;
        return (
          <group key={i} position={[Math.sin(a) * R, 0, Math.cos(a) * R]} rotation={[0, a, 0]}>
            <ChairOf type={chairType} custom={custom} />
          </group>
        );
      })}
    </>
  );
}

function RectChairsOnly({ type, w, d, chairs, chairType, custom }: { type: string; w: number; d: number; chairs: number; chairType?: string; custom: CatalogDef[] }) {
  const lay = rectChairLayout(type, w, d, chairs);
  const row = (n: number, z: number, rot: number) =>
    Array.from({ length: n }, (_, i) => (
      <group key={`${z}-${i}`} position={[-w / 2 + (w / n) * (i + 0.5), 0, z]} rotation={[0, rot, 0]}>
        <ChairOf type={chairType} custom={custom} />
      </group>
    ));
  return (
    <>
      {row(lay.back, d / 2 + 0.3, 0)}
      {row(lay.front, -d / 2 - 0.3, Math.PI)}
    </>
  );
}

export { isRoundTable };

// ---------- Texturas a partir de fotos reales (paredes, suelo, cuadros) ----------
const texCache = new Map<string, Promise<THREE.Texture>>();
export function loadTexture(assetId: string): Promise<THREE.Texture> {
  let p = texCache.get(assetId);
  if (!p) {
    p = assetUrl(assetId).then(
      (url) =>
        new Promise<THREE.Texture>((resolve, reject) => {
          if (!url) return reject(new Error('Imagen no encontrada'));
          new THREE.TextureLoader().load(
            url,
            (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = 8;
              resolve(t);
            },
            undefined,
            reject,
          );
        }),
    );
    texCache.set(assetId, p);
  }
  return p;
}

export function useAssetTexture(assetId?: string) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let alive = true;
    setTex(null);
    if (assetId) loadTexture(assetId).then((t) => alive && setTex(t)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [assetId]);
  return tex;
}

/** Cuadro, lienzo o fotografía real del hotel, con su marco. El origen es el centro del cuadro. */
function PhotoFrame({ assetId, w, h, d, frame }: { assetId?: string; w: number; h: number; d: number; frame: string }) {
  const tex = useAssetTexture(assetId);
  const border = Math.min(0.06, Math.min(w, h) * 0.06);
  return (
    <group>
      <mesh castShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={frame} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0, d / 2 + 0.002]}>
        <planeGeometry args={[w - 2 * border, h - 2 * border]} />
        {tex ? (
          <meshStandardMaterial map={tex} roughness={0.8} />
        ) : (
          <meshBasicMaterial map={textTexture('Sube la foto\ndel cuadro', '#efe9df', '#8a7f70', 512, 384)} />
        )}
      </mesh>
    </group>
  );
}
