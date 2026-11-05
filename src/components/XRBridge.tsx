// Modo gafas (WebXR): realidad mixta sobre la sala vacía y realidad virtual del gemelo digital.
//  · Realidad mixta: se ve la sala real y encima el montaje. Se alinea marcando con el mando
//    (o pellizcando con la mano) las dos esquinas del frente de la sala.
//  · Realidad virtual: el gemelo completo; se camina o se teletransporta apuntando al suelo.

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { alignFromCorners, frontCorners, useXR, type XrMode } from '../lib/xr';
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
      ctx.font = '600 44px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lines = text.split('\n');
      lines.forEach((l, i) => ctx.fillText(l, 512, 128 + (i - (lines.length - 1) / 2) * 56));
    }
    tex.needsUpdate = true;
    mesh.visible = !!text;
  };
  return { mesh, draw };
}

export function XRBridge({ root }: { root: React.RefObject<THREE.Group> }) {
  const { gl, scene, camera } = useThree();
  const mode = useXR((s) => s.mode);
  const message = useXR((s) => s.message);
  const points = useRef<THREE.Vector3[]>([]);
  const active = useRef<THREE.Object3D | null>(null);
  const panel = useMemo(makePanel, []);
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
    scene.add(panel.mesh, reticle);
    return () => {
      scene.remove(panel.mesh, reticle);
    };
  }, [gl, scene, panel, reticle]);

  useEffect(() => panel.draw(message), [message, panel]);

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
        camera.getWorldPosition(head);
        g.position.x += head.x - p.x;
        g.position.z += head.z - p.z;
        return;
      }
      if (st.step === 0 || st.step === 2) {
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
    return () => {
      ctrls.forEach((c, i) => {
        c.removeEventListener('select', handlers[i]);
        c.remove(rays[i]);
        scene.remove(c);
      });
    };
  }, [gl, scene, camera, root]);

  // Abrir y cerrar la sesión de las gafas
  useEffect(() => {
    sceneApi.enterXR = async (m: XrMode) => {
      const xr = (navigator as Navigator & { xr?: XRSystem }).xr;
      if (!xr) throw new Error('Este navegador no admite gafas de realidad virtual o mixta.');
      const session = await xr.requestSession(m === 'ar' ? 'immersive-ar' : 'immersive-vr', {
        requiredFeatures: ['local-floor'],
        optionalFeatures: ['hand-tracking', 'bounded-floor'],
      });
      gl.xr.setReferenceSpaceType('local-floor');
      await gl.xr.setSession(session);
      useXR.setState({
        mode: m,
        step: m === 'ar' ? 0 : 2,
        message:
          m === 'ar'
            ? 'Ve a la esquina del FRENTE IZQUIERDA de la sala,\napunta al suelo en la esquina y pulsa el gatillo'
            : 'Camina por la sala o apunta al suelo\ny pulsa el gatillo para moverte',
      });
      if (m === 'vr') window.setTimeout(() => useXR.getState().mode === 'vr' && useXR.setState({ message: '' }), 7000);
      session.addEventListener('end', () => {
        root.current?.position.set(0, 0, 0);
        root.current?.rotation.set(0, 0, 0);
        points.current = [];
        useXR.setState({ mode: null, step: 0, message: '' });
      });
    };
    return () => {
      sceneApi.enterXR = undefined;
    };
  }, [gl, root]);

  useFrame(() => {
    if (!mode) return;
    // Punto de mira en el suelo del último mando usado
    const c = active.current ?? gl.xr.getController(1);
    c.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld);
    const p = new THREE.Ray(origin, dir).intersectPlane(floor, new THREE.Vector3());
    reticle.visible = !!p && (mode === 'vr' || useXR.getState().step < 2);
    if (p) reticle.position.copy(p).setY(0.005);
    // El panel sigue la mirada a 1,2 m, algo por debajo de los ojos
    if (panel.mesh.visible) {
      const head = new THREE.Vector3();
      const fwd = new THREE.Vector3();
      camera.getWorldPosition(head);
      camera.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      const target = head.clone().addScaledVector(fwd, 1.2).setY(head.y - 0.15);
      panel.mesh.position.lerp(target, 0.15);
      panel.mesh.lookAt(head);
    }
  });

  return null;
}
