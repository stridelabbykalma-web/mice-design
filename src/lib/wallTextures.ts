// Fotos de las paredes a partir de las fotos del escaneo de las gafas.
//
// Cada foto llega con la posición y el giro exactos de la cámara de las gafas (coordenadas de
// Unity). Con la calibración de la cámara se sabe a qué píxel de cada foto corresponde cada
// punto de una pared, así que se puede «pintar» cada tramo de pared con lo que se vio de él:
// para cada punto se mezclan las fotos que lo ven de frente y de cerca, descartando las que lo
// ven a través de otra pared.
import type { P2 } from './outline';
import { inwardNormal } from './outline';

/** Píxeles de una foto ya decodificada (RGBA, fila 0 arriba). */
export interface Pixels {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface CameraPhoto {
  /** Posición y giro (cuaternión x, y, z, w) de la cámara en Unity: x derecha, y arriba, z adelante. */
  pos: number[];
  rot: number[];
  /** Calibración para el tamaño de esta foto (píxeles; origen arriba a la izquierda). */
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  img: Pixels;
}

/** Cómo pasar de la planta de la sala (x, z, altura) a las coordenadas de Unity del escaneo. */
export interface RoomFrame {
  theta: number;
  x: number;
  z: number;
  /** Altura del suelo en Unity. */
  y: number;
}

/**
 * Calibración de la cámara de las gafas para una foto de w × h. Si la app la envía se usa esa;
 * si no, la de la cámara de Quest 3 / 3S (sensor de 1728 × 1728, medida en unas Quest 3S), con
 * el mismo recorte y escala que aplica Meta al pedir otra resolución.
 */
export function cameraIntrinsics(w: number, h: number, sent?: { fx: number; fy: number; cx: number; cy: number; sw: number; sh: number }) {
  const s = sent ?? { fx: 1167.12, fy: 1167.12, cx: 869.74, cy: 870.69, sw: 1728, sh: 1728 };
  let kx = w / s.sw;
  let ky = h / s.sh;
  const m = Math.max(kx, ky);
  kx /= m;
  ky /= m;
  // Zona del sensor que se usa (centrada) y escala hasta el tamaño de la foto
  const cropX = (s.sw * (1 - kx)) / 2;
  const cropY = (s.sh * (1 - ky)) / 2;
  const scale = w / (s.sw * kx);
  return { fx: s.fx * scale, fy: s.fy * scale, cx: (s.cx - cropX) * scale, cy: (s.cy - cropY) * scale };
}

function rotate(q: number[], v: number[]): number[] {
  const [x, y, z, w] = q;
  const [vx, vy, vz] = v;
  // v' = v + 2w(q×v) + 2 q×(q×v)
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

function segCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d;
  const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d;
  return t > 0.001 && t < 0.97 && u > 0 && u < 1;
}

/**
 * Imagen del tramo de pared i (de outline[i] a outline[i+1]) tal como se ve desde dentro de la
 * sala: el borde izquierdo de la imagen es el extremo izquierdo visto de frente, fila 0 arriba
 * (techo). Devuelve null si las fotos apenas lo cubren.
 */
export function wallTexture(outline: P2[], i: number, height: number, frame: RoomFrame, photos: CameraPhoto[], pxPerM = 80, minCoverage = 0.15): Pixels | null {
  const a = outline[i];
  const b = outline[(i + 1) % outline.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 0.2 || !photos.length) return null;
  const n = inwardNormal(outline, i);
  // Dirección «hacia la derecha» mirando la pared desde dentro (la misma que usa la vista 3D)
  const ux = n.z;
  const uz = -n.x;
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const W = Math.max(8, Math.min(1024, Math.round(len * pxPerM)));
  const H = Math.max(8, Math.min(512, Math.round(height * pxPerM)));
  const out = new Uint8ClampedArray(W * H * 4);
  const cos = Math.cos(frame.theta);
  const sin = Math.sin(frame.theta);
  // Cámaras en la planta de la sala, para descartar las que ven el punto a través de otra pared
  const camsRoom = photos.map((p) => {
    const X = p.pos[0] - frame.x;
    const Z = -p.pos[2] - frame.z;
    return { x: X * cos + Z * sin, z: -X * sin + Z * cos };
  });
  // Giro inverso de cada cámara (de mundo a cámara)
  const inv = photos.map((p) => [-p.rot[0], -p.rot[1], -p.rot[2], p.rot[3]]);
  const cand = new Float32Array(photos.length * 4);
  let covered = 0;
  let sr = 0;
  let sg = 0;
  let sb = 0;
  for (let col = 0; col < W; col++) {
    const s = ((col + 0.5) / W - 0.5) * len;
    const px = mx + ux * s;
    const pz = mz + uz * s;
    // A la planta de Unity (z cambia de signo)
    const wx = px * cos - pz * sin + frame.x;
    const wz = -(px * sin + pz * cos + frame.z);
    // Cámaras que ven este punto por delante de la pared y sin otra pared en medio
    const usable: number[] = [];
    for (let k = 0; k < photos.length; k++) {
      const c = camsRoom[k];
      const front = (c.x - px) * n.x + (c.z - pz) * n.z;
      if (front < 0.3) continue;
      let blocked = false;
      for (let j = 0; j < outline.length && !blocked; j++) {
        if (j === i) continue;
        const e = outline[j];
        const f = outline[(j + 1) % outline.length];
        blocked = segCross(c.x, c.z, px, pz, e.x, e.z, f.x, f.z);
      }
      if (!blocked) usable.push(k);
    }
    for (let row = 0; row < H; row++) {
      const wy = frame.y + height * (1 - (row + 0.5) / H);
      // Candidatas: peso y color de cada foto que ve este punto
      let n_ = 0;
      let best = 0;
      for (const k of usable) {
        const p = photos[k];
        const v = rotate(inv[k], [wx - p.pos[0], wy - p.pos[1], wz - p.pos[2]]);
        if (v[2] < 0.3) continue;
        const u = p.cx + (p.fx * v[0]) / v[2];
        const vv = p.cy - (p.fy * v[1]) / v[2];
        const m = 6;
        if (u < m || vv < m || u >= p.img.width - m || vv >= p.img.height - m) continue;
        // Peso: de frente, de cerca y lejos del borde de la foto (donde la lente deforma más)
        const dist = Math.hypot(v[0], v[1], v[2]);
        const facing = Math.max(0, ((camsRoom[k].x - px) * n.x + (camsRoom[k].z - pz) * n.z) / Math.max(0.01, Math.hypot(camsRoom[k].x - px, camsRoom[k].z - pz)));
        const ex = Math.min(u, p.img.width - u) / (p.img.width / 2);
        const ey = Math.min(vv, p.img.height - vv) / (p.img.height / 2);
        const wgt = (Math.pow(facing, 3) * Math.min(1, ex * 3) * Math.min(1, ey * 3)) / (dist * dist);
        if (wgt <= 0) continue;
        // Muestreo bilineal
        const x0 = Math.floor(u);
        const y0 = Math.floor(vv);
        const fx = u - x0;
        const fy = vv - y0;
        const d = p.img.data;
        const iw = p.img.width;
        const i00 = (y0 * iw + x0) * 4;
        const i10 = i00 + 4;
        const i01 = i00 + iw * 4;
        const i11 = i01 + 4;
        for (let ch = 0; ch < 3; ch++) {
          const top = d[i00 + ch] * (1 - fx) + d[i10 + ch] * fx;
          const bot = d[i01 + ch] * (1 - fx) + d[i11 + ch] * fx;
          cand[n_ * 4 + ch] = top * (1 - fy) + bot * fy;
        }
        cand[n_ * 4 + 3] = wgt;
        if (wgt > best) best = wgt;
        n_++;
      }
      // Solo se mezclan las mejores: mezclar todas deja «fantasmas» de lo que hay delante de la pared
      let r = 0;
      let g = 0;
      let bl = 0;
      let wsum = 0;
      for (let c = 0; c < n_; c++) {
        const w0 = cand[c * 4 + 3];
        if (w0 < best * 0.6) continue;
        const w1 = w0 - best * 0.6 + 1e-6;
        r += cand[c * 4] * w1;
        g += cand[c * 4 + 1] * w1;
        bl += cand[c * 4 + 2] * w1;
        wsum += w1;
      }
      const o = (row * W + col) * 4;
      if (wsum > 0) {
        out[o] = r / wsum;
        out[o + 1] = g / wsum;
        out[o + 2] = bl / wsum;
        out[o + 3] = 255;
        covered++;
        sr += out[o];
        sg += out[o + 1];
        sb += out[o + 2];
      }
    }
  }
  if (covered < W * H * minCoverage) return null;
  // Lo que no se vio se rellena con el color medio de la pared vista
  const fr = sr / covered;
  const fg = sg / covered;
  const fb = sb / covered;
  for (let o = 0; o < out.length; o += 4)
    if (out[o + 3] === 0) {
      out[o] = fr;
      out[o + 1] = fg;
      out[o + 2] = fb;
      out[o + 3] = 255;
    }
  return { width: W, height: H, data: out };
}
