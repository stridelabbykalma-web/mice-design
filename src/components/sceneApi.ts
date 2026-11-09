import type * as THREE from 'three';

/** Acceso a la escena 3D desde fuera del lienzo (capturas, exportación, cargadores). */
export const sceneApi: {
  gl?: THREE.WebGLRenderer;
  scene?: THREE.Scene;
  exportRoot?: THREE.Object3D;
  modelObject?: THREE.Object3D | null;
  /** Abre la sesión de gafas (realidad mixta o virtual). */
  enterXR?: (mode: 'ar' | 'vr', task?: 'ver' | 'medir') => Promise<void>;
  /** Cámara activa (para capturas y mediciones de rendimiento). */
  camera?: () => THREE.Camera;
  /** Estado de carga del Gaussian splatting. */
  splatStatus?: 'loading' | 'ok' | 'error' | null;
} = {};
