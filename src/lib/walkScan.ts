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
const key = (ix: number, iz: number) => (ix + OFF) * 8192 + (iz + OFF);

/** Rejillas del escaneo caminando en formato de intercambio (celdas de 10 cm, enteros). */
export interface WalkGrids {
  cell: number;
  /** Por fila: [iz, x0, x1, x0, x1…] tramos de celdas de suelo visto. */
  free: number[][];
  /** Celdas de pared: [ix, iz, ix, iz…]. */
  wall: number[];
  /** Celdas con algo que ocupa sitio: [ix, iz, altura en cm…]. */
  obj: number[];
  /** Por dónde se ha caminado, en cm: [x, z, x, z…]. */
  path: number[];
  /** Altura del techo en metros. */
  ceiling?: number;
  frames?: number;
}

export interface WalkOutline {
  outline: P2[];
  /** m² de la sala reconstruida. */
  area: number;
  /** Orientación de las paredes (grados). */
  angle: number;
  /** Entrantes convertidos en obstáculo (en el sistema girado de la sala). */
  filled: { u0: number; u1: number; v0: number; v1: number }[];
}

export class WalkScan {
  // Cada celda cuenta en cuántos fotogramas distintos se ha visto: una lectura suelta
  // equivocada (profundidad retrasada respecto a la cabeza) no cambia el resultado.
  private free = new Map<number, number>();
  private wall = new Map<number, number>();
  /** Cosas que ocupan sitio (de 0,35 a 2,3 m de altura): fotogramas en que se han visto y altura máxima. */
  private obj = new Map<number, number>();
  private objH = new Map<number, number>();
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
    const seenObj = new Set<number>();
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
      // Muebles y obstáculos: cualquier cosa entre 0,35 y 2,3 m. A menos de 1 m no cuenta
      // (son las manos y los mandos de quien escanea).
      if (dist >= 1 && dist <= MAX_RANGE && p.y >= 0.35 && p.y <= 2.3) {
        const k = key(Math.floor(p.x / CELL), Math.floor(p.z / CELL));
        seenObj.add(k);
        if (p.y > (this.objH.get(k) ?? 0)) this.objH.set(k, p.y);
      }
      // Pared: puntos a media altura, dentro del alcance
      if (dist <= MAX_RANGE && p.y >= 1.0 && p.y <= 2.3) {
        seenWall.add(key(Math.floor(p.x / CELL), Math.floor(p.z / CELL)));
      }
    }
    for (const k of seenFree) this.free.set(k, (this.free.get(k) ?? 0) + 1);
    for (const k of seenWall) this.wall.set(k, (this.wall.get(k) ?? 0) + 1);
    for (const k of seenObj) this.obj.set(k, (this.obj.get(k) ?? 0) + 1);
  }

  private freeKeys() {
    const out: number[] = [];
    for (const [k, n] of this.free) if (n >= MIN_FRAMES) out.push(k);
    return out;
  }

  /**
   * Reconstruye el escaneo a partir de las rejillas que envía la app nativa de las gafas
   * (MICE Scan), que acumula las mismas celdas que `addFrame` y las manda ya filtradas.
   */
  static fromGrids(g: WalkGrids): WalkScan {
    const w = new WalkScan();
    // Suelo visto: por filas, tramos [x0, x1] de celdas seguidas
    for (const row of g.free) for (let i = 1; i + 1 < row.length; i += 2) for (let x = row[i]; x <= row[i + 1]; x++) w.free.set(key(x, row[0]), MIN_FRAMES);
    for (let i = 0; i + 1 < g.wall.length; i += 2) w.wall.set(key(g.wall[i], g.wall[i + 1]), MIN_FRAMES);
    for (let i = 0; i + 2 < g.obj.length; i += 3) {
      const k = key(g.obj[i], g.obj[i + 1]);
      w.obj.set(k, MIN_FRAMES);
      w.objH.set(k, g.obj[i + 2] / 100);
    }
    for (let i = 0; i + 1 < g.path.length; i += 2) w.path.push({ x: g.path[i] / 100, z: g.path[i + 1] / 100 });
    if (g.ceiling) w.ceil.set(Math.round(g.ceiling / 0.05), 1000);
    w.frames = g.frames ?? 0;
    return w;
  }

  /** Las rejillas en el formato de intercambio (lo mismo que envía la app nativa). */
  toGrids(): WalkGrids {
    const rows = new Map<number, number[]>();
    for (const [k, n] of this.free) {
      if (n < MIN_FRAMES) continue;
      const iz = (k % 8192) - OFF;
      if (!rows.has(iz)) rows.set(iz, []);
      rows.get(iz)!.push(Math.floor(k / 8192) - OFF);
    }
    const free: number[][] = [];
    for (const [iz, xs] of rows) {
      xs.sort((a, b) => a - b);
      const row = [iz];
      let x0 = xs[0];
      let prev = xs[0];
      for (let i = 1; i <= xs.length; i++) {
        if (i < xs.length && xs[i] === prev + 1) {
          prev = xs[i];
          continue;
        }
        row.push(x0, prev);
        x0 = prev = xs[i];
      }
      free.push(row);
    }
    const wall: number[] = [];
    for (const [k, n] of this.wall) if (n >= MIN_FRAMES) wall.push(Math.floor(k / 8192) - OFF, (k % 8192) - OFF);
    const obj: number[] = [];
    for (const [k, n] of this.obj) if (n >= MIN_FRAMES) obj.push(Math.floor(k / 8192) - OFF, (k % 8192) - OFF, Math.round((this.objH.get(k) ?? 1) * 100));
    return { cell: CELL, free, wall, obj, path: this.path.flatMap((p) => [Math.round(p.x * 100), Math.round(p.z * 100)]), ceiling: this.ceiling, frames: this.frames };
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

    // 2. Rejilla girada (alineada con las paredes): suelo visto que no es pared
    const us = free.map(U);
    const vs = free.map(V);
    const u0 = Math.min(...us) - 0.3;
    const v0 = Math.min(...vs) - 0.3;
    const gw = Math.ceil((Math.max(...us) + 0.3 - u0) / CELL);
    const gh = Math.ceil((Math.max(...vs) + 0.3 - v0) / CELL);
    if (gw * gh > 4_000_000) return null;
    const wallAt = (x: number, z: number) => (this.wall.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? 0) >= MIN_FRAMES;
    const freeAt = (x: number, z: number) => (this.free.get(key(Math.floor(x / CELL), Math.floor(z / CELL))) ?? 0) >= MIN_FRAMES;
    const open = new Uint8Array(gw * gh);
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        const u = u0 + (i + 0.5) * CELL;
        const v = v0 + (j + 0.5) * CELL;
        const x = u * c - v * s;
        const z = u * s + v * c;
        open[j * gw + i] = freeAt(x, z) && !wallAt(x, z) ? 1 : 0;
      }
    // Distancia (en celdas, con tope) de cada celda abierta a la más cercana que no lo es
    const RB = 12; // 1,2 m: por un hueco de menos de 2,4 m (una puerta) no se pasa a otra zona
    const RS = 4; //  0,4 m: por donde se ha caminado basta con que quepa una persona
    const dist = new Uint8Array(gw * gh);
    for (let k = 0; k < gw * gh; k++) dist[k] = open[k] ? RB + 1 : 0;
    for (let pass = 0; pass < 2; pass++)
      for (let jj = 0; jj < gh; jj++)
        for (let ii = 0; ii < gw; ii++) {
          const i = pass ? gw - 1 - ii : ii;
          const j = pass ? gh - 1 - jj : jj;
          const k = j * gw + i;
          if (!dist[k]) continue;
          const d = pass ? 1 : -1;
          const a1 = i + d >= 0 && i + d < gw ? dist[k + d] : 0;
          const a2 = j + d >= 0 && j + d < gh ? dist[k + d * gw] : 0;
          const m = Math.min(a1, a2) + 1;
          if (m < dist[k]) dist[k] = m;
        }
    const pathCells = this.path.map((h) => [Math.floor((U(h) - u0) / CELL), Math.floor((V(h) - v0) / CELL)]);
    // Cerca del recorrido (a menos de 1,5 m de por donde se ha pasado)
    const nearPath = new Uint8Array(gw * gh);
    for (const [pi, pj] of pathCells)
      for (let dj = -15; dj <= 15; dj++)
        for (let di = -15; di <= 15; di++) {
          const a = pi + di;
          const b2 = pj + dj;
          if (a >= 0 && b2 >= 0 && a < gw && b2 < gh && di * di + dj * dj <= 225) nearPath[b2 * gw + a] = 1;
        }
    /**
     * Zona conectada con el recorrido dejando un margen `r` a paredes y muebles altos, devuelta
     * después hasta las paredes. Con `local`, solo cerca de por donde se ha caminado.
     */
    const region = new Uint8Array(gw * gh);
    const grow = (r: number, local: boolean) => {
      const core = new Int16Array(gw * gh).fill(-1);
      let queue: number[] = [];
      const seed = (i: number, j: number) => {
        if (i < 0 || j < 0 || i >= gw || j >= gh) return;
        const k = j * gw + i;
        if (dist[k] >= r && core[k] < 0 && (!local || nearPath[k])) {
          core[k] = 0;
          queue.push(k);
        }
      };
      for (const [pi, pj] of pathCells) {
        const before = queue.length;
        for (let rr = 0; rr <= 6 && queue.length === before; rr++) for (let dj = -rr; dj <= rr; dj++) for (let di = -rr; di <= rr; di++) seed(pi + di, pj + dj);
      }
      for (let q = 0; q < queue.length; q++) {
        const k = queue[q];
        const i = k % gw;
        const j = (k - i) / gw;
        seed(i + 1, j);
        seed(i - 1, j);
        seed(i, j + 1);
        seed(i, j - 1);
      }
      // Vuelta hasta las paredes: `r` pasos a través de celdas abiertas (sin saltar tabiques)
      for (let step = 1; step <= r; step++) {
        const nextQ: number[] = [];
        for (const k of queue) {
          const i = k % gw;
          const j = (k - i) / gw;
          for (const [a, b2] of [
            [i + 1, j],
            [i - 1, j],
            [i, j + 1],
            [i, j - 1],
          ]) {
            if (a < 0 || b2 < 0 || a >= gw || b2 >= gh) continue;
            const q = b2 * gw + a;
            if (open[q] && core[q] < 0) {
              core[q] = step;
              nextQ.push(q);
            }
          }
        }
        queue = queue.concat(nextQ);
        if (!nextQ.length) break;
      }
      for (let k = 0; k < gw * gh; k++) if (core[k] >= 0) region[k] = 1;
    };
    grow(RB, false);
    grow(RS, true);
    const at = (i: number, j: number) => (i >= 0 && j >= 0 && i < gw && j < gh ? region[j * gw + i] : 0);

    // 3. Líneas de pared: donde el borde de la zona se acumula (al menos 1,2 m en ±10 cm)
    const pick = (hist: Float64Array, n: number) => {
      const val = (b: number) => (b > 0 ? hist[b - 1] : 0) + hist[b] + (b + 1 < n ? hist[b + 1] : 0);
      const cand: { b: number; v: number }[] = [];
      for (let b = 0; b < n; b++) if (val(b) >= 12) cand.push({ b, v: val(b) });
      cand.sort((p, q) => q.v - p.v);
      const picked: number[] = [];
      for (const x of cand) if (!picked.some((b) => Math.abs(b - x.b) < 5)) picked.push(x.b);
      return picked.sort((p, q) => p - q);
    };
    const hu = new Float64Array(gw + 1);
    const hv = new Float64Array(gh + 1);
    let iMin = gw;
    let iMax = 0;
    let jMin = gh;
    let jMax = 0;
    for (let j = 0; j < gh; j++)
      for (let i = 0; i < gw; i++) {
        if (!region[j * gw + i]) continue;
        if (!at(i - 1, j)) hu[i]++;
        if (!at(i + 1, j)) hu[i + 1]++;
        if (!at(i, j - 1)) hv[j]++;
        if (!at(i, j + 1)) hv[j + 1]++;
        if (i < iMin) iMin = i;
        if (i + 1 > iMax) iMax = i + 1;
        if (j < jMin) jMin = j;
        if (j + 1 > jMax) jMax = j + 1;
      }
    if (iMax <= iMin || jMax <= jMin) return null;
    const withEnds = (ls: number[], lo: number, hi: number) => {
      const out = ls.filter((b) => b > lo + 4 && b < hi - 4);
      return [lo, ...out, hi];
    };
    const bu = withEnds(pick(hu, gw + 1), iMin, iMax);
    const bv = withEnds(pick(hv, gh + 1), jMin, jMax);
    const lu = bu.map((b) => u0 + b * CELL);
    const lv = bv.map((b) => v0 + b * CELL);
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
    // Rectángulos entre líneas: son sala si más de la mitad de sus celdas lo son
    const comp = new Int32Array(nu * nv).fill(-1);
    let bestArea = 0;
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        let n = 0;
        for (let b = bv[j]; b < bv[j + 1]; b++) for (let a = bu[i]; a < bu[i + 1]; a++) n += region[b * gw + a];
        if (n > (bu[i + 1] - bu[i]) * (bv[j + 1] - bv[j]) * 0.5) {
          comp[j * nu + i] = 0;
          bestArea += (lu[i + 1] - lu[i]) * (lv[j + 1] - lv[j]);
        }
      }
    const bestComp = 0;
    if (bestArea < 4) return null;
    // Entrantes estrechos rodeados de sala por tres lados (o islas): no son forma de la sala
    // sino algo que ocupa sitio (un armario, un pilar, una barra). Se devuelven a la sala y
    // se anotan como obstáculo.
    const filled: { u0: number; u1: number; v0: number; v1: number }[] = [];
    for (let j = 0; j < nv; j++)
      for (let i = 0; i < nu; i++) {
        if (comp[j * nu + i] === 0) continue;
        const du = lu[i + 1] - lu[i];
        const dv = lv[j + 1] - lv[j];
        if (Math.min(du, dv) > 1.2 || Math.max(du, dv) > 4) continue;
        const nb = [
          [i + 1, j],
          [i - 1, j],
          [i, j + 1],
          [i, j - 1],
        ].filter(([a, b]) => a >= 0 && b >= 0 && a < nu && b < nv && comp[b * nu + a] === 0).length;
        if (nb >= 3) filled.push({ u0: lu[i], u1: lu[i + 1], v0: lv[j], v1: lv[j + 1] });
      }
    for (const f of filled) {
      comp[idx(lv, (f.v0 + f.v1) / 2) * nu + idx(lu, (f.u0 + f.u1) / 2)] = 0;
      bestArea += (f.u1 - f.u0) * (f.v1 - f.v0);
    }
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
    return { outline, area: bestArea, angle: ang, filled };
  }

  /**
   * Muebles y obstáculos dentro de la sala (armarios, barras, mesas que ya están): cajas
   * alineadas con las paredes. Lo que queda a menos de 0,9 m de una pared se pega a ella
   * (de un armario solo se ve el frente).
   */
  obstacles(room: WalkOutline): Obstacle[] {
    const c = Math.cos((room.angle * Math.PI) / 180);
    const s = Math.sin((room.angle * Math.PI) / 180);
    const poly = room.outline;
    const inPoly = (p: P2) => {
      let inside = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i];
        const b = poly[j];
        if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
      }
      return inside;
    };
    const distWall = (p: P2) => {
      let m = Infinity;
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const vx = b.x - a.x;
        const vz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / (vx * vx + vz * vz || 1)));
        m = Math.min(m, Math.hypot(p.x - a.x - t * vx, p.z - a.z - t * vz));
      }
      return m;
    };
    // Celdas ocupadas dentro de la sala, lejos de las paredes y de por donde se ha caminado
    const cells = new Map<string, { u: number; v: number; h: number }>();
    for (const [k, n] of this.obj) {
      if (n < MIN_FRAMES) continue;
      const p = { x: (Math.floor(k / 8192) - OFF + 0.5) * CELL, z: ((k % 8192) - OFF + 0.5) * CELL };
      if (!inPoly(p) || distWall(p) < 0.3) continue;
      if (this.path.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 0.4)) continue;
      const u = Math.round((p.x * c + p.z * s) / CELL);
      const v = Math.round((-p.x * s + p.z * c) / CELL);
      const h = this.objH.get(k) ?? 1;
      const prev = cells.get(`${u},${v}`);
      if (!prev || h > prev.h) cells.set(`${u},${v}`, { u, v, h });
    }
    const out: Obstacle[] = [];
    // Entrantes de la sala anotados como obstáculo: su altura es la de lo visto en su frente
    for (const f of room.filled) {
      const hs: number[] = [];
      for (const [k, n] of this.obj) {
        if (n < MIN_FRAMES) continue;
        const p = { x: (Math.floor(k / 8192) - OFF + 0.5) * CELL, z: ((k % 8192) - OFF + 0.5) * CELL };
        const u = p.x * c + p.z * s;
        const v = -p.x * s + p.z * c;
        if (u > f.u0 - 0.2 && u < f.u1 + 0.2 && v > f.v0 - 0.2 && v < f.v1 + 0.2) hs.push(this.objH.get(k) ?? 2);
      }
      hs.sort((a, b) => a - b);
      const h = hs.length ? Math.round(hs[Math.floor(hs.length * 0.9)] * 20) / 20 : 2;
      out.push({ x: ((f.u0 + f.u1) / 2) * c - ((f.v0 + f.v1) / 2) * s, z: ((f.u0 + f.u1) / 2) * s + ((f.v0 + f.v1) / 2) * c, w: f.u1 - f.u0, d: f.v1 - f.v0, h: Math.max(0.4, h), rot: -room.angle });
    }
    const inFilled = (u: number, v: number) => room.filled.some((f) => u > f.u0 - 0.25 && u < f.u1 + 0.25 && v > f.v0 - 0.25 && v < f.v1 + 0.25);
    // Grupos de celdas vecinas (se toleran huecos de 20 cm)
    const boxes: { u0: number; u1: number; v0: number; v1: number; h: number }[] = [];
    const seen = new Set<string>();
    for (const [k0, c0] of cells) {
      if (seen.has(k0)) continue;
      seen.add(k0);
      const group = [c0];
      for (let i = 0; i < group.length; i++) {
        const g = group[i];
        for (let du = -2; du <= 2; du++)
          for (let dv = -2; dv <= 2; dv++) {
            const k = `${g.u + du},${g.v + dv}`;
            const n = cells.get(k);
            if (n && !seen.has(k)) {
              seen.add(k);
              group.push(n);
            }
          }
      }
      if (group.length < 10) continue;
      let u0 = (Math.min(...group.map((g) => g.u)) - 0.5) * CELL;
      let u1 = (Math.max(...group.map((g) => g.u)) + 0.5) * CELL;
      let v0 = (Math.min(...group.map((g) => g.v)) - 0.5) * CELL;
      let v1 = (Math.max(...group.map((g) => g.v)) + 0.5) * CELL;
      if (Math.max(u1 - u0, v1 - v0) < 0.4) continue;
      if (inFilled((u0 + u1) / 2, (v0 + v1) / 2)) continue;
      const world = (u: number, v: number) => ({ x: u * c - v * s, z: u * s + v * c });
      // Pegar a la pared cercana: se avanza desde cada cara hasta salir de la sala
      const reach = (u: number, v: number, du: number, dv: number) => {
        for (let t = CELL; t <= 0.9; t += CELL) if (!inPoly(world(u + du * t, v + dv * t))) return t;
        return 0;
      };
      const um = (u0 + u1) / 2;
      const vm = (v0 + v1) / 2;
      u0 -= reach(u0, vm, -1, 0);
      u1 += reach(u1, vm, 1, 0);
      v0 -= reach(um, v0, 0, -1);
      v1 += reach(um, v1, 0, 1);
      const hs = group.map((g) => g.h).sort((a, b) => a - b);
      const h = Math.round(hs[Math.floor(hs.length * 0.9)] * 20) / 20;
      boxes.push({ u0, u1, v0, v1, h: Math.max(0.4, h) });
    }
    // Trozos del mismo mueble (se tocan y tienen una altura parecida): se unen
    for (let merged = true; merged; ) {
      merged = false;
      for (let a = 0; a < boxes.length && !merged; a++)
        for (let b = a + 1; b < boxes.length && !merged; b++) {
          const A = boxes[a];
          const B = boxes[b];
          if (Math.abs(A.h - B.h) > 0.4 || A.u0 > B.u1 + 0.3 || B.u0 > A.u1 + 0.3 || A.v0 > B.v1 + 0.3 || B.v0 > A.v1 + 0.3) continue;
          boxes[a] = { u0: Math.min(A.u0, B.u0), u1: Math.max(A.u1, B.u1), v0: Math.min(A.v0, B.v0), v1: Math.max(A.v1, B.v1), h: Math.max(A.h, B.h) };
          boxes.splice(b, 1);
          merged = true;
        }
    }
    for (const b of boxes) {
      const ctr = { x: ((b.u0 + b.u1) / 2) * c - ((b.v0 + b.v1) / 2) * s, z: ((b.u0 + b.u1) / 2) * s + ((b.v0 + b.v1) / 2) * c };
      out.push({ x: ctr.x, z: ctr.z, w: Math.max(0.2, b.u1 - b.u0), d: Math.max(0.2, b.v1 - b.v0), h: b.h, rot: -room.angle });
    }
    return out;
  }
}

/** Caja de un mueble u obstáculo en coordenadas del escaneo (rot en grados, convenio de la app). */
export interface Obstacle {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  rot: number;
}
