// Editar el montaje desde las gafas, en realidad mixta, con la sala ya alineada.
//  · A o X abre el panel de muebles: flota delante, con pestañas (mesas, asientos, escenario,
//    decoración y los muebles propios del hotel) y un dibujo de cada mueble.
//  · Arrastrar: se apunta a un mueble del panel, se mantiene el gatillo (o el pellizco), se
//    lleva el rayo hasta el sitio de la sala y se suelta. Soltarlo sobre el panel lo cancela.
//  · Los muebles ya puestos se arrastran igual: gatillo sobre el mueble, mover y soltar.
//  · Mientras se arrastra: joystick a izquierda o derecha gira 15°; B o Y lo borra.
//  · En el panel: deshacer, recolocar la sala (volver a marcar las esquinas) y cerrar.
// Los cambios van al proyecto como los del PC (deshacer, guardado y sincronización).

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useStore } from '../store';
import { findDef } from '../catalog';
import type { CatalogDef } from '../types';
import { useXR } from '../lib/xr';
import { itemAt, panelHit, PANEL_BANDS, PANEL_COLS, PANEL_ROWS, XR_ACTIONS, xrTabs, type PanelHit } from '../lib/xrEdit';
import { logEvent } from '../lib/usageLog';

const floor = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const HINT = 'A o X: panel de muebles (arrástralos a la sala)\nGatillo mantenido sobre un mueble: moverlo';
const PW = 1200;
const PH = 900;

/** Dibujo sencillo, visto desde arriba, de cada tipo de mueble. */
function drawIcon(ctx: CanvasRenderingContext2D, type: string, def: CatalogDef | undefined, cx: number, cy: number, s: number) {
  const chair = (x: number, y: number, r = s * 0.07) => {
    ctx.fillStyle = '#c9a45c';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  const rect = (w: number, h: number, color: string, radius = 6) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, cy - h / 2, w, h, radius);
    ctx.fill();
  };
  ctx.save();
  if (type.startsWith('mesa-redonda')) {
    const n = def?.chairs ?? 8;
    for (let i = 0; i < n; i++) chair(cx + Math.cos((i / n) * Math.PI * 2) * s * 0.36, cy + Math.sin((i / n) * Math.PI * 2) * s * 0.36);
    ctx.fillStyle = '#f5f1e8';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.26, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'mesa-imperial' || type === 'mesa-escuela') {
    const n = type === 'mesa-imperial' ? 3 : 3;
    for (let i = 0; i < n; i++) {
      const x = cx - s * 0.3 + (i + 0.5) * ((s * 0.6) / n);
      chair(x, cy + s * 0.2);
      if (type === 'mesa-imperial') chair(x, cy - s * 0.2);
    }
    rect(s * 0.7, s * (type === 'mesa-imperial' ? 0.24 : 0.16), '#f5f1e8');
  } else if (type === 'mesa-coctel') {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (type === 'buffet') rect(s * 0.8, s * 0.22, '#ffffff');
  else if (type === 'barra') rect(s * 0.85, s * 0.2, '#6b5240', 14);
  else if (type === 'silla' || type === 'silla-conferencia') {
    rect(s * 0.28, s * 0.28, type === 'silla' ? '#c9a45c' : '#5a6b82');
    ctx.fillStyle = type === 'silla' ? '#a8843f' : '#3d4b5f';
    ctx.fillRect(cx - s * 0.14, cy - s * 0.2, s * 0.28, s * 0.07);
  } else if (type === 'sofa' || type === 'butaca') {
    const w = type === 'sofa' ? s * 0.75 : s * 0.36;
    rect(w, s * 0.3, '#d9d2c3', 10);
    ctx.fillStyle = '#bfb6a4';
    ctx.fillRect(cx - w / 2, cy - s * 0.15, w, s * 0.09);
  } else if (type === 'escenario') rect(s * 0.8, s * 0.45, '#3a3e46', 4);
  else if (type === 'atril') {
    ctx.fillStyle = '#5b6068';
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.16, cy + s * 0.18);
    ctx.lineTo(cx + s * 0.16, cy + s * 0.18);
    ctx.lineTo(cx + s * 0.1, cy - s * 0.18);
    ctx.lineTo(cx - s * 0.1, cy - s * 0.18);
    ctx.fill();
  } else if (type === 'pantalla') {
    rect(s * 0.8, s * 0.45, '#111', 4);
    rect(s * 0.72, s * 0.38, '#6f8fb3', 2);
  } else if (type === 'pista-baile') {
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#222' : '#555';
        ctx.fillRect(cx - s * 0.32 + i * s * 0.16, cy - s * 0.32 + j * s * 0.16, s * 0.16, s * 0.16);
      }
  } else if (type === 'planta') {
    ctx.fillStyle = '#4f7d4a';
    for (const [dx, dy, r] of [[0, 0, 0.2], [-0.12, -0.08, 0.13], [0.12, -0.06, 0.13], [0, 0.13, 0.12]])
      ctx.beginPath(), ctx.arc(cx + dx * s, cy + dy * s, r * s, 0, Math.PI * 2), ctx.fill();
  } else if (type === 'photocall') rect(s * 0.8, s * 0.12, '#d8c7a0', 3);
  else if (type === 'alfombra') rect(s * 0.7, s * 0.45, '#b04a4a', 4);
  else if (type === 'uplight' || type === 'foco') {
    const g = ctx.createRadialGradient(cx, cy, 2, cx, cy, s * 0.3);
    g.addColorStop(0, type === 'uplight' ? '#c48cff' : '#fff6c8');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.3, 0, Math.PI * 2);
    ctx.fill();
  } else rect(s * 0.42, s * 0.3, def?.color ?? '#9aa3ad', 8);
  ctx.restore();
}

function makePanel() {
  const canvas = document.createElement('canvas');
  canvas.width = PW;
  canvas.height = PH;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.64, 0.48), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false }));
  mesh.renderOrder = 1000;
  mesh.visible = false;
  let last = '';
  const draw = (tabs: { id: string; label: string; types: string[] }[], tab: number, hover: string, custom: CatalogDef[]) => {
    const key = `${tab}|${hover}|${tabs.length}`;
    if (key === last) return;
    last = key;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, PW, PH);
    ctx.fillStyle = 'rgba(15, 30, 50, 0.93)';
    ctx.beginPath();
    ctx.roundRect(0, 0, PW, PH, 40);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Pestañas
    const th = PH * PANEL_BANDS.tabs;
    const tw = PW / tabs.length;
    tabs.forEach((t, i) => {
      ctx.fillStyle = i === tab ? '#2f80ed' : hover === `t${i}` ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.1)';
      ctx.beginPath();
      ctx.roundRect(i * tw + 10, 12, tw - 20, th - 20, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.fillText(t.label, i * tw + tw / 2, th / 2 + 2);
    });
    // Muebles de la pestaña
    const gy = th;
    const gh = PH * PANEL_BANDS.grid;
    const cw = PW / PANEL_COLS;
    const ch = gh / PANEL_ROWS;
    tabs[tab]?.types.slice(0, PANEL_COLS * PANEL_ROWS).forEach((type, i) => {
      const x = (i % PANEL_COLS) * cw;
      const y = gy + Math.floor(i / PANEL_COLS) * ch;
      const def = findDef(type, custom);
      ctx.fillStyle = hover === `i${type}` ? 'rgba(47,128,237,0.55)' : 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 10, cw - 20, ch - 20, 24);
      ctx.fill();
      drawIcon(ctx, type, def, x + cw / 2, y + ch * 0.42, Math.min(cw, ch) * 0.75);
      ctx.fillStyle = '#fff';
      ctx.font = '600 26px system-ui, sans-serif';
      const name = (def?.name ?? type).replace(/\s*\(.*\)$/, '');
      ctx.fillText(name.length > 22 ? name.slice(0, 21) + '…' : name, x + cw / 2, y + ch - 34);
    });
    // Acciones
    const ay = gy + gh;
    const ah = PH * PANEL_BANDS.actions;
    const aw = PW / XR_ACTIONS.length;
    XR_ACTIONS.forEach((a, i) => {
      ctx.fillStyle = hover === `a${a.id}` ? '#2f80ed' : 'rgba(255,255,255,0.18)';
      ctx.beginPath();
      ctx.roundRect(i * aw + 10, ay + 8, aw - 20, ah - 24, 20);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = '600 34px system-ui, sans-serif';
      ctx.fillText(a.label, i * aw + aw / 2, ay + ah / 2 - 4);
    });
    tex.needsUpdate = true;
  };
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
  /** Recién sacado del panel (si se suelta sobre el panel, se cancela). */
  fresh: boolean;
}

export function XREditor({ root }: { root: React.RefObject<THREE.Group> }) {
  const { gl, scene, camera } = useThree();
  const mode = useXR((s) => s.mode);
  const panel = useMemo(makePanel, []);
  const carry = useRef<Carry | null>(null);
  const panelOpen = useRef(false);
  const tab = useRef(0);
  const prevA = useRef(false);
  const prevB = useRef(false);
  const prevStick = useRef(0);
  const ray = useMemo(() => new THREE.Raycaster(), []);

  const active = () => {
    const st = useXR.getState();
    const s = useStore.getState();
    return st.mode === 'ar' && st.task === 'ver' && st.step === 2 && !!s.project && !s.readOnly;
  };
  const tabs = () => xrTabs(useStore.getState().project?.customCatalog ?? []);

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
  const onPanel = (i: number): PanelHit => {
    if (!panel.mesh.visible) return null;
    const r = controllerRay(i);
    ray.set(r.origin, r.direction);
    const h = ray.intersectObject(panel.mesh, false)[0];
    return h?.uv ? panelHit(h.uv.x, h.uv.y, tabs(), tab.current) : null;
  };
  const pointsAtPanel = (i: number) => {
    if (!panel.mesh.visible) return false;
    const r = controllerRay(i);
    ray.set(r.origin, r.direction);
    return ray.intersectObject(panel.mesh, false).length > 0;
  };

  const say = (message: string) => useXR.setState({ message });

  const startCarry = (id: string, hand: number, grab: { x: number; z: number }, fresh: boolean) => {
    const s = useStore.getState();
    const ids = s.withDecor([id]);
    const start: Carry['start'] = {};
    for (const it of s.project!.items) if (ids.includes(it.id)) start[it.id] = { x: it.x, z: it.z, rot: it.rot };
    carry.current = { id, hand, grab, start, last: 0, fresh };
    const it = s.project!.items.find((x) => x.id === id);
    const name = it?.label ?? findDef(it?.type ?? '', s.project!.customCatalog)?.name ?? 'Mueble';
    say(`${name}: llévalo donde quieras y suelta el gatillo\nJoystick: girar 15° · B o Y: borrar${fresh ? ' · soltar sobre el panel: cancelar' : ''}`);
  };

  /** Mueve (y gira) lo que se lleva: el mueble y lo que tiene encima, como un bloque. */
  const applyCarry = (to: { x: number; z: number }, dRot = 0) => {
    const c = carry.current;
    if (!c) return;
    const main = c.start[c.id];
    if (!main) return;
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
    useStore.getState().updateItems(
      Object.keys(c.start),
      (it) => {
        const p = c.start[it.id];
        return { x: r2(p.x + mx), z: r2(p.z + mz), rot: ((Math.round(p.rot) % 360) + 360) % 360 };
      },
      false,
    );
  };

  /** Abre el panel delante de la vista, un poco por debajo de los ojos; se queda fijo ahí. */
  const openPanel = (open: boolean) => {
    panelOpen.current = open;
    panel.mesh.visible = open;
    if (!open) {
      panel.mesh.removeFromParent();
      return;
    }
    if (!panel.mesh.parent) scene.add(panel.mesh);
    const cam = gl.xr.isPresenting ? gl.xr.getCamera() : camera;
    const head = new THREE.Vector3();
    const fwd = new THREE.Vector3();
    cam.getWorldPosition(head);
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    panel.mesh.position.copy(head).addScaledVector(fwd, 0.7).setY(head.y - 0.3);
    panel.mesh.lookAt(head.x, head.y - 0.1, head.z);
    if (tab.current >= tabs().length) tab.current = 0;
    panel.draw(tabs(), tab.current, '-', useStore.getState().project?.customCatalog ?? []);
    say('Apunta a un mueble del panel, mantén el gatillo y arrástralo a la sala');
  };

  useEffect(() => {
    const ctrls = [0, 1].map((i) => gl.xr.getController(i));
    // Pulsar (gatillo o pellizco): coger del panel, coger de la sala o usar un botón del panel
    const onStart = (i: number) => () => {
      if (!active() || carry.current) return;
      const s = useStore.getState();
      const hit = onPanel(i);
      if (hit) {
        if (hit.kind === 'tab') {
          tab.current = hit.index;
          return;
        }
        if (hit.kind === 'action') {
          if (hit.id === 'deshacer') s.undo();
          if (hit.id === 'cerrar') {
            openPanel(false);
            say(HINT);
          }
          if (hit.id === 'recolocar') {
            openPanel(false);
            useXR.setState({ step: 0, message: 'Ve a la esquina del FRENTE IZQUIERDA de la sala,\napunta al suelo en la esquina y pulsa el gatillo' });
          }
          return;
        }
        // Sacar un mueble del panel: nace bajo el panel y sigue al rayo en cuanto sale de él
        const w = panel.mesh.position.clone().setY(0);
        root.current!.updateMatrixWorld(true);
        const at = root.current!.worldToLocal(w);
        const id = s.addItem({ type: hit.type, x: Math.round(at.x * 100) / 100, z: Math.round(at.z * 100) / 100, rot: 0 });
        logEvent('gafas', `añadido desde las gafas: ${hit.type}`);
        startCarry(id, i, { x: at.x, z: at.z }, true);
        return;
      }
      if (pointsAtPanel(i)) return;
      // Coger un mueble de la sala
      const p = floorPoint(i);
      if (!p) return;
      const it = itemAt(s.project!.items, s.project!.customCatalog, p.x, p.z);
      if (!it) {
        say(HINT);
        return;
      }
      s.checkpoint();
      startCarry(it.id, i, { x: p.x, z: p.z }, false);
    };
    // Soltar: deja el mueble donde apunta (o lo cancela si se suelta sobre el panel)
    const onEnd = (i: number) => () => {
      const c = carry.current;
      if (!c || c.hand !== i) return;
      carry.current = null;
      if (c.fresh && pointsAtPanel(i)) {
        useStore.getState().undo();
        say('Cancelado');
        return;
      }
      const p = floorPoint(i);
      if (p) {
        carry.current = c;
        applyCarry({ x: p.x, z: p.z });
        carry.current = null;
      }
      logEvent('gafas', c.fresh ? 'mueble colocado desde las gafas' : 'mueble movido desde las gafas');
      say(panelOpen.current ? 'Arrastra otro mueble del panel, o A o X para cerrarlo' : HINT);
    };
    const handlers = ctrls.map((c, i) => {
      const h = { start: onStart(i), end: onEnd(i) };
      c.addEventListener('selectstart', h.start);
      c.addEventListener('selectend', h.end);
      return h;
    });
    return () => {
      ctrls.forEach((c, i) => {
        c.removeEventListener('selectstart', handlers[i].start);
        c.removeEventListener('selectend', handlers[i].end);
      });
      panel.mesh.removeFromParent();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, scene, camera, panel]);

  useFrame(() => {
    if (!mode) {
      if (useXR.getState().editing) useXR.setState({ editing: false });
      if (panelOpen.current) openPanel(false);
      return;
    }
    const on = active();
    if (on !== useXR.getState().editing) {
      useXR.setState({ editing: on });
      // Primero se deja leer el mensaje de la alineación; después, cómo editar
      if (on) window.setTimeout(() => active() && !carry.current && !panelOpen.current && !useXR.getState().message && say(HINT), 6500);
    }
    // Botones de los mandos: A/X panel, B/Y borrar lo que se lleva, joystick girar
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
    if (!on) {
      if (panelOpen.current) openPanel(false);
      carry.current = null;
      // Gafas emparejadas solo para ver: avisar de por qué no se abre el panel
      const st = useXR.getState();
      if (a && !prevA.current && st.mode === 'ar' && st.task === 'ver' && st.step === 2 && useStore.getState().readOnly)
        say('Estas gafas solo pueden ver el montaje.\nPara editar desde aquí, entra en las gafas con tu cuenta del hotel');
      prevA.current = a;
      return;
    }
    if (a && !prevA.current && !carry.current) openPanel(!panelOpen.current);
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
      const now = performance.now();
      // Recién sacado del panel: no se mueve mientras el rayo siga sobre el panel
      const overPanel = c.fresh && pointsAtPanel(c.hand);
      const p = overPanel ? null : floorPoint(c.hand);
      if (dir && dir !== prevStick.current && p) {
        applyCarry({ x: p.x, z: p.z }, -15 * dir);
        c.last = now;
      } else if (p && now - c.last > 60) {
        c.last = now;
        applyCarry({ x: p.x, z: p.z });
      }
    }
    prevStick.current = dir;
    // Resaltar lo que se señala en el panel
    if (panelOpen.current) {
      let hover = '';
      for (const i of [0, 1]) {
        const t = onPanel(i);
        if (t) hover = t.kind === 'item' ? `i${t.type}` : t.kind === 'tab' ? `t${t.index}` : `a${t.id}`;
      }
      panel.draw(tabs(), tab.current, hover, useStore.getState().project?.customCatalog ?? []);
    }
  });

  return null;
}
