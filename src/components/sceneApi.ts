import type * as THREE from 'three';

/** Acceso a la escena 3D desde fuera del lienzo (capturas, exportación, cargadores). */
export const sceneApi: {
  gl?: THREE.WebGLRenderer;
  scene?: THREE.Scene;
  exportRoot?: THREE.Object3D;
  modelObject?: THREE.Object3D | null;
} = {};
