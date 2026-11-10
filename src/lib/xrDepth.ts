// Lectura del mapa de profundidad de las gafas (WebXR Depth Sensing) como puntos 3D.
//  · Quest 3 / 3S: la profundidad llega como textura en la GPU; se copia a una imagen pequeña
//    y se lee. El valor es profundidad inversa (1 − cerca / distancia).
//  · Otros dispositivos (móviles Android): llega en metros por CPU.
// Como no hay forma de saber de antemano cómo codifica cada dispositivo, se prueban las
// interpretaciones posibles y se elige la que coloca el suelo en su sitio (y = 0): el suelo
// es lo único cuya posición se conoce con seguridad.

import * as THREE from 'three';
import type { P3 } from './walkScan';

const W = 32;
const H = 24;

/* eslint-disable @typescript-eslint/no-explicit-any */
type Decode = 'inversa' | 'proyeccion' | 'metros';
const DECODES: Decode[] = ['inversa', 'proyeccion', 'metros'];

export const DEPTH_INIT = {
  usagePreference: ['gpu-optimized', 'cpu-optimized'],
  dataFormatPreference: ['unsigned-short', 'float32', 'luminance-alpha'],
};

export function makeDepthReader(gl: THREE.WebGLRenderer) {
  const rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
  const tex = new THREE.Texture();
  const mat = new THREE.ShaderMaterial({
    uniforms: { depthColor: { value: tex } },
    depthTest: false,
    depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      precision highp float;
      precision highp sampler2DArray;
      uniform sampler2DArray depthColor;
      varying vec2 vUv;
      void main() {
        float d = clamp(texture(depthColor, vec3(vUv, 0.0)).r, 0.0, 0.999999);
        float a = d * 255.0;
        float b = fract(a) * 255.0;
        float c = fract(b) * 255.0;
        gl_FragColor = vec4(floor(a) / 255.0, floor(b) / 255.0, floor(c) / 255.0, 1.0);
      }`,
  });
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const cam = new THREE.Camera();
  const px = new Uint8Array(W * H * 4);
  let binding: any = null;
  let bindingSession: XRSession | null = null;
  let rawTexture: WebGLTexture | null = null;

  // Calibración con el suelo: error acumulado de cada interpretación
  const stats = new Map<Decode, { n: number; sum: number; sq: number }>(DECODES.map((d) => [d, { n: 0, sum: 0, sq: 0 }]));
  let chosen: Decode | null = null;
  let failed = '';
  let cpu = false;
  let moving = 0;
  let lastQ: { x: number; y: number; z: number; w: number } | null = null;
  let lastP: { x: number; y: number; z: number } | null = null;

  const mWorld = new THREE.Matrix4();
  const v = new THREE.Vector3();

  /** Punto del mundo de una muestra: (u, v) de la vista en 0..1, z = distancia delante de la cámara. */
  const unproject = (P: Float32Array, u: number, vv: number, z: number): P3 => {
    const nx = u * 2 - 1;
    const ny = vv * 2 - 1;
    v.set(((nx + P[8]) * z) / P[0], ((ny + P[9]) * z) / P[5], -z).applyMatrix4(mWorld);
    return { x: v.x, y: v.y, z: v.z };
  };
  const toMeters = (mode: Decode, d: number, near: number, far: number, raw: number) => {
    if (mode === 'metros') return d * raw;
    if (mode === 'inversa') return near / Math.max(1e-6, 1 - d);
    // Profundidad de ventana de una proyección con plano lejano finito
    return Number.isFinite(far) && far > near ? (near * far) / (far - d * (far - near)) : near / Math.max(1e-6, 1 - d);
  };

  return {
    /** Interpretación elegida ('inversa', 'proyeccion', 'metros'), o null si aún se está calibrando. */
    get mode() {
      return chosen;
    },
    /** Motivo por el que la profundidad no sirve en este dispositivo ('' si va bien). */
    get error() {
      return failed;
    },
    /** Seguimiento del movimiento de la cabeza; se llama en todos los fotogramas. */
    track(frame: XRFrame, ref: XRReferenceSpace) {
      const t = frame.getViewerPose(ref)?.transform;
      if (!t) return;
      const q = t.orientation;
      const p = t.position;
      if (lastQ) {
        const dot = Math.abs(q.x * lastQ.x + q.y * lastQ.y + q.z * lastQ.z + q.w * lastQ.w);
        const ang = 2 * Math.acos(Math.min(1, dot));
        const dist = Math.hypot(p.x - lastP!.x, p.y - lastP!.y, p.z - lastP!.z);
        // Más de 2,5° o 4 cm entre dos fotogramas: se espera unos fotogramas a que se asiente
        if (ang > 0.044 || dist > 0.04) moving = 4;
        else if (moving > 0) moving--;
      }
      lastQ = { x: q.x, y: q.y, z: q.z, w: q.w };
      lastP = { x: p.x, y: p.y, z: p.z };
    },
    reset() {
      chosen = null;
      failed = '';
      for (const s of stats.values()) s.n = s.sum = s.sq = 0;
    },
    dispose() {
      rt.dispose();
      mat.dispose();
      quad.geometry.dispose();
    },
    /**
     * Puntos vistos en este fotograma (coordenadas del espacio de referencia) y posición de la
     * cabeza. Devuelve null si no hay profundidad; lista vacía mientras se calibra.
     */
    read(frame: XRFrame, ref: XRReferenceSpace): { head: P3; pts: P3[] } | null {
      const session = frame.session as XRSession & { depthUsage?: string };
      const pose = frame.getViewerPose(ref);
      const view = pose?.views[0];
      if (!view || failed) return null;
      let usage: string | undefined;
      try {
        usage = session.depthUsage;
      } catch {
        return null;
      }
      if (!usage) return null;
      // Con la cabeza moviéndose deprisa la profundidad va un instante por detrás de la
      // posición: esas lecturas se descartan (el llamador debe invocar track() cada fotograma).
      if (moving > 0) return { head: { x: view.transform.position.x, y: view.transform.position.y, z: view.transform.position.z }, pts: [] };
      mWorld.fromArray(view.transform.matrix);
      const P = view.projectionMatrix;
      const head = { x: view.transform.position.x, y: view.transform.position.y, z: view.transform.position.z };
      const samples: { u: number; v: number; d: number }[] = [];
      let near = 0.1;
      let far = Infinity;
      let raw = 1;

      if (usage === 'cpu-optimized') {
        cpu = true;
        let info: any;
        try {
          info = (frame as any).getDepthInformation?.(view);
        } catch {
          return null;
        }
        if (!info) return { head, pts: [] };
        for (let j = 0; j < H; j++)
          for (let i = 0; i < W; i++) {
            const u = (i + 0.5) / W;
            const vv = (j + 0.5) / H;
            // En la API de CPU la coordenada (0, 0) es la esquina superior izquierda
            const m = info.getDepthInMeters(u, 1 - vv);
            if (m > 0) samples.push({ u, v: vv, d: m });
          }
      } else {
        if (bindingSession !== session) {
          const XRB = (window as any).XRWebGLBinding;
          if (!XRB) return null;
          binding = new XRB(session, gl.getContext());
          bindingSession = session;
        }
        let info: any;
        try {
          info = binding.getDepthInformation(view);
        } catch {
          return null;
        }
        if (!info?.texture) return { head, pts: [] };
        near = info.depthNear > 0 ? info.depthNear : (session.renderState.depthNear ?? 0.1);
        far = info.depthFar > 0 ? info.depthFar : Infinity;
        raw = info.rawValueToMeters || 1;
        if (rawTexture !== info.texture) {
          rawTexture = info.texture;
          (gl.properties.get(tex) as any).__webglTexture = info.texture;
        }
        // Copia de la capa del ojo izquierdo a una imagen de 32 × 24 y lectura
        const prev = gl.getRenderTarget();
        const xrOn = gl.xr.enabled;
        gl.xr.enabled = false;
        gl.setRenderTarget(rt);
        gl.render(scene, cam);
        gl.readRenderTargetPixels(rt, 0, 0, W, H, px);
        gl.setRenderTarget(prev);
        gl.xr.enabled = xrOn;
        for (let j = 0; j < H; j++)
          for (let i = 0; i < W; i++) {
            const k = (j * W + i) * 4;
            const d = (px[k] + px[k + 1] / 255 + px[k + 2] / 65025) / 255;
            if (d > 0.0001) samples.push({ u: (i + 0.5) / W, v: (j + 0.5) / H, d });
          }
      }
      if (!samples.length) return { head, pts: [] };

      const modes: Decode[] = cpu ? ['metros'] : DECODES;
      if (!chosen) {
        // Calibración: con cada interpretación, ¿dónde cae el suelo que se ve al mirar hacia abajo?
        for (const mode of modes) {
          const st = stats.get(mode)!;
          for (const s of samples) {
            const z = toMeters(mode, s.d, near, far, raw);
            if (!(z > 0.2 && z < 8)) continue;
            const p = unproject(P, s.u, s.v, z);
            const dist = Math.hypot(p.x - head.x, p.z - head.z);
            // Rayos claramente hacia abajo y cercanos: tienen que dar en el suelo (o en un mueble bajo)
            if (head.y - p.y > 0.8 && head.y - p.y > dist * 0.9) {
              st.n++;
              st.sum += p.y;
              st.sq += p.y * p.y;
            }
          }
        }
        const ready = modes.map((m) => ({ m, ...stats.get(m)! })).filter((s) => s.n >= 400);
        if (ready.length) {
          ready.sort((a, b) => Math.abs(a.sum / a.n) - Math.abs(b.sum / b.n));
          const best = ready[0];
          const mean = best.sum / best.n;
          const sd = Math.sqrt(Math.max(0, best.sq / best.n - mean * mean));
          if (Math.abs(mean) < 0.12 && sd < 0.25) chosen = best.m;
          else if (best.n > 4000) failed = `La profundidad de estas gafas no cuadra con el suelo (${Math.round(mean * 100)} cm de error)`;
        }
        if (!chosen) return { head, pts: [] };
      }
      const pts: P3[] = [];
      for (const s of samples) {
        const z = toMeters(chosen, s.d, near, far, raw);
        if (z > 0.2 && z < 12) pts.push(unproject(P, s.u, s.v, z));
      }
      return { head, pts };
    },
  };
}
