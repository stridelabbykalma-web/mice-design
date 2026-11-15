import { describe, expect, it } from 'vitest';
import { itemAt, menuTile, XR_PALETTE } from '../lib/xrEdit';
import type { Item } from '../types';

describe('editar el montaje desde las gafas', () => {
  const items: Item[] = [
    { id: 'm1', type: 'mesa-redonda-180', x: 0, z: 0, rot: 0 },
    { id: 'm2', type: 'mesa-redonda-180', x: 1.2, z: 0, rot: 0 },
    { id: 'p', type: 'puerta', x: 3, z: 0, rot: 0 },
    { id: 'e', type: 'escenario', x: 0, z: -6, rot: 90, w: 6, d: 3 },
  ];
  it('coge el mueble al que se apunta; si se solapan, el de centro más cercano', () => {
    expect(itemAt(items, [], 0.1, 0)?.id).toBe('m1');
    expect(itemAt(items, [], 1.1, 0.1)?.id).toBe('m2');
    // Por las sillas de alrededor también se coge la mesa
    expect(itemAt(items, [], -1.3, 0)?.id).toBe('m1');
  });
  it('no mueve la arquitectura (puertas) y respeta el giro', () => {
    expect(itemAt(items, [], 3, 0)).toBeNull();
    // Escenario girado 90°: 3 m de ancho en x, 6 m de fondo en z
    expect(itemAt(items, [], 1.4, -6)?.id).toBe('e');
    expect(itemAt(items, [], 0, -8.5)?.id).toBe('e');
    expect(itemAt(items, [], 2.5, -6)).toBeNull();
  });
  it('paleta: casillas de muebles y fila de acciones', () => {
    expect(menuTile(0.05, 0.95)).toEqual({ kind: 'item', index: 0 });
    expect(menuTile(0.95, 0.5)).toEqual({ kind: 'item', index: XR_PALETTE.length - 1 });
    expect(menuTile(0.1, 0.1)).toEqual({ kind: 'action', id: 'deshacer' });
    expect(menuTile(0.9, 0.1)).toEqual({ kind: 'action', id: 'cerrar' });
  });
});
