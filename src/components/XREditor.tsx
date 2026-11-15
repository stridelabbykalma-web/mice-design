// Editar el montaje desde las gafas, en realidad mixta, con la sala ya alineada:
//  · A o X abre la paleta (en el mando izquierdo): se apunta con el derecho y gatillo para
//    añadir una mesa, una silla, un escenario… que aparece en el rayo para colocarla.
//  · Gatillo sobre un mueble: se coge y sigue al rayo por el suelo; gatillo otra vez: se suelta.
//  · Mientras se lleva: joystick a izquierda o derecha gira 15°; B o Y lo borra.
//  · En la paleta: deshacer, recolocar la sala (volver a marcar las esquinas) y cerrar.
// Los cambios van al proyecto como los del PC (deshacer, guardado y sincronización).

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { findDef } from '../catalog';
import { useXR } from '../lib/xr';
import { itemAt, menuTile, MENU_COLS, MENU_ROWS, XR_ACTIONS, XR_PALETTE } from '../lib/xrEdit';
import { logEvent } from '../lib/usageLog';

const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const HINT = 'Gatillo sobre un mueble: cogerlo y moverlo\nA o X: paleta para añadir mesas, sillas, escenario…';

function makeMenu() {
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 600;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.18), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 1000;
  mesh.visible = false;
  let last = '';
  const draw = (hover: string) => {
    if (hover === last) return;
    last = hover;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1000, 600);
    ctx.fillStyle = 'rgba(15, 30, 50, 0.92)';
    ctx.beginPath();
    ctx.roundRect(0, 0, 1000, 600, 36);
    ctx.fill();
    const cw = 1000 / MENU_COLS;
    const rh = 600 / MENU_ROWS;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    XR_PALETTE.forEach((p, i) => {
      const x = (i % MENU_COLS) * cw;
      const y = Math.floor(i / MENU_COLS) * rh;
      ctx.fillStyle = hover === `i${i}` ? '#2f80ed' : 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 10, cw - 20, rh - 20, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 34px system-ui, sans-serif';
      ctx.fillText(p.label, x + cw / 2, y + rh / 2);
    });
    const aw = 1000 / XR_ACTIONS.length;
    XR_ACTIONS.forEach((a, i) => {
      const x = i * aw;
      const y = 2 * rh;
      ctx.fillStyle = hover === `a${a.id}` ? '#2f80ed' : 'rgba(255,255,255,0.22)';
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 10, aw - 20, rh - 20, 22);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.fillText(a.label, x + aw / 2, y + rh / 2);
    });
    tex.needsUpdate = true;
  };
  draw('-');
  return { mesh, draw };
}

interface Carry {
  id: string;
  /** Controlador que lo lleva (índice de gl.xr.getController). */
  hand: number;
  /** Desde dónde se cogió (para no acumular errores) y posiciones de partida de lo que va con él. */
  grab: { x: number; z: number };
  start: Record<string, { x: number; z: number; rot: number }>;
  last: number;
}

export function XREditor({ root }: { root: React.RefObject<THREE.Group> }) {
  const { gl, scene, camera } = useThree();
  const mode = useXR((s) => s.mode);
  const menu = useMemo(makeMenu, []);
  const hands = useRef<Record<number, string>>({});
  const carry = useRef<Carry | null>(null);
  const menuOpen = useRef(false);
  const prevA = useRef(false);
  const prevB = useRef(false);
  const prevStick = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);

  const active = () => {
    const st = useXR.getState();
    const s = useStore.getState();
    return st.mode === 'ar' && st.task === 'ver' && st.step === 2 && !!s.project && !s.readOnly;
  };

  const controllerRay = (i: number) => {
    const c = gl.xr.getController(i);
    c.updateMatrixWorld(true);
    const origin = new THREE.Vector3().setFromMatrixPosition(c.matrixWorld);
    const dir = new THREE.Vector3(0, 0, -1).transformDirection(c.matrixWorld);
    return new THREE.Ray(origin, dir);
  };
  /** Punto del suelo al que apunta el mando i, en coordenadas de la sala. */
  const floorPoint = (i: number) => {
    const p = controllerRay(i).intersectPlane(floor, new THREE.Vector3());
    if (!p || !root.current) return null;
    root.current.updateMatrixWorld(true);
    return root.current.worldToLocal(p.clone());
  };
  const menuHit = (i: number) => {
    if (!menu.mesh.visible) return null;
    const r = controllerRay(i);
    ray.set(r.origin, r.direction);
    const h = ray.intersectObject(menu.mesh, false)[0];
    return h?.uv ? menuTile(h.uv.x, h.uv.y) : null;
  };

  const say = (message: string) => useXR.setState({ message });

  const startCarry = (id: string, hand: number, grab: { x: number; z: number }) => {
    const s = useStore.getState();
    const ids = s.withDecor([id]);
    const start: Carry['start'] = {};
    for (const it of s.project!.items) if (ids.includes(it.id)) start[it.id] = { x: it.x, z: it.z, rot: it.rot };
    carry.current = { id, hand, grab, start, last: 0 };
    const it = s.project!.items.find((x) => x.id === id);
    const name = it?.label ?? findDef(it?.type ?? '', s.project!.customCatalog)?.name ?? 'Mueble';
    say(`${name}: apunta donde quieras y gatillo para soltar\nJoystick: girar 15° · B o Y: borrar`);
  };

  /** Mueve (y gira) lo que se lleva: el mueble y lo que tiene encima, como un bloque. */
  const applyCarry = (to: { x: number; z: number }, dRot = 0) => {
    const c = carry.current;
    if (!c) return;
    const main = c.start[c.id];
    if (dRot) {
      // Girar alrededor del mueble: también giran sus sillas, cubiertos y centros
      const a = (dRot * Math.PI) / 180;
      for (const [id, p] of Object.entries(c.start)) {
        const dx = p.x - main.x;
        const dz = p.z - main.z;
        c.start[id] = { x: main.x + dx * Math.cos(a) + dz * Math.sin(a), z: main.z - dx * Math.sin(a) + dz * Math.cos(a), rot: p.rot + dRot };
      }
    }
    const mx = to.x - c.grab.x;
    const mz = to.z - c.grab.z;
    const r2 = (v: number) => Math.round(v * 100) / 100;
    useStore.getState().updateItems(Object.keys(c.start), (it) => {
      const p = c.start[it.id];
      return { x: r2(p.x + mx), z: r2(p.z + mz), rot: ((Math.round(p.rot) % 360) + 360) % 360 };
    }, false);
  };

  const openMenu = (open: boolean) => {
    menuOpen.current = open;
    menu.mesh.visible = open;
    // En el mando izquierdo si lo hay; si no (manos), delante de la vista
    const left = [0, 1].find((i) => hands.current[i] === 'left');
    menu.mesh.removeFromParent();
    if (!open) return;
    if (left !== undefined) {
      const c = gl.xr.getController(left);
      c.add(menu.mesh);
      menu.mesh.position.set(0, 0.07, -0.12);
      menu.mesh.rotation.set(-0.9, 0, 0);
    } else {
      scene.add(menu.mesh);
      const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
      const head = new THREE.Vector3();
      const fwd = new THREE.Vector3();
      cam.getWorldPosition(head);
      cam.getWorldDirection(fwd);
      fwd.y = 0;
      fwd.normalize();
      menu.mesh.position.copy(head).addScaledVector(fwd, 0.55).setY(head.y - 0.25);
      menu.mesh.lookAt(head);
    }
    say('Apunta a la paleta con el otro mando y pulsa el gatillo');
  };

  useEffect(() => {
    const ctrls = [0, 1].map((i) => gl.xr.getController(i));
    const onConn = (i: number) => (e: { data?: XRInputSource }) => {
      hands.current[i] = e.data?.handedness ?? 'none';
    };
    const onDisc = (i: number) => () => {
      delete hands.current[i];
    };
    const onSelect = (i: number) => () => {
      if (!active()) return;
      const s = useStore.getState();
      // 1. Paleta abierta: lo que se señala en ella
      if (menuOpen.current) {
        const t = menuHit(i);
        if (!t) return;
        if (t.kind === 'action') {
          if (t.id === 'deshacer') s.undo();
          if (t.id === 'cerrar') {
            openMenu(false);
            say(HINT);
          }
          if (t.id === 'recolocar') {
            openMenu(false);
            useXR.setState({ step: 0, message: 'Ve a la esquina del FRENTE IZQUIERDA de la sala,\napunta al suelo en la esquina y pulsa el gatillo' });
          }
          return;
        }
        // Mueble nuevo: aparece delante, a 1,5 m, y se lleva con este mando
        const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
        const head = new THREE.Vector3();
        const fwd = new THREE.Vector3();
        cam.getWorldPosition(head);
        cam.getWorldDirection(fwd);
        fwd.y = 0;
        fwd.normalize();
        const w = head.clone().addScaledVector(fwd, 1.5).setY(0);
        root.current!.updateMatrixWorld(true);
        const at = root.current!.worldToLocal(w);
        const type = XR_PALETTE[t.index].type;
        const id = s.addItem({ type, x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100, rot: 0 });
        logEvent('gafas', `añadido desde las gafas: ${type}`);
        openMenu(false);
        startCarry(id, i, { x: at.x, z: at.z });
        // Que salte al rayo desde el primer momento
        const p = floorPoint(i);
        if (p) applyCarry({ x: p.x, z: p.z });
        return;
      }
      // 2. Llevando algo: soltarlo aquí
      if (carry.current) {
        const p = floorPoint(carry.current.hand);
        if (p) applyCarry({ x: p.x, z: p.z });
        carry.current = null;
        logEvent('gafas', 'mueble movido desde las gafas');
        say(HINT);
        window.setTimeout(() => !carry.current && !menuOpen.current && useXR.getState().message === HINT && say(''), 6000);
        return;
      }
      // 3. Coger el mueble al que se apunta
      const p = floorPoint(i);
      if (!p) return;
      const it = itemAt(s.project!.items, s.project!.customCatalog, p.x, p.z);
      if (!it) {
        say(HINT);
        return;
      }
      s.checkpoint();
      startCarry(it.id, i, { x: p.x, z: p.z });
    };
    const handlers = ctrls.map((c, i) => {
      const h = { conn: onConn(i), disc: onDisc(i), sel: onSelect(i) };
      c.addEventListener('connected', h.conn as never);
      c.addEventListener('disconnected', h.disc as never);
      c.addEventListener('select', h.sel);
      return h;
    });
    return () => {
      ctrls.forEach((c, i) => {
        c.removeEventListener('connected', handlers[i].conn as never);
        c.removeEventListener('disconnected', handlers[i].disc as never);
        c.removeEventListener('select', handlers[i].sel);
      });
      menu.mesh.removeFromParent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, menu]);

  useFrame(() => {
    if (!mode) {
      if (useXR.getState().editing) useXR.setState({ editing: false });
      return;
    }
    const on = active();
    if (on !== useXR.getState().editing) {
      useXR.setState({ editing: on });
      // Primero se deja leer el mensaje de la alineación; después, cómo editar
      if (on) window.setTimeout(() => active() && !carry.current && !menuOpen.current && !useXR.getState().message && say(HINT), 6500);
    }
    if (!on) {
      if (menuOpen.current) openMenu(false);
      carry.current = null;
      // Gafas emparejadas solo para ver: avisar de por qué no se abre la paleta
      const st = useXR.getState();
      if (st.mode === 'ar' && st.task === 'ver' && st.step === 2 && useStore.getState().readOnly) {
        let a = false;
        gl.xr.getSession()?.inputSources.forEach((src) => src.gamepad?.buttons[4]?.pressed && (a = true));
        if (a && !prevA.current) say('Estas gafas solo pueden ver el montaje.\nPara editar desde aquí, entra en las gafas con tu cuenta del hotel');
        prevA.current = a;
      }
      return;
    }
    // Botones de los mandos: A/X paleta, B/Y borrar lo que se lleva, joystick girar
    let a = false;
    let b = false;
    let stick = 0;
    gl.xr.getSession()?.inputSources.forEach((src) => {
      const g = src.gamepad;
      if (!g) return;
      if (g.buttons[4]?.pressed) a = true;
      if (g.buttons[5]?.pressed) b = true;
      const x = g.axes[2] ?? 0;
      if (Math.abs(x) > Math.abs(stick)) stick = x;
    });
    if (a && !prevA.current && !carry.current) openMenu(!menuOpen.current);
    prevA.current = a;
    if (b && !prevB.current && carry.current) {
      useStore.getState().removeItems([carry.current.id]);
      carry.current = null;
      logEvent('gafas', 'mueble borrado desde las gafas');
      say('Borrado. ' + HINT);
    }
    prevB.current = b;
    const dir = stick > 0.7 ? 1 : stick < -0.7 ? -1 : 0;
    const c = carry.current;
    if (c) {
      const p = floorPoint(c.hand);
      const now = performance.now();
      if (dir && dir !== prevStick.current && p) {
        applyCarry({ x: p.x, z: p.z }, -15 * dir);
        c.last = now;
      } else if (p && now - c.last > 60) {
        c.last = now;
        applyCarry({ x: p.x, z: p.z });
      }
    }
    prevStick.current = dir;
    // Resaltar la casilla de la paleta que se señala
    if (menuOpen.current) {
      let hover = '';
      for (const i of [0, 1]) {
        if (hands.current[i] === 'left' && Object.keys(hands.current).length > 1) continue;
        const t = menuHit(i);
        if (t) hover = t.kind === 'item' ? `i${t.index}` : `a${t.id}`;
      }
      menu.draw(hover);
    }
  });

  return null;
}
