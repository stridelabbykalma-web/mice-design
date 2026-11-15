import { describe, expect, it } from 'vitest';
import { rectOutline } from '../lib/outline';
import { cameraIntrinsics, wallTexture } from '../lib/wallTextures';

describe('fotos de las paredes a partir de las fotos de las gafas', () => {
  // Foto de 320 × 240: mitad izquierda roja, mitad derecha azul
  const img = { width: 320, height: 240, data: new Uint8ClampedArray(320 * 240 * 4) };
  for (let y = 0; y < 240; y++)
    for (let x = 0; x < 320; x++) {
      const o = (y * 320 + x) * 4;
      img.data.set(x < 160 ? [220, 20, 20, 255] : [20, 20, 220, 255], o);
    }
  const outline = rectOutline(4, 4);
  const frame = { theta: 0, x: 0, z: 0, y: 0 };
  // Cámara en el centro a 1,5 m, mirando a la pared del frente (z = −2 en la web = +z en Unity)
  const cam = { pos: [0, 1.5, 0], rot: [0, 0, 0, 1], fx: 200, fy: 200, cx: 160, cy: 120, img };

  it('pinta la pared que tiene delante con la foto, en el lado correcto', () => {
    const front = outline.findIndex((a, i) => {
      const b = outline[(i + 1) % outline.length];
      return Math.abs(a.z + 2) < 1e-6 && Math.abs(b.z + 2) < 1e-6;
    });
    const t = wallTexture(outline, front, 3, frame, [cam], 40)!;
    expect(t).not.toBeNull();
    const px = (fx: number, fy: number) => {
      const o = (Math.floor(fy * t.height) * t.width + Math.floor(fx * t.width)) * 4;
      return [t.data[o], t.data[o + 1], t.data[o + 2]];
    };
    // Vista desde dentro: la izquierda de la pared es la izquierda de la foto
    expect(px(0.3, 0.5)[0]).toBeGreaterThan(150);
    expect(px(0.7, 0.5)[2]).toBeGreaterThan(150);
  });

  it('una pared que la cámara no ve se queda sin foto', () => {
    const back = outline.findIndex((a, i) => {
      const b = outline[(i + 1) % outline.length];
      return Math.abs(a.z - 2) < 1e-6 && Math.abs(b.z - 2) < 1e-6;
    });
    expect(wallTexture(outline, back, 3, frame, [cam], 40)).toBeNull();
  });

  it('calibración de Quest 3S: recorte 4:3 del sensor cuadrado', () => {
    const k = cameraIntrinsics(1280, 960);
    expect(k.fx).toBeCloseTo(864.5, 0);
    expect(k.cx).toBeCloseTo(644.3, 0);
    expect(k.cy).toBeCloseTo(485.0, 0);
  });
});
