// Corrección de perspectiva: convierte el cuadrilátero que el usuario marca sobre una foto
// (las 4 esquinas de una pared, del suelo o de un cuadro) en una imagen rectangular "de frente".

export type Pt = { x: number; y: number };

/** Resuelve un sistema lineal Ax = b por eliminación gaussiana. */
function solve(A: number[][], b: number[]) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

/** Homografía que lleva el cuadrado unidad (0,0)(1,0)(1,1)(0,1) al cuadrilátero q. */
export function unitSquareTo(q: Pt[]) {
  const src = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return (x: number, y: number): Pt => {
    const w = h[6] * x + h[7] * y + 1;
    return { x: (h[0] * x + h[1] * y + h[2]) / w, y: (h[3] * x + h[4] * y + h[5]) / w };
  };
}

/** Relación ancho/alto aproximada del rectángulo real a partir del cuadrilátero. */
export function estimateAspect(q: Pt[]) {
  const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
  const w = (d(q[0], q[1]) + d(q[3], q[2])) / 2;
  const h = (d(q[0], q[3]) + d(q[1], q[2])) / 2;
  return w / Math.max(1, h);
}

/**
 * Endereza la zona marcada de la imagen. q en píxeles de la imagen original,
 * en orden: arriba-izquierda, arriba-derecha, abajo-derecha, abajo-izquierda.
 */
export async function rectify(img: HTMLImageElement, q: Pt[], outW: number, outH: number): Promise<Blob> {
  // Fuente limitada a ~3000 px para no agotar la memoria del móvil.
  const k = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
  const sw = Math.round(img.naturalWidth * k);
  const sh = Math.round(img.naturalHeight * k);
  const sc = document.createElement('canvas');
  sc.width = sw;
  sc.height = sh;
  const sctx = sc.getContext('2d')!;
  sctx.drawImage(img, 0, 0, sw, sh);
  const src = sctx.getImageData(0, 0, sw, sh).data;
  const H = unitSquareTo(q.map((p) => ({ x: p.x * k, y: p.y * k })));

  const oc = document.createElement('canvas');
  oc.width = outW;
  oc.height = outH;
  const octx = oc.getContext('2d')!;
  const out = octx.createImageData(outW, outH);
  const o = out.data;
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      const p = H((i + 0.5) / outW, (j + 0.5) / outH);
      // Interpolación bilineal
      const x = Math.min(sw - 1.001, Math.max(0, p.x - 0.5));
      const y = Math.min(sh - 1.001, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const a = (y0 * sw + x0) * 4;
      const b = a + 4;
      const c = a + sw * 4;
      const d = c + 4;
      const t = (j * outW + i) * 4;
      for (let ch = 0; ch < 3; ch++) {
        const top = src[a + ch] * (1 - fx) + src[b + ch] * fx;
        const bot = src[c + ch] * (1 - fx) + src[d + ch] * fx;
        o[t + ch] = top * (1 - fy) + bot * fy;
      }
      o[t + 3] = 255;
    }
  }
  octx.putImageData(out, 0, 0);
  return new Promise((res, rej) => oc.toBlob((bl) => (bl ? res(bl) : rej(new Error('canvas'))), 'image/jpeg', 0.9));
}
