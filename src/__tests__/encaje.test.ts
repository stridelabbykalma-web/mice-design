import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { alignSplat, similarity, applySim, snapToCorner } from '../lib/align';
import type { SplatScene } from '../types';

describe('encajar el escaneo con el plano', () => {
  it('recupera escala, giro y desplazamiento', () => {
    const m0 = { s: 1.37, r: 0.6, tx: 2.5, tz: -1.2 };
    const a = { x: -3, z: 1 }, b = { x: 4, z: 2.5 };
    const A = applySim(a, m0), B = applySim(b, m0);
    const m = similarity(a, b, A, B);
    expect(m.s).toBeCloseTo(1.37, 6);
    expect(m.r).toBeCloseTo(0.6, 6);
    expect(m.tx).toBeCloseTo(2.5, 6);
    expect(m.tz).toBeCloseTo(-1.2, 6);
  });

  it('el splat corregido coloca sus puntos sobre los del plano (como lo dibuja three.js)', () => {
    const sp: SplatScene = { assetId: 'x', name: 'x', format: 'ply', scale: 0.8, rotation: 25, tilt: 0, offsetX: 1, offsetY: 0, offsetZ: -2 };
    // Punto del escaneo en coordenadas del propio splat → mundo, igual que el grupo de Scene.tsx
    const world = (s: SplatScene, local: THREE.Vector3) => {
      const g = new THREE.Group();
      g.position.set(s.offsetX, s.offsetY, s.offsetZ);
      g.rotation.set(0, (s.rotation * Math.PI) / 180, 0);
      g.scale.setScalar(s.scale);
      g.updateMatrixWorld();
      return local.clone().applyMatrix4(g.matrixWorld);
    };
    const la = new THREE.Vector3(2, 0, 3), lb = new THREE.Vector3(-5, 0, 1);
    const a = world(sp, la), b = world(sp, lb);
    const A = { x: -6, z: -4 }, B = { x: 6, z: -4 };
    const out = alignSplat(sp, { x: a.x, z: a.z }, { x: b.x, z: b.z }, A, B);
    const a2 = world(out, la), b2 = world(out, lb);
    expect(a2.x).toBeCloseTo(A.x, 5);
    expect(a2.z).toBeCloseTo(A.z, 5);
    expect(b2.x).toBeCloseTo(B.x, 5);
    expect(b2.z).toBeCloseTo(B.z, 5);
  });

  it('ajusta el clic a la esquina más cercana', () => {
    expect(snapToCorner({ x: 5.8, z: 4.2 }, [{ x: 6, z: 4 }, { x: -6, z: 4 }])).toEqual({ x: 6, z: 4 });
    expect(snapToCorner({ x: 0, z: 0 }, [{ x: 6, z: 4 }])).toEqual({ x: 0, z: 0 });
  });
});
