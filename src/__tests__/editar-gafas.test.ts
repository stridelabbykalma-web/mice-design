import { describe, expect, it } from 'vitest';
import { itemAt, panelHit, XR_TABS, xrTabs } from '../lib/xrEdit';
import type { CatalogDef, Item } from '../types';

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
  it('panel: pestañas arriba, muebles en 4 × 2 y acciones abajo', () => {
    expect(panelHit(0.05, 0.97, XR_TABS, 0)).toEqual({ kind: 'tab', index: 0 });
    expect(panelHit(0.9, 0.97, XR_TABS, 0)).toEqual({ kind: 'tab', index: XR_TABS.length - 1 });
    expect(panelHit(0.1, 0.7, XR_TABS, 0)).toEqual({ kind: 'item', type: 'mesa-redonda-180' });
    expect(panelHit(0.1, 0.7, XR_TABS, 1)).toEqual({ kind: 'item', type: 'silla' });
    // Casilla vacía de la pestaña de asientos (solo tiene 4)
    expect(panelHit(0.1, 0.3, XR_TABS, 1)).toBeNull();
    expect(panelHit(0.1, 0.05, XR_TABS, 0)).toEqual({ kind: 'action', id: 'deshacer' });
    expect(panelHit(0.9, 0.05, XR_TABS, 0)).toEqual({ kind: 'action', id: 'cerrar' });
  });
  it('los muebles propios del hotel tienen su pestaña', () => {
    const own: CatalogDef[] = [{ type: 'c_sillon', name: 'Sillón del lobby', category: 'asientos', w: 0.9, d: 0.9, h: 0.9, price: 0, color: '#888' }];
    expect(xrTabs([])).toHaveLength(XR_TABS.length);
    expect(xrTabs(own)[XR_TABS.length]).toMatchObject({ id: 'hotel', types: ['c_sillon'] });
  });
});
