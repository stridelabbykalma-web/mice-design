// Realidad aumentada en iPhone/iPad (AR Quick Look): exporta el montaje a USDZ a escala real
// para verlo colocado en la sala vacía y caminar entre las mesas.

import * as THREE from 'three';
import type { Project } from '../types';
import { roomOutline } from './outline';
import { sceneApi } from '../components/sceneApi';
import { findDef } from '../catalog';

export type ArAnchor = 'centro' | 'esquina' | 'puerta';

export const AR_ANCHORS: Record<ArAnchor, { label: string; help: string }> = {
  centro: { label: 'Centro de la sala', help: 'Colócate en el centro de la sala y toca el suelo a tus pies.' },
  esquina: { label: 'Esquina del frente (izquierda)', help: 'Ve a la esquina del frente de la sala (lado del escenario), a la izquierda mirando al frente, y toca el suelo en la esquina.' },
  puerta: { label: 'Puerta principal', help: 'Colócate en el centro de la puerta principal, por dentro de la sala, y toca el suelo.' },
};

export const isIOS = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

/** Punto de la sala que coincidirá con el punto real donde se toque el suelo. */
export function anchorPoint(project: Project, anchor: ArAnchor) {
  if (anchor === 'esquina') {
    const pts = roomOutline(project.space);
    // La esquina más adelantada y más a la izquierda (frente = z negativa)
    return [...pts].sort((a, b) => a.z + a.x * 0.01 - (b.z + b.x * 0.01))[0];
  }
  if (anchor === 'puerta') {
    const door = project.items.find((i) => i.type === 'puerta') ?? project.items.find((i) => i.type === 'salida');
    if (door) return { x: door.x, z: door.z };
  }
  return { x: 0, z: 0 };
}

/** Las sillas agrupadas (InstancedMesh) se convierten en piezas sueltas: USDZ no admite instancias. */
function expandInstances(root: THREE.Object3D) {
  const inst: THREE.InstancedMesh[] = [];
  root.traverse((o) => (o as THREE.InstancedMesh).isInstancedMesh && inst.push(o as THREE.InstancedMesh));
  for (const im of inst) {
    const parent = im.parent!;
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const base = im.material as THREE.MeshStandardMaterial;
    const cache = new Map<string, THREE.MeshStandardMaterial>();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, m);
      let mat = base;
      if (im.instanceColor) {
        im.getColorAt(i, c);
        const key = c.getHexString();
        mat = cache.get(key) ?? (cache.set(key, base.clone()), cache.get(key)!);
        mat.color.copy(base.color).multiply(c);
      }
      const mesh = new THREE.Mesh(im.geometry, mat);
      mesh.applyMatrix4(m);
      parent.add(mesh);
    }
    parent.remove(im);
  }
}

/** USDZ solo admite materiales PBR: los básicos (rótulos, pantallas) se convierten. */
function standardizeMaterials(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const conv = (m: THREE.Material) => {
      if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) return m;
      const b = m as THREE.MeshBasicMaterial;
      return new THREE.MeshStandardMaterial({ color: b.color ?? new THREE.Color('#ffffff'), map: b.map ?? null, transparent: b.transparent, opacity: b.opacity, roughness: 0.8 });
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(conv) : conv(mesh.material);
  });
}

/** Línea en el suelo con el contorno de la sala, para encajar el montaje con las paredes reales. */
function outlineGuide(project: Project) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: '#2f80ed', roughness: 0.6 });
  const pts = roomOutline(project.space);
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.004, 0.05), mat);
    strip.position.set((a.x + b.x) / 2, 0.002, (a.z + b.z) / 2);
    strip.rotation.y = Math.atan2(-(b.z - a.z), b.x - a.x);
    g.add(strip);
  });
  return g;
}

/** Genera el archivo USDZ del montaje actual. */
export async function exportArUsdz(project: Project, opts: { anchor: ArAnchor; outline: boolean }): Promise<Blob> {
  const src = sceneApi.scene?.getObjectByName('mice-montaje');
  if (!src) throw new Error('La escena no está lista. Vuelve a intentarlo en la vista 3D.');
  const root = new THREE.Group();
  const content = src.clone(true);
  // Fuera lo que no es del montaje: contornos de selección y marcas de ayuda
  const helpers: THREE.Object3D[] = [];
  content.traverse((o) => o.name === 'ayuda-seleccion' && helpers.push(o));
  helpers.forEach((h) => h.parent?.remove(h));
  // Lo que ya existe en la sala real (puertas, ventanas, columnas, cuadros) no se duplica
  const real = new Set(
    project.items
      .filter((i) => {
        const d = findDef(i.type, project.customCatalog);
        return d?.category === 'arquitectura' || i.type === 'cuadro' || i.type === 'espejo';
      })
      .map((i) => i.id),
  );
  const drop: THREE.Object3D[] = [];
  content.traverse((o) => o.userData?.itemId && real.has(o.userData.itemId) && drop.push(o));
  drop.forEach((o) => o.parent?.remove(o));
  root.add(content);
  if (opts.outline) root.add(outlineGuide(project));
  const a = anchorPoint(project, opts.anchor);
  root.position.set(-a.x, 0, -a.z);
  const wrapper = new THREE.Group();
  wrapper.add(root);
  wrapper.updateMatrixWorld(true);
  expandInstances(wrapper);
  standardizeMaterials(wrapper);
  const { USDZExporter } = await import('three/examples/jsm/exporters/USDZExporter.js');
  const data = await new USDZExporter().parseAsync(wrapper, {
    quickLookCompatible: true,
    maxTextureSize: 1024,
    includeAnchoringProperties: true,
    ar: { anchoring: { type: 'plane' }, planeAnchoring: { alignment: 'horizontal' } },
  });
  return new Blob([data], { type: 'model/vnd.usdz+zip' });
}

/**
 * Abre el visor de realidad aumentada del iPhone. Safari solo lo abre desde un enlace
 * rel="ar" con una imagen dentro; «allowsContentScaling=0» impide cambiar la escala real.
 */
export function openQuickLook(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.rel = 'ar';
  a.href = `${url}#allowsContentScaling=0`;
  a.appendChild(document.createElement('img'));
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 60000);
}
