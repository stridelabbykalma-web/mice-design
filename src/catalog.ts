import type { CatalogDef, Category, Item } from './types';

export const CATEGORY_LABELS: Record<Category, string> = {
  hotel: 'Mobiliario del hotel (escaneado)',
  mesas: 'Mesas',
  'mesa-deco': 'Decoración de mesa',
  asientos: 'Asientos',
  escenario: 'Escenario y audiovisuales',
  decoracion: 'Decoración',
  iluminacion: 'Iluminación',
  senaletica: 'Señalética',
  arquitectura: 'Elementos del espacio',
};

/**
 * Catálogo genérico de partida. Las medidas son las estándar del sector
 * (mesa redonda de 180 cm para 10 pax, silla de banquete 45×45 cm, etc.).
 * Los precios son orientativos y editables por el hotel.
 */
export const BASE_CATALOG: CatalogDef[] = [
  // Mesas
  { type: 'mesa-redonda-180', name: 'Mesa redonda Ø180 (10 pax)', category: 'mesas', w: 1.8, d: 1.8, h: 0.76, price: 18, color: '#f5f1e8', chairs: 10 },
  { type: 'mesa-redonda-150', name: 'Mesa redonda Ø150 (8 pax)', category: 'mesas', w: 1.5, d: 1.5, h: 0.76, price: 15, color: '#f5f1e8', chairs: 8 },
  { type: 'mesa-imperial', name: 'Mesa rectangular 180×75', category: 'mesas', w: 1.8, d: 0.75, h: 0.76, price: 14, color: '#f5f1e8', chairs: 6 },
  { type: 'mesa-escuela', name: 'Mesa escuela 180×50', category: 'mesas', w: 1.8, d: 0.5, h: 0.76, price: 10, color: '#e9e4d8', chairs: 3 },
  { type: 'mesa-coctel', name: 'Mesa alta de cóctel Ø60', category: 'mesas', w: 0.6, d: 0.6, h: 1.1, price: 12, color: '#ffffff', standing: 5 },
  { type: 'buffet', name: 'Mesa de buffet 240×75', category: 'mesas', w: 2.4, d: 0.75, h: 0.9, price: 25, color: '#ffffff' },
  { type: 'barra', name: 'Barra de bar', category: 'mesas', w: 3, d: 0.7, h: 1.1, price: 120, color: '#3a2e25', resizable: true },
  // Decoración de mesa (se apoya sola sobre la mesa en la que se coloca)
  { type: 'cubierto', name: 'Cubierto completo (plato, cubiertos, copas)', category: 'mesa-deco', w: 0.36, d: 0.3, h: 0.2, price: 2.5, color: '#ffffff' },
  { type: 'bajoplato', name: 'Bajoplato', category: 'mesa-deco', w: 0.33, d: 0.33, h: 0.02, price: 1.5, color: '#c9a45c' },
  { type: 'copa', name: 'Copa', category: 'mesa-deco', w: 0.08, d: 0.08, h: 0.2, price: 0.6, color: '#dfe8ee' },
  { type: 'vela', name: 'Vela', category: 'mesa-deco', w: 0.08, d: 0.08, h: 0.16, price: 1, color: '#f6f0e2' },
  { type: 'candelabro', name: 'Candelabro de 3 velas', category: 'mesa-deco', w: 0.35, d: 0.12, h: 0.5, price: 12, color: '#c9a45c' },
  { type: 'centro-alto', name: 'Centro floral alto', category: 'mesa-deco', w: 0.4, d: 0.4, h: 0.75, price: 45, color: '#e6b8c2' },
  { type: 'centro-bajo', name: 'Centro floral bajo', category: 'mesa-deco', w: 0.45, d: 0.45, h: 0.22, price: 30, color: '#f1d3a6' },
  { type: 'numero-mesa', name: 'Número de mesa', category: 'mesa-deco', w: 0.12, d: 0.1, h: 0.25, price: 2, color: '#ffffff' },
  { type: 'menu-carta', name: 'Carta de menú', category: 'mesa-deco', w: 0.12, d: 0.05, h: 0.18, price: 1, color: '#ffffff' },
  { type: 'camino-mesa', name: 'Camino de mesa', category: 'mesa-deco', w: 1.6, d: 0.35, h: 0.004, price: 6, color: '#8a2433', resizable: true },
  // Asientos
  { type: 'silla', name: 'Silla de banquete', category: 'asientos', w: 0.45, d: 0.45, h: 0.9, price: 3, color: '#c9a45c', seats: 1 },
  { type: 'silla-conferencia', name: 'Silla de conferencia', category: 'asientos', w: 0.5, d: 0.5, h: 0.85, price: 3, color: '#2f3a4a', seats: 1 },
  { type: 'sofa', name: 'Sofá chill-out 3 plazas', category: 'asientos', w: 2, d: 0.85, h: 0.8, price: 60, color: '#d9d2c3', seats: 3 },
  { type: 'butaca', name: 'Butaca lounge', category: 'asientos', w: 0.8, d: 0.8, h: 0.8, price: 30, color: '#d9d2c3', seats: 1 },
  // Escenario y AV
  { type: 'escenario', name: 'Tarima / escenario', category: 'escenario', w: 6, d: 3, h: 0.4, price: 300, color: '#22252b', resizable: true },
  { type: 'atril', name: 'Atril', category: 'escenario', w: 0.6, d: 0.45, h: 1.15, price: 40, color: '#3b3f46' },
  { type: 'pantalla', name: 'Pantalla de proyección 16:9', category: 'escenario', w: 4, d: 0.3, h: 2.6, price: 250, color: '#111111', resizable: true },
  { type: 'pista-baile', name: 'Pista de baile', category: 'escenario', w: 6, d: 6, h: 0.03, price: 400, color: '#1b1b1b', resizable: true },
  // Decoración
  { type: 'planta', name: 'Planta decorativa', category: 'decoracion', w: 0.6, d: 0.6, h: 1.6, price: 20, color: '#4f7d4a' },
  { type: 'photocall', name: 'Photocall 3×2,4 m', category: 'decoracion', w: 3, d: 0.4, h: 2.4, price: 180, color: '#ffffff', resizable: true },
  { type: 'cuadro', name: 'Cuadro / fotografía real', category: 'decoracion', w: 1, d: 0.04, h: 0.75, price: 0, color: '#d9cdb8', wallMount: true, resizable: true, mountY: 1.55, description: 'Sube la foto del cuadro real del hotel y su tamaño' },
  { type: 'espejo', name: 'Espejo de pared', category: 'decoracion', w: 1, d: 0.04, h: 1.4, price: 0, color: '#c9a45c', wallMount: true, resizable: true, mountY: 1.4 },
  { type: 'alfombra', name: 'Alfombra', category: 'decoracion', w: 3, d: 2, h: 0.01, price: 40, color: '#8a2433', resizable: true },
  // Iluminación
  { type: 'uplight', name: 'Uplight LED (color)', category: 'iluminacion', w: 0.25, d: 0.25, h: 0.2, price: 25, color: '#ff9e3d' },
  { type: 'foco', name: 'Foco en trípode', category: 'iluminacion', w: 0.6, d: 0.6, h: 2.4, price: 45, color: '#fff2d6' },
  // Señalética
  { type: 'totem', name: 'Tótem señalético', category: 'senaletica', w: 0.6, d: 0.4, h: 1.8, price: 35, color: '#0f4c81' },
  { type: 'atril-bienvenida', name: 'Cartel de bienvenida', category: 'senaletica', w: 0.7, d: 0.5, h: 1.6, price: 30, color: '#ffffff' },
  // Arquitectura
  { type: 'columna', name: 'Columna', category: 'arquitectura', w: 0.5, d: 0.5, h: 3, price: 0, color: '#e8e4dc', resizable: true },
  { type: 'obstaculo', name: 'Mueble u obstáculo fijo', category: 'arquitectura', w: 1, d: 0.6, h: 2, price: 0, color: '#b9b2a6', resizable: true, description: 'Armario, barra, mueble de obra o cualquier cosa que ocupa sitio y no se mueve.' },
  { type: 'tabique', name: 'Tabique / muro', category: 'arquitectura', w: 3, d: 0.15, h: 3, price: 0, color: '#e8e4dc', resizable: true },
  { type: 'puerta', name: 'Puerta de acceso', category: 'arquitectura', w: 1.6, d: 0.12, h: 2.2, price: 0, color: '#7b5a3c', wallMount: true },
  { type: 'salida', name: 'Salida de emergencia', category: 'arquitectura', w: 1.2, d: 0.12, h: 2.1, price: 0, color: '#2e7d32', wallMount: true, resizable: true },
  { type: 'ventana', name: 'Ventana', category: 'arquitectura', w: 2, d: 0.08, h: 1.5, price: 0, color: '#9fc4dd', wallMount: true, resizable: true },
  { type: 'toma-corriente', name: 'Toma de corriente', category: 'arquitectura', w: 0.15, d: 0.05, h: 0.15, price: 0, color: '#f2c94c', wallMount: true },
];

export function findDef(type: string, custom: CatalogDef[]): CatalogDef | undefined {
  return custom.find((c) => c.type === type) ?? BASE_CATALOG.find((c) => c.type === type);
}

/** Dimensiones efectivas de un elemento (las editadas o las del catálogo). */
export function itemDims(item: Item, def?: CatalogDef) {
  return {
    w: item.w ?? def?.w ?? 1,
    d: item.d ?? def?.d ?? 1,
    h: item.h ?? def?.h ?? 1,
  };
}

export function isTable(def?: CatalogDef) {
  return !!def && def.chairs !== undefined;
}

export function isRoundTable(type: string) {
  return type.startsWith('mesa-redonda');
}

/** Huella en planta incluyendo las sillas (para colisiones y montajes). */
export function footprint(item: Item, def?: CatalogDef) {
  const { w, d } = itemDims(item, def);
  const chairs = item.chairs ?? def?.chairs ?? 0;
  if (!def || chairs === 0) return { w, d };
  if (isRoundTable(item.type)) return { w: w + 1.0, d: d + 1.0 };
  const layout = rectChairLayout(item.type, w, d, chairs);
  return { w: w + (layout.ends ? 1.0 : 0), d: d + (layout.back ? 0.5 : 0) + (layout.front ? 0.5 : 0) };
}

/**
 * Desplazamiento (en el eje Z local de la mesa) del centro de la huella con sillas respecto
 * al centro de la mesa: las mesas con sillas en un solo lado ocupan más hacia ese lado.
 */
export function footprintOffset(item: Item, def?: CatalogDef) {
  const chairs = item.chairs ?? def?.chairs ?? 0;
  if (!def || chairs === 0 || isRoundTable(item.type)) return 0;
  const { w, d } = itemDims(item, def);
  const layout = rectChairLayout(item.type, w, d, chairs);
  return ((layout.back ? 0.5 : 0) - (layout.front ? 0.5 : 0)) / 2;
}

/**
 * Reparto de sillas alrededor de una mesa rectangular.
 * La mesa de escuela solo lleva sillas en un lado (mirando al frente, -Z → +Z).
 */
export function rectChairLayout(type: string, w: number, _d: number, chairs: number) {
  if (type === 'mesa-escuela') return { back: chairs, front: 0, ends: 0 };
  const perSide = Math.max(1, Math.floor(w / 0.6));
  let remaining = chairs;
  const back = Math.min(perSide, remaining);
  remaining -= back;
  const front = Math.min(perSide, remaining);
  remaining -= front;
  const ends = Math.min(2, remaining);
  return { back, front, ends };
}

/** Personas que admite un elemento (plazas sentadas o de pie). */
export function itemCapacity(item: Item, def?: CatalogDef) {
  if (!def) return { seated: 0, standing: 0 };
  let chairs = item.chairs ?? def.chairs ?? 0;
  // En mesas rectangulares solo cuentan las sillas que caben (las que se dibujan)
  if (chairs > 0 && !isRoundTable(item.type)) {
    const { w, d } = itemDims(item, def);
    const l = rectChairLayout(item.type, w, d, chairs);
    chairs = l.back + l.front + l.ends;
  }
  return { seated: chairs + (def.seats ?? 0), standing: def.standing ?? 0 };
}
