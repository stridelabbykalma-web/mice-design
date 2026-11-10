// Escaneo caminando: la sala se reconstruye en planta a partir del mapa de profundidad de las
// gafas mientras la persona camina. No depende del escaneo de Meta (que se hace desde un punto).
//
// Método:
//  1. Cada muestra de profundidad es un punto 3D. La línea en planta entre la cabeza y el
//     punto está libre (se ha visto a través de ella): se marca como suelo visto.
//  2. Los puntos entre 1,0 y 2,3 m de altura son pared (por encima del mobiliario).
//  3. Se busca la orientación dominante de las paredes y las líneas donde se concentran.
//  4. Esas líneas dividen la planta en rectángulos; son sala los que se han visto libres.
//     El contorno es el borde de su unión: sirve para salas en L, en U o con entrantes.

export type P2 = { x: number; z: number };
export type P3 = { x: number; y: number; z: number };

const CELL = 0.1;
/** La profundidad pierde precisión con la distancia: se descarta más allá de esto. */
export const MAX_RANGE = 5;
const OFF = 4096;
/** Fotogramas distintos en los que hay que ver una celda para darla por buena. */
const MIN_FRAMES = 3;
/** Huecos más estrechos que esto se consideran puertas. */
const DOOR = 2.5;
const key = (ix: number, iz: number) => (ix + OFF) * 8192 + (iz + OFF);

export interface WalkOutline {
  outline: P2[];
  /** m² de la sala reconstruida. */
  area: number;
  /** Orientación de las paredes (grados). */
  angle: number;
}

export class WalkScan {
  // Cada celda cuenta en cuántos fotogramas distintos se ha visto: una lectura suelta
  // equivocada (profundidad retrasada respecto a la cabeza) no cambia el resultado.
  private free = new Map<number, number>();
  private wall = new Map<number, number>();
  private ceil = new Map<number, number>();
  private floorSum = 0;
  private floorN = 0;
  frames = 0;
  /** Por dónde ha pasado la persona (una posición cada 30 cm). */
  private path: P2[] = [];

  /** Añade las muestras de un fotograma: posición de la cabeza y puntos vistos (metros, suelo en y = 0). */
  addFrame(head: P3, pts: P3[]) {
    this.frames++;
    const last = this.path[this.path.length - 1];
    if (!last || Math.hypot(head.x - last.x, head.z - last.z) > 0.3) this.path.push({ x: head.x, z: head.z });
    const seenFree = new Set<number>();
    const seenWall = new Set<number>();
    for (const p of pts) {
      if (!Number.isFinite(p.x + p.y + p.z)) continue;
      const dx = p.x - head.x;
      const dz = p.z - head.z;
      const dist = Math.hypot(dx, dz);
      const dy = p.y - head.y;
      // Techo: rayos muy inclinados hacia arriba
      if (dy > 0.6 && dy > dist * 0.7 && p.y > 1.9 && p.y < 12) {
        const b = Math.round(p.y / 0.05);
        this.ceil.set(b, (this.ceil.get(b) ?? 0) + 1);
      }
      // Suelo: rayos muy inclinados hacia abajo (sirve para comprobar que la profundidad es buena)
      if (dy < -0.8 && -dy > dist * 0.7) {
        this.floorSum += p.y;
        this.floorN++;
      }
      if (dist < 0.3) continue;
      // Suelo visto: celdas entre la cabeza y el punto (hasta el alcance fiable)
      const reach = Math.min(dist - 0.08, MAX_RANGE);
      const n = Math.ceil(reach / (CELL * 0.9));
      for (let i = 0; i <= n; i++) {
        const t = (reach * i) / n / dist;
        seenFree.add(key(Math.floor((head.x + dx * t) / CELL), Math.floor((head.z + dz * t) / CELL)));
      }
      // Pared: puntos a media altura, dentro del alcance
      if (dist <= MAX_RANGE && p.y >= 1.0 && p.y <= 2.3) {
        seenWall.add(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
      }
    }
    for (const k of seenFree) this.free.set(k, (this.free.get(k) ?? 0) + 1);
    for (const k of seenWall) this.wall.set(k, (this.wall.get(k) ?? 0) + 1);
  }

  private freeKeys() {
    const out: number[] = [];
    for (const [k, n] of this.free) if (n >= MIN_FRAMES) out.push(k);
    return out;
  }

  /** m² de suelo visto hasta ahora. */
  get seenArea() {
    return this.freeKeys().length * CELL * CELL;
  }

  /** Altura del techo (la más repetida entre los puntos vistos mirando hacia arriba). */
  get ceiling(): number | undefined {
    let best = 0;
    let h: number | undefined;
    for (const [b, n] of this.ceil)
      if (n > best) {
        best = n;
        h = b * 0.05;
      }
    return best >= 20 ? h : undefined;
  }

  /** Altura media medida del suelo (debería ser ≈ 0): detecta una profundidad mal interpretada. */
  get floorError(): number | undefined {
    return this.floorN >= 30 ? this.floorSum / this.floorN : undefined;
  }

  private cells(set: Iterable<number>) {
    const out: P2[] = [];
    for (const k of set) out.push({ x: (Math.floor(k / 8192) - OFF + 0.5) * CELL, z: ((k % 8192) - OFF + 0.5) * CELL });
    return out;
  }

  /** Contorno de la sala con lo visto hasta ahora (null si aún no hay suficiente). */
  outline(): WalkOutline | null {
    const walls: P2[] = [];
    for (const [k, n] of this.wall) if (n >= MIN_FRAMES) walls.push({ x: (Math.floor(k / 8192) - OFF + 0.5) * CELL, z: ((k % 8192) - OFF + 0.5) * CELL });
    const free = this.cells(this.freeKeys());
    if (walls.length < 40 || free.length < 200) return null;

    // 1. Orientación dominante: la que concentra las paredes en menos líneas
    const score = (deg: number) => {
      const c = Math.cos((deg * Math.PI) / 180);
      const s = Math.sin((deg * Math.PI) / 180);
      const hu = new Map<number, number>();
      const hv = new Map<number, number>();
      for (const p of walls) {
        const u = Math.round((p.x * c + p.z * s) / CELL);
        const v = Math.round((-p.x * s + p.z * c) / CELL);
        hu.set(u, (hu.get(u) ?? 0) + 1);
        hv.set(v, (hv.get(v) ?? 0) + 1);
      }
      let t = 0;
      for (const n of hu.values()) t += n * n;
      for (const n of hv.values()) t += n * n;
      return t;
    };
    let ang = 0;
    let best = -1;
    for (let a = 0; a < 90; a += 2) {
      const sc = score(a);
      if (sc > best) {
        best = sc;
        ang = a;
      }
    }
    for (let a = ang - 2; a <= ang + 2; a += 0.25) {
      const sc = score(a);
      if (sc > best) {
        best = sc;
        ang = a;
      }
    }
    const c = Math.cos((ang * Math.PI) / 180);
    const s = Math.sin((ang * Math.PI) / 180);
    const U = (p: P2) => p.x * c + p.z * s;
    const V = (p: P2) => -p.x * s + p.z * c;

    // 2. Líneas de pared en cada eje (máximos del histograma) y límites de lo visto
    const lines = (coord: (p: P2) => number) => {
      const h = new Map<number, number>();
      for (const p of walls) {
        const b = Math.round(coord(p) / CELL);
        h.set(b, (h.get(b) ?? 0) + 1);
      }
      const val = (b: number) => (h.get(b - 1) ?? 0) + (h.get(b) ?? 0) + (h.get(b + 1) ?? 0);
      // Una línea necesita al menos 1 m de pared vista
      const cand = [...h.keys()].map((b) => ({ b, v: val(b) })).filter((x) => x.v >= 10);
      cand.sort((p, q) => q.v - p.v);
      const picked: number[] = [];
      for (const x of cand) if (!picked.some((b) => Math.abs(b - x.b) < 5)) picked.push(x.b);
      const out = picked.map((b) => b * CELL);
      const fs = free.map(coord).sort((p, q) => p - q);
      for (const e of [fs[Math.floor(fs.length * 0.002)], fs[Math.ceil(fs.length * 0.998) - 1]]) if (!out.some((l) => Math.abs(l - e) < 0.6)) out.push(e);
      return out.sort((p, q) => p - q);
    };
    const lu = lines(U);
    const lv = lines(V);
    if (lu.length < 2 || lv.length < 2) return null;

    // 3. Rectángulos entre líneas: dentro si se ha visto libre más de la mitad
    const idx = (ls: number[], x: number) => {
      if (x < ls[0] || x >= ls[ls.length - 1]) return -1;
      let lo = 0;
      let hi = ls.length - 1;
      while (hi - lo > 1) {
        const m = (lo + hi) >> 1;
        if (ls[m] <= x) lo = m;
        else hi = m;
      }
      return lo;
    };
    const nu = lu.length - 1;
    const nv = lv.length - 1;
    const count = new Float64Array(nu * nv);
    for (const p of free) {
      const i = idx(lu, U(p));
      const j = idx(lv, V(p));
      if (i >= 0 && j >= 0) count[j * nu + i]++;
    }
    const inside = new Uint8Array(nu * nv);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        const cellsIn = ((lu[i + 1] - lu[i]) * (lv[j + 1] - lv[j])) / (CELL * CELL);
        inside[j * nu + i] = count[j * nu + i] > cellsIn * 0.5 ? 1 : 0;
      }
    // Paredes entre rectángulos vecinos: una zona a la que solo se llega por un hueco estrecho
    // (una puerta abierta) y por la que no se ha caminado no forma parte de la sala.
    const wallSet = new Set<string>();
    for (const p of walls) wallSet.add(`${Math.round(U(p) / CELL)},${Math.round(V(p) / CELL)}`);
    const isWall = (alongU: boolean, f: number, tt: number) => {
      for (let d = -2; d <= 2; d++) if (wallSet.has(alongU ? `${tt},${f + d}` : `${f + d},${tt}`)) return true;
      return false;
    };
    /** Mayor hueco sin pared (m) en la línea que separa dos rectángulos, medido más allá del tramo común. */
    const opening = (alongU: boolean, fixed: number, from: number, to: number) => {
      const f = Math.round(fixed / CELL);
      let best = 0;
      const t0 = Math.round((from + CELL / 2) / CELL);
      const t1 = Math.round((to - CELL / 2) / CELL);
      for (let t = t0; t <= t1; t++) {
        if (isWall(alongU, f, t)) continue;
        let lo = t;
        let hi = t;
        while (t - lo < 40 && !isWall(alongU, f, lo - 1)) lo--;
        while (hi - t < 40 && !isWall(alongU, f, hi + 1)) hi++;
        best = Math.max(best, (hi - lo + 1) * CELL);
        t = hi;
      }
      return best;
    };
    /** Entre el rectángulo (i, j) y su vecino (a, b) solo hay paso si el hueco mide al menos 2,5 m (más que una puerta). */
    const blocked = (i: number, j: number, a: number, b: number) =>
      (a !== i ? opening(false, lu[Math.max(i, a)], lv[j], lv[j + 1]) : opening(true, lv[Math.max(j, b)], lu[i], lu[i + 1])) < DOOR;
    // La sala es el grupo de rectángulos comunicados con los que ha pisado la persona
    const comp = new Int32Array(nu * nv).fill(-1);
    const stack: number[] = [];
    for (const h of this.path) {
      const i = idx(lu, U(h));
      const j = idx(lv, V(h));
      if (i >= 0 && j >= 0 && inside[j * nu + i] && comp[j * nu + i] < 0) {
        comp[j * nu + i] = 0;
        stack.push(j * nu + i);
      }
    }
    let bestArea = 0;
    while (stack.length) {
      const k = stack.pop()!;
      const i = k % nu;
      const j = (k - i) / nu;
      bestArea += (lu[i + 1] - lu[i]) * (lv[j + 1] - lv[j]);
      for (const [a, b] of [
        [i + 1, j],
        [i - 1, j],
        [i, j + 1],
        [i, j - 1],
      ]) {
        if (a < 0 || b < 0 || a >= nu || b >= nv) continue;
        const q = b * nu + a;
        if (inside[q] && comp[q] < 0 && !blocked(i, j, a, b)) {
          comp[q] = 0;
          stack.push(q);
        }
      }
    }
    const bestComp = 0;
    if (bestArea < 4) return null;
    const isIn = (i: number, j: number) => i >= 0 && j >= 0 && i < nu && j < nv && comp[j * nu + i] === bestComp;

    // 4. Borde de la unión: aristas con el interior a la izquierda, encadenadas
    const next = new Map<string, [number, number]>();
    const add = (a: [number, number], b: [number, number]) => next.set(`${a[0]},${a[1]}`, b);
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        if (!isIn(i, j)) continue;
        if (!isIn(i, j - 1)) add([i + 1, j], [i, j]);
        if (!isIn(i + 1, j)) add([i + 1, j + 1], [i + 1, j]);
        if (!isIn(i, j + 1)) add([i, j + 1], [i + 1, j + 1]);
        if (!isIn(i - 1, j)) add([i, j], [i, j + 1]);
      }
    // El bucle exterior es el más largo (los huecos interiores, como una columna, se descartan)
    let loop: [number, number][] = [];
    const seen = new Set<string>();
    for (const k0 of next.keys()) {
      if (seen.has(k0)) continue;
      const cur: [number, number][] = [];
      let k = k0;
      while (!seen.has(k) && next.has(k)) {
        seen.add(k);
        const [a, b] = k.split(',').map(Number);
        cur.push([a, b]);
        const n = next.get(k)!;
        k = `${n[0]},${n[1]}`;
      }
      if (cur.length > loop.length) loop = cur;
    }
    if (loop.length < 4) return null;
    // Quitar vértices intermedios de tramos rectos
    const corners = loop.filter((p, i) => {
      const a = loop[(i + loop.length - 1) % loop.length];
      const b = loop[(i + 1) % loop.length];
      return (p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0]) !== 0;
    });
    const outline = corners.map(([i, j]) => {
      const u = lu[i];
      const v = lv[j];
      return { x: u * c - v * s, z: u * s + v * c };
    });
    return { outline, area: bestArea, angle: ang };
  }
}
