// Modo gafas (WebXR): realidad mixta sobre la sala vacía y realidad virtual del gemelo digital.
//  · Realidad mixta: se ve la sala real y encima el montaje. Se alinea marcando con el mando
//    (o pellizcando con la mano) las dos esquinas del frente de la sala.
//  · Realidad virtual: el gemelo completo; se camina o se teletransporta apuntando al suelo.
//  · Medir la sala: las gafas leen su escaneo de la sala (paredes, puertas, ventanas, techo);
//    si no lo tienen, la app les pide escanearla en ese momento, y si no pueden, se marcan
//    las esquinas a mano; la sala se guarda en el proyecto y se diseña en el PC.
//  · Al volver a entrar, el montaje se coloca solo: con el anclaje que guardan las gafas o
//    encajando la sala con las paredes que detectan.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { alignFromCorners, frontCorners, saveAnchor, savedAnchor, useXR, type XrMode } from '../lib/xr';
import { cornersToRoomPlan, currentRoomPlanes, planeObstacles, fitModelToWalls, planesToRoomPlan, wallSegments, type ScanPlane } from '../lib/xrScan';
import { parseRoomPlan } from '../lib/roomplan';
import { placeObstacles } from '../lib/scanImport';
import { WalkScan, type Obstacle, type WalkOutline } from '../lib/walkScan';
import { DEPTH_INIT, makeDepthReader } from '../lib/xrDepth';
import { logEvent } from '../lib/usageLog';
import { sceneApi } from './sceneApi';

const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/** Panel de texto que flota delante de la vista. */
function makePanel() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 999;
  const draw = (text: string) => {
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 256);
    if (text) {
      ctx.fillStyle = 'rgba(15, 30, 50, 0.85)';
      ctx.beginPath();
      ctx.roundRect(8, 8, 1008, 240, 40);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = text.split('\n');
      // Letra más pequeña si alguna línea no cabe
      let size = 44;
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if (widest > 960) size = Math.floor((size * 960) / widest);
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      lines.forEach((l, i) => ctx.fillText(l, 512, 128 + (i - (lines.length - 1) / 2) * 56));
    }
    tex.needsUpdate = true;
    mesh.visible = !!text;
  };
  return { mesh, draw };
}


/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFrame = XRFrame & { detectedPlanes?: Set<any>; createAnchor?: (pose: XRRigidTransform, space: XRSpace) => Promise<any> };
type AnySession = XRSession & {
  initiateRoomCapture?: () => Promise<void>;
  restorePersistentAnchor?: (uuid: string) => Promise<any>;
  deletePersistentAnchor?: (uuid: string) => Promise<void>;
};

/** Planos que detectan las gafas (su escaneo de la sala), en coordenadas de la escena. */
function readPlanes(frame: AnyFrame, ref: XRReferenceSpace): ScanPlane[] {
  const out: ScanPlane[] = [];
  frame.detectedPlanes?.forEach((pl: any) => {
    const pose = frame.getPose(pl.planeSpace, ref);
    if (!pose) return;
    const m = new THREE.Matrix4().fromArray(pose.transform.matrix);
    const points = (pl.polygon as DOMPointReadOnly[]).map((p) => {
      const v = new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m);
      return { x: v.x, y: v.y, z: v.z };
    });
    const orientation = pl.orientation === 'horizontal' ? 'horizontal' : 'vertical';
    const label = String(pl.semanticLabel ?? (orientation === 'vertical' ? 'wall' : 'other')).toLowerCase();
    out.push({ label, orientation, points, changed: typeof pl.lastChangedTime === 'number' ? pl.lastChangedTime : undefined });
  });
  return out;
}

/** Líneas que dibujan lo medido (paredes detectadas o esquinas marcadas). */
function makeGuide() {
  const geo = new THREE.BufferGeometry();
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#27ae60', depthTest: false, transparent: true }));
  lines.renderOrder = 997;
  lines.frustumCulled = false;
  const set = (segs: { a: { x: number; z: number }; b: { x: number; z: number } }[], y = 0.02) => {
    const arr: number[] = [];
    for (const g of segs) arr.push(g.a.x, y, g.a.z, g.b.x, y, g.b.z, g.a.x, y, g.a.z, g.a.x, y + 0.5, g.a.z);
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    geo.computeBoundingSphere();
    lines.visible = segs.length > 0;
  };
  return { lines, set };
}

const MANUAL = 'Ve a cada esquina de la sala, apunta al suelo\nen la esquina y pulsa el gatillo. Vuelve a la primera para cerrar';
const fm = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');

export function XRBridge({ root }: { root: React.RefObject<THREE.Group> }) {
  const { gl, scene, camera } = useThree();
  const mode = useXR((s) => s.mode);
  const message = useXR((s) => s.message);
  const points = useRef<THREE.Vector3[]>([]);
  const active = useRef<THREE.Object3D | null>(null);
  const panel = useMemo(makePanel, []);
  const guide = useMemo(makeGuide, []);
  /** Paredes detectadas en la última lectura (para guardar la medición). */
  const scanned = useRef<ScanPlane[]>([]);
  const lastRead = useRef(0);
  const started = useRef(0);
  const anchor = useRef<any>(null);
  const pendingAnchor = useRef(false);
  const fitted = useRef(false);
  const unbounded = useRef<{ base: XRReferenceSpace; floor: XRReferenceSpace; done: boolean } | null>(null);
  const diagDone = useRef(false);
  const btnA = useRef(false);
  const btnB = useRef(false);
  /** Las gafas tienen guardadas más salas además de esta. */
  const otherRooms = useRef(false);
  // Escaneo caminando con el mapa de profundidad de las gafas
  const depth = useMemo(() => makeDepthReader(gl), [gl]);
  const walk = useRef(new WalkScan());
  const walkResult = useRef<WalkOutline | null>(null);
  const lastDepth = useRef(0);
  const lastOutline = useRef(0);
  /** La profundidad no está disponible o no es fiable en estas gafas. */
  const noDepth = useRef(false);
  /** Esta sesión se abrió pidiendo profundidad (y no hubo que reabrirla sin ella). */
  const depthAsked = useRef(false);
  /** Escaneo de la sala lanzado por la app (la propia herramienta de escaneo de las gafas). */
  const capture = useRef<{ state: 'none' | 'running' | 'done' | 'failed'; at: number; started: number }>({ state: 'none', at: 0, started: 0 });
  /** Se ha pedido el escaneo de las gafas (Meta) en esta sesión: solo entonces se leen sus paredes. */
  const useMeta = useRef(false);
  const reticle = useMemo(() => {
    const m = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.09, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#2f80ed', depthTest: false, transparent: true }),
    );
    m.renderOrder = 998;
    m.visible = false;
    return m;
  }, []);

  useEffect(() => {
    gl.xr.enabled = true;
    scene.add(panel.mesh, reticle, guide.lines);
    return () => {
      scene.remove(panel.mesh, reticle, guide.lines);
    };
  }, [gl, scene, panel, reticle, guide]);

  useEffect(() => panel.draw(message), [message, panel]);

  /** Guarda en el proyecto la sala medida con las gafas y deja el modelo encima de la real. */
  const saveScan = (file: ReturnType<typeof planesToRoomPlan>, how: string, obstacles: Obstacle[] = []) => {
    try {
      const r = parseRoomPlan(file);
      const st = useStore.getState();
      st.updateSpace({ width: r.width, depth: r.depth, height: r.height, outline: r.outline, method: 'fotogrametria' });
      // Muebles y obstáculos vistos al escanear, llevados a las coordenadas de la sala
      const fixed = placeObstacles(r.frame, obstacles);
      st.addItems([...r.items.map(({ id: _id, ...it }) => it), ...fixed], ['puerta', 'salida', 'ventana', 'tabique', 'obstaculo']);
      anchor.current = null;
      if (st.project?.measureRequest) st.patchProject({ measureRequest: undefined });
      // El modelo se creó en las coordenadas de la medición: se coloca justo encima.
      root.current?.rotation.set(0, -r.frame.theta, 0);
      root.current?.position.set(r.frame.x, 0, r.frame.z);
      pendingAnchor.current = true;
      guide.set([]);
      points.current = [];
      logEvent('gafas', `sala medida (${how})`);
      useXR.setState({
        task: 'ver',
        step: 2,
        message: `«${useStore.getState().project?.space.name ?? 'Sala'}» guardada: ${fm(r.width)} × ${fm(r.depth)} m, ${fm(r.height)} m de alto${fixed.length ? `, ${fixed.length} muebles u obstáculos` : ''}\nDiséñala en el PC y vuelve a entrar para verla aquí`,
      });
      window.setTimeout(() => useXR.getState().step === 2 && useXR.setState({ message: '' }), 8000);
    } catch (e) {
      useXR.setState({ message: (e as Error).message });
    }
  };

  const hasDepth = () => {
    try {
      return depthAsked.current && !noDepth.current && !!(gl.xr.getSession() as (XRSession & { depthUsage?: string }) | null)?.depthUsage;
    } catch {
      return false;
    }
  };
  /** Empieza (o reinicia) el escaneo caminando. */
  const startWalk = () => {
    walk.current = new WalkScan();
    walkResult.current = null;
    depth.reset();
    points.current = [];
    guide.set([]);
    capture.current = { ...capture.current, state: 'failed', at: performance.now() };
    useXR.setState({ step: 5, message: 'Escaneo caminando: mira un momento al suelo\ny después camina por toda la sala mirando a las paredes' });
  };

  /** Abre el escaneo de la sala de las gafas desde la app (Quest: Configuración del espacio). */
  const startCapture = (): boolean => {
    const sess = gl.xr.getSession() as AnySession | null;
    if (!sess?.initiateRoomCapture) return false;
    useMeta.current = true;
    capture.current = { state: 'running', at: performance.now(), started: performance.now() };
    scanned.current = [];
    guide.set([]);
    useXR.setState({ step: 3, message: 'Las gafas van a escanear la sala: camina por ella\nmirando las paredes, el suelo y el techo' });
    sess.initiateRoomCapture().then(
      () => {
        capture.current = { ...capture.current, state: 'done', at: performance.now() };
        useXR.setState({ message: 'Escaneo terminado. Leyendo las paredes…' });
      },
      () => {
        capture.current = { ...capture.current, state: 'failed', at: performance.now() };
      },
    );
    return true;
  };

  // Mandos (o manos): rayo, punto en el suelo y pulsación (gatillo o pellizco)
  useEffect(() => {
    const ctrls = [0, 1].map((i) => gl.xr.getController(i));
    const rayGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -4)]);
    const rays = ctrls.map((c) => {
      const line = new THREE.Line(rayGeo, new THREE.LineBasicMaterial({ color: '#2f80ed' }));
      c.add(line);
      scene.add(c);
      return line;
    });
    const hit = (c: THREE.Object3D) => {
      c.updateMatrixWorld(true);
      const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
      const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld);
      return new THREE.Ray(origin, dir).intersectPlane(floor, new THREE.Vector3());
    };
    const onSelect = (c: THREE.Object3D) => () => {
      active.current = c;
      const p = hit(c);
      const st = useXR.getState();
      const sp = useStore.getState().project?.space;
      const g = root.current;
      if (!p || !sp || !g) return;
      if (st.mode === 'vr') {
        // Teletransporte: el punto señalado queda bajo los pies
        const head = new THREE.Vector3();
        (gl.xr.isPresenting ? gl.xr.getCamera() : camera).getWorldPosition(head);
        g.position.x += head.x - p.x;
        g.position.z += head.z - p.z;
        return;
      }
      if (st.task === 'medir') {
        if (st.step === 3) {
          // Guardar la sala que han detectado las gafas
          if (scanned.current.some((x) => x.label === 'wall')) saveScan(planesToRoomPlan(scanned.current), 'escaneo de las gafas', planeObstacles(scanned.current));
          return;
        }
        if (st.step === 5) {
          const o = walkResult.current;
          if (o) saveScan(cornersToRoomPlan(o.outline, walk.current.ceiling ?? sp.height), 'escaneo caminando', walk.current.obstacles(o));
          return;
        }
        if (st.step === 4) {
          const pts = points.current;
          const first = pts[0];
          if (pts.length >= 3 && Math.hypot(p.x - first.x, p.z - first.z) < 0.5) {
            const ceiling = scanned.current.find((x) => x.label === 'ceiling');
            const h = ceiling ? ceiling.points.reduce((acc, q) => acc + q.y, 0) / ceiling.points.length : sp.height;
            saveScan(cornersToRoomPlan(pts.map((q) => ({ x: q.x, z: q.z })), h), 'esquinas marcadas con el mando');
            return;
          }
          pts.push(p.clone());
          guide.set(pts.slice(1).map((q, i) => ({ a: pts[i], b: q })));
          useXR.setState({
            message: `${pts.length} esquinas · ${fm(pts.slice(1).reduce((acc, q, i) => acc + q.distanceTo(pts[i]), 0))} m de pared\n${pts.length >= 3 ? 'Vuelve a la primera esquina para cerrar la sala' : 'Marca la siguiente esquina'}`,
          });
          return;
        }
      }
      if (st.step === 0 || st.step === 2) {
        anchor.current = null;
        fitted.current = true;
        points.current = [p];
        useXR.setState({ step: 1, message: 'Ahora la esquina del FRENTE DERECHA\n(apunta al suelo y pulsa)' });
        return;
      }
      points.current.push(p);
      const [a, b] = frontCorners(sp);
      const [A, B] = points.current;
      const t = alignFromCorners(a, b, { x: A.x, z: A.z }, { x: B.x, z: B.z });
      g.rotation.set(0, t.rot, 0);
      g.position.set(t.x, 0, t.z);
      pendingAnchor.current = true;
      const cm = Math.round(t.mismatch * 100);
      useXR.setState({
        step: 2,
        message: Math.abs(cm) <= 5 ? 'Montaje alineado con la sala' : `Alineado. La sala real mide ${Math.abs(cm)} cm ${cm > 0 ? 'más' : 'menos'}\nque en la app: revisa las medidas`,
      });
      window.setTimeout(() => useXR.getState().step === 2 && useXR.setState({ message: '' }), 6000);
    };
    const handlers = ctrls.map((c) => {
      const h = onSelect(c);
      c.addEventListener('select', h);
      return h;
    });
    // Botón lateral (agarre): volver a escanear la sala
    const onSqueeze = () => {
      if (useXR.getState().task !== 'medir') return;
      points.current = [];
      if (!startCapture()) useXR.setState({ message: 'Este navegador no permite abrir el escaneo de la sala.\nMarca las esquinas con el gatillo' });
    };
    ctrls.forEach((c) => c.addEventListener('squeeze', onSqueeze));
    return () => {
      ctrls.forEach((c, i) => {
        c.removeEventListener('squeeze', onSqueeze);
        c.removeEventListener('select', handlers[i]);
        c.remove(rays[i]);
        scene.remove(c);
      });
    };
  }, [gl, scene, camera, root, guide]);

  // Abrir y cerrar la sesión de las gafas
  useEffect(() => {
    sceneApi.enterXR = async (m: XrMode, task: 'ver' | 'medir' = 'ver') => {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) throw new Error('Este navegador no admite gafas de realidad virtual o mixta.');
      // plane-detection: el escaneo de la sala de las gafas; anchors: recordar la posición;
      // depth-sensing (solo al medir): mapa de profundidad para el escaneo caminando.
      // La profundidad solo se pide donde el navegador usa capas WebXR (Quest): sin ellas, la
      // biblioteca 3D falla al leerla.
      const XRB = (window as unknown as { XRWebGLBinding?: { prototype: object } }).XRWebGLBinding;
      const measuring = m === 'ar' && task === 'medir' && !!XRB && 'createProjectionLayer' in XRB.prototype;
      const init = {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking', 'bounded-floor', 'plane-detection', 'anchors', ...(m === 'ar' ? ['unbounded'] : []), ...(measuring ? ['depth-sensing'] : [])],
        ...(measuring ? { depthSensing: DEPTH_INIT } : {}),
      };
      const kind = m === 'ar' ? 'immersive-ar' : 'immersive-vr';
      let session = await xr.requestSession(kind, init as XRSessionInit);
      // Profundidad concedida pero sin capas WebXR: la biblioteca 3D fallaría en cada
      // fotograma. Se vuelve a abrir la sesión sin profundidad.
      if (measuring && session.enabledFeatures?.includes('depth-sensing') && session.renderState.layers === undefined) {
        await session.end();
        session = await xr.requestSession(kind, { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'bounded-floor', 'plane-detection', 'anchors', 'unbounded'] });
        depthAsked.current = false;
      } else depthAsked.current = measuring;
      gl.xr.setReferenceSpaceType('local-floor');
      // Algo más de resolución que la nativa (bordes más nítidos, sobre todo en Quest 3S)
      // y renderizado foveado para compensar el coste en la periferia de la vista.
      gl.xr.setFramebufferScaleFactor(1.2);
      gl.xr.setFoveation(0.6);
      await gl.xr.setSession(session);
      // Sin límite de zona de juego: en realidad mixta se pide el espacio «unbounded» para poder
      // caminar por toda la sala (con el espacio normal, al salir del círculo de seguridad de
      // las gafas la app deja de verse). Su origen no está en el suelo: se corrige en el
      // primer fotograma comparándolo con el espacio de suelo.
      unbounded.current = null;
      if (m === 'ar') {
        try {
          unbounded.current = { base: await session.requestReferenceSpace('unbounded'), floor: await session.requestReferenceSpace('local-floor'), done: false };
        } catch {
          unbounded.current = null;
        }
      }
      started.current = performance.now();
      fitted.current = false;
      capture.current = { state: 'none', at: 0, started: 0 };
      useMeta.current = false;
      noDepth.current = false;
      walkResult.current = null;
      diagDone.current = false;
      anchor.current = null;
      scanned.current = [];
      useXR.setState({
        mode: m,
        task: m === 'ar' ? task : 'ver',
        step: m !== 'ar' ? 2 : task === 'medir' ? 3 : 0,
        message:
          m !== 'ar'
            ? 'Camina por la sala o apunta al suelo\ny pulsa el gatillo para moverte'
            : task === 'medir'
              ? 'Leyendo el escaneo de la sala de las gafas…'
              : 'Buscando la sala…',
      });
      // Volver a la posición que se guardó en estas gafas la última vez
      const pid = useStore.getState().project?.id;
      const uuid = pid && m === 'ar' && task === 'ver' ? savedAnchor(pid) : null;
      const sess = session as AnySession;
      if (uuid && sess.restorePersistentAnchor)
        sess.restorePersistentAnchor(uuid).then(
          (a) => {
            anchor.current = a;
            fitted.current = true;
            useXR.setState({ step: 2, message: 'Montaje colocado donde lo dejaste' });
            window.setTimeout(() => useXR.getState().step === 2 && useXR.setState({ message: '' }), 4000);
          },
          () => pid && saveAnchor(pid, null),
        );
      if (m === 'vr') window.setTimeout(() => useXR.getState().mode === 'vr' && useXR.setState({ message: '' }), 7000);
      session.addEventListener('end', () => {
        root.current?.position.set(0, 0, 0);
        root.current?.rotation.set(0, 0, 0);
        points.current = [];
        anchor.current = null;
        unbounded.current = null;
        guide.set([]);
        if (root.current) root.current.visible = true;
        useXR.setState({ mode: null, task: 'ver', step: 0, message: '' });
      });
    };
    return () => {
      sceneApi.enterXR = undefined;
    };
  }, [gl, root, guide]);

  useFrame((_, __, xrFrame) => {
    if (!mode) return;
    const frame = xrFrame as AnyFrame | undefined;
    // Paso al espacio sin límites, con el origen llevado al suelo y a la misma posición y
    // orientación que el espacio normal (para que nada salte de sitio)
    const ub = unbounded.current;
    if (frame && ub && !ub.done) {
      const off = frame.getPose(ub.floor, ub.base);
      if (off) {
        ub.done = true;
        gl.xr.setReferenceSpace(ub.base.getOffsetReferenceSpace(off.transform));
      }
    }
    const ref = gl.xr.getReferenceSpace();
    // Diagnóstico (una vez, a los 4 s de empezar a medir): qué dan estas gafas. Se guarda en el
    // proyecto para poder revisar a distancia por qué un modo de medición no arranca.
    if (frame && mode === 'ar' && !diagDone.current && useXR.getState().task === 'medir' && performance.now() - started.current > 4000) {
      diagDone.current = true;
      const sess = frame.session as XRSession & { depthUsage?: string; depthDataFormat?: string };
      const tryGet = (f: () => unknown) => {
        try {
          return f() ?? null;
        } catch (e) {
          return `error: ${(e as Error).name}`;
        }
      };
      const XRB = (window as unknown as { XRWebGLBinding?: { prototype: object } }).XRWebGLBinding;
      const labels: Record<string, number> = {};
      const all = ref ? readPlanes(frame, ref) : [];
      all.forEach((x) => (labels[`${x.orientation[0]}:${x.label}`] = (labels[`${x.orientation[0]}:${x.label}`] ?? 0) + 1));
      const info = {
        cuando: new Date().toISOString(),
        navegador: navigator.userAgent,
        funciones: tryGet(() => sess.enabledFeatures),
        capas: tryGet(() => sess.renderState.layers !== undefined),
        binding: !!XRB,
        bindingCapas: !!XRB && 'createProjectionLayer' in XRB.prototype,
        profundidadPedida: depthAsked.current,
        profundidadUso: tryGet(() => sess.depthUsage),
        profundidadFormato: tryGet(() => sess.depthDataFormat),
        profundidadLectura: depth.mode ?? (depth.error || 'sin calibrar'),
        sinLimites: !!unbounded.current?.done,
        planos: labels,
        planosConFecha: all.some((x) => x.changed !== undefined),
        mallas: tryGet(() => (frame as unknown as { detectedMeshes?: Set<unknown> }).detectedMeshes?.size),
        paso: useXR.getState().step,
      };
      const stt = useStore.getState();
      if (stt.project && !stt.readOnly) stt.patchProject({ xrInfo: info });
    }
    const g = root.current;
    const st = useXR.getState();
    const now = performance.now();
    // Mientras se mide, el montaje actual se oculta para ver bien la sala real
    if (g) g.visible = !(mode === 'ar' && st.task === 'medir');
    // Botón A o X durante la medición: pasar a marcar las esquinas caminando
    if (mode === 'ar' && st.task === 'medir') {
      let pressed = false;
      let pressedB = false;
      gl.xr.getSession()?.inputSources.forEach((src) => {
        if (src.gamepad?.buttons[4]?.pressed) pressed = true;
        if (src.gamepad?.buttons[5]?.pressed) pressedB = true;
      });
      if (pressed && !btnA.current && (st.step === 3 || st.step === 5)) {
        points.current = [];
        guide.set([]);
        capture.current = { ...capture.current, state: 'failed', at: now };
        useXR.setState({ step: 4, message: MANUAL });
      }
      btnA.current = pressed;
      // Botón B o Y: escaneo caminando
      if (pressedB && !btnB.current && st.step !== 5) {
        if (hasDepth()) startWalk();
        else useXR.setState({ message: 'Estas gafas o este navegador no dan el mapa de profundidad:\nusa el escaneo de las gafas (botón lateral) o marca las esquinas (A o X)' });
      }
      btnB.current = pressedB;
    }
    if (frame && ref && g && mode === 'ar') {
      // Anclaje guardado: el montaje sigue su posición (las gafas la corrigen con el tiempo)
      if (anchor.current) {
        const pose = frame.getPose(anchor.current.anchorSpace, ref);
        if (pose) {
          const mtx = new THREE.Matrix4().fromArray(pose.transform.matrix);
          mtx.decompose(g.position, g.quaternion, g.scale);
        }
      }
      if (st.task === 'medir' && st.step === 5) depth.track(frame, ref);
      // Escaneo caminando: muestras de profundidad varias veces por segundo
      if (st.task === 'medir' && st.step === 5 && now - lastDepth.current > 120) {
        lastDepth.current = now;
        const r = depth.read(frame, ref);
        if (!r || depth.error) {
          // Sin profundidad utilizable: se pasa a marcar las esquinas (lo que siempre funciona)
          noDepth.current = true;
          capture.current = { ...capture.current, state: 'failed', at: now };
          points.current = [];
          guide.set([]);
          useXR.setState({ step: 4, message: `${depth.error || 'Estas gafas no dan el mapa de profundidad al navegador'}\n${MANUAL}\nBotón lateral: usar el escaneo de las gafas` });
        } else {
          if (r.pts.length) walk.current.addFrame(r.head, r.pts);
          if (now - lastOutline.current > 1000) {
            lastOutline.current = now;
            const o = depth.mode ? walk.current.outline() : null;
            walkResult.current = o;
            const obs = o ? walk.current.obstacles(o) : [];
            const boxes = obs.flatMap((b) => {
              const t = (b.rot * Math.PI) / 180;
              const cs = [
                [-b.w / 2, -b.d / 2],
                [b.w / 2, -b.d / 2],
                [b.w / 2, b.d / 2],
                [-b.w / 2, b.d / 2],
              ].map(([lx, lz]) => ({ x: b.x + lx * Math.cos(t) + lz * Math.sin(t), z: b.z - lx * Math.sin(t) + lz * Math.cos(t) }));
              return cs.map((a, i) => ({ a, b: cs[(i + 1) % 4] }));
            });
            guide.set(o ? [...o.outline.map((a, i) => ({ a, b: o.outline[(i + 1) % o.outline.length] })), ...boxes] : []);
            const h = walk.current.ceiling;
            useXR.setState({
              message: !depth.mode
                ? 'Escaneo caminando: mira un momento al suelo\ny después camina por toda la sala mirando a las paredes'
                : o
                  ? `Sala vista: ${fm(o.area)} m²${h ? `, techo a ${fm(h)} m` : ''}${obs.length ? `, ${obs.length} muebles` : ''}. Sigue caminando hasta que la línea verde\nrodee toda la sala. Gatillo: guardar · Botón lateral: escaneo de las gafas · A o X: esquinas`
                  : `Camina por la sala mirando a las paredes (${fm(walk.current.seenArea)} m² vistos)\nLa línea verde aparecerá al ver paredes suficientes`,
            });
          }
        }
      }
      // Leer el escaneo de las gafas una vez por segundo
      if (now - lastRead.current > 1000 && (st.task === 'medir' || !fitted.current)) {
        lastRead.current = now;
        // Solo la sala en la que se está (las gafas guardan también las contiguas)
        const hp = frame.getViewerPose(ref)?.transform.position;
        let all = readPlanes(frame, ref);
        // Al medir, con escaneo caminando disponible no se usan las salas que las gafas tuvieran
        // guardadas de antes; sin él, se aprovecha la de la habitación en la que se está. Tras
        // pedir el escaneo de las gafas (botón lateral) solo cuenta lo creado en ese escaneo.
        if (st.task === 'medir') {
          if (!useMeta.current) {
            if (hasDepth()) all = [];
          } else {
            const fresh = all.filter((x) => (x.changed ?? 0) >= capture.current.started - 500);
            if (fresh.some((x) => x.label === 'wall')) all = fresh;
          }
        }
        const planes = hp ? currentRoomPlanes(all, { x: hp.x, z: hp.z }) : all;
        otherRooms.current = all.filter((x) => x.label === 'wall').length > planes.filter((x) => x.label === 'wall').length;
        if (planes.length || st.task === 'medir') scanned.current = planes;
        const segs = wallSegments(scanned.current);
        const waited = now - started.current;
        if (st.task === 'medir' && st.step === 3) {
          // Muebles anotados por las gafas, como recuadros dentro de la sala
          const furn = planeObstacles(scanned.current);
          const boxes = furn.flatMap((b) => {
            const t = (b.rot * Math.PI) / 180;
            const cs = [
              [-b.w / 2, -b.d / 2],
              [b.w / 2, -b.d / 2],
              [b.w / 2, b.d / 2],
              [-b.w / 2, b.d / 2],
            ].map(([lx, lz]) => ({ x: b.x + lx * Math.cos(t) + lz * Math.sin(t), z: b.z - lx * Math.sin(t) + lz * Math.cos(t) }));
            return cs.map((a, i) => ({ a, b: cs[(i + 1) % 4] }));
          });
          guide.set([...segs, ...boxes]);
          if (segs.length) {
            const r = parseRoomPlan(planesToRoomPlan(scanned.current));
            useXR.setState({
              message: `${otherRooms.current ? 'Sala escaneada (solo esta, sin las contiguas)' : 'Sala escaneada por las gafas'}: ${fm(r.width)} × ${fm(r.depth)} m, ${segs.length} paredes${furn.length ? `, ${furn.length} muebles` : ''}. Gatillo: guardarla\nBotón B o Y: escanear caminando · Botón lateral: repetir el escaneo de las gafas\nBotón A o X: marcar las esquinas a mano`,
            });
          } else {
            // Sin escaneo: las gafas lo hacen ahora; si no pueden, se marcan las esquinas a mano.
            const cap = capture.current;
            const manual = () => {
              points.current = [];
              useXR.setState({
                step: 4,
                message: MANUAL,
              });
            };
            if (cap.state === 'none' && waited > 1500) {
              // Preferencia: escaneo caminando (profundidad); si no, marcar las esquinas. El escaneo
              // de las gafas (Meta) no se abre solo: falla a menudo y se hace desde un punto.
              if (hasDepth()) startWalk();
              else {
                points.current = [];
                capture.current = { ...capture.current, state: 'failed', at: now };
                useXR.setState({ step: 4, message: `Sin mapa de profundidad en este navegador: mide marcando las esquinas\n${MANUAL}\nBotón lateral: usar el escaneo de las gafas` });
              }
            } else if (cap.state === 'failed' || (cap.state === 'done' && now - cap.at > 5000)) {
              // El escaneo de las gafas ha fallado o se ha cancelado
              if (hasDepth()) startWalk();
              else manual();
            }
          }
        } else if (st.task === 'ver' && !fitted.current && st.step === 0) {
          const sp = useStore.getState().project?.space;
          const items = useStore.getState().project?.items ?? [];
          if (sp && segs.length >= 2) {
            const doorsWorld = scanned.current
              .filter((x) => x.label === 'door')
              .map((x) => ({ x: x.points.reduce((acc, q) => acc + q.x, 0) / x.points.length, z: x.points.reduce((acc, q) => acc + q.z, 0) / x.points.length }));
            const doorsModel = items.filter((i) => i.type === 'puerta' || i.type === 'salida').map((i) => ({ x: i.x, z: i.z }));
            const fit = fitModelToWalls(sp, segs, { model: doorsModel, world: doorsWorld });
            if (fit && fit.error < 0.25 && !fit.ambiguous) {
              fitted.current = true;
              g.rotation.set(0, fit.rot, 0);
              g.position.set(fit.x, 0, fit.z);
              pendingAnchor.current = true;
              useXR.setState({
                step: 2,
                message: `Montaje encajado con las paredes (±${Math.max(1, Math.round(fit.error * 100))} cm)\nSi no cuadra, marca las esquinas: pulsa el gatillo`,
              });
              window.setTimeout(() => useXR.getState().step === 2 && useXR.setState({ message: '' }), 6000);
            }
          }
          if (!fitted.current && waited > 2500) {
            fitted.current = true;
            useXR.setState({ message: 'Ve a la esquina del FRENTE IZQUIERDA de la sala,\napunta al suelo en la esquina y pulsa el gatillo' });
          }
        }
      }
      // Guardar en las gafas dónde ha quedado la sala para la próxima vez
      if (pendingAnchor.current && frame.createAnchor) {
        pendingAnchor.current = false;
        g.updateMatrixWorld(true);
        const q = new THREE.Quaternion().setFromEuler(g.rotation);
        const pose = new XRRigidTransform({ x: g.position.x, y: 0, z: g.position.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
        const pid = useStore.getState().project?.id;
        const sess = gl.xr.getSession() as AnySession | null;
        frame
          .createAnchor(pose, ref)
          .then(async (a: any) => {
            const old = pid ? savedAnchor(pid) : null;
            if (old) await sess?.deletePersistentAnchor?.(old).catch(() => undefined);
            anchor.current = a;
            const uuid = a.requestPersistentHandle ? await a.requestPersistentHandle() : null;
            if (pid) saveAnchor(pid, uuid);
          })
          .catch(() => undefined);
      }
    }
    // Punto de mira en el suelo del último mando usado
    const c = active.current ?? gl.xr.getController(1);
    c.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld);
    const p = new THREE.Ray(origin, dir).intersectPlane(floor, new THREE.Vector3());
    reticle.visible = !!p && (mode === 'vr' || st.step !== 2);
    if (p) reticle.position.copy(p).setY(0.005);
    // El panel sigue la mirada a 1,2 m, algo por debajo de los ojos
    if (panel.mesh.visible) {
      const head = new THREE.Vector3();
      const fwd = new THREE.Vector3();
      (gl.xr.isPresenting ? gl.xr.getCamera() : camera).getWorldPosition(head);
      (gl.xr.isPresenting ? gl.xr.getCamera() : camera).getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const target = head.clone().addScaledVector(fwd, 1.2).setY(head.y - 0.15);
      panel.mesh.position.lerp(target, 0.15);
      panel.mesh.lookAt(head);
    }
  });

  return null;
}
