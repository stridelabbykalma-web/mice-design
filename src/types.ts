// Modelo de datos de MICE Design

/** Vía de creación del espacio digital (cap. 1.2 del TFG). */
export type SpaceMethod = 'plano' | 'fotogrametria' | 'satelite' | 'video';

export interface Underlay {
  assetId: string;
  /** Ancho real que representa la imagen, en metros. */
  widthM: number;
  /** Relación alto/ancho de la imagen (se calcula al cargarla). */
  aspect: number;
  opacity: number;
  offsetX: number;
  offsetZ: number;
  rotation: number; // grados
}

export interface ImportedModel {
  assetId: string;
  name: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
  rotation: number; // grados
  /** Corrección del eje vertical (grados sobre X) para escaneos exportados con Z hacia arriba. */
  tilt?: number;
  /** Mostrar los colores tal como se capturaron (sin sombreado simulado). */
  realColors?: boolean;
  /** Brillo del escaneo (1 = original). */
  brightness?: number;
  /** Quitar del escaneo el mobiliario capturado y conservar paredes, decoración, techo y suelo. */
  emptyInterior?: boolean;
  /** Franja junto a las paredes que se conserva al vaciar (cuadros, molduras, radiadores...). */
  keepBand?: number;
  /** Franja superior que se conserva al vaciar (lámparas, molduras de techo). */
  keepCeiling?: number;
}

/** Foto real de una pared o del suelo aplicada como textura. */
export interface PhotoTexture {
  assetId: string;
  /** Suelo: metros reales que mide el trozo fotografiado (se repite como un mosaico). */
  tileM?: number;
}

export type WallSide = 'norte' | 'sur' | 'oeste' | 'este';

export interface Space {
  method: SpaceMethod;
  name: string;
  /** Ancho (eje X) en metros. */
  width: number;
  /** Fondo (eje Z) en metros. */
  depth: number;
  /** Altura libre en metros. */
  height: number;
  outdoor: boolean;
  showWalls: boolean;
  floorColor: string;
  wallColor: string;
  underlay?: Underlay;
  model?: ImportedModel;
  wallPhotos?: Partial<Record<WallSide, PhotoTexture>>;
  floorPhoto?: PhotoTexture;
  ceilingPhoto?: PhotoTexture;
  videoAssetId?: string;
}

export type Category =
  | 'mesas'
  | 'asientos'
  | 'escenario'
  | 'decoracion'
  | 'iluminacion'
  | 'senaletica'
  | 'arquitectura'
  | 'hotel';

export interface CatalogDef {
  type: string;
  name: string;
  category: Category;
  /** Dimensiones en metros (ancho X, fondo Z, alto Y). */
  w: number;
  d: number;
  h: number;
  /** Precio de alquiler/montaje por unidad (€). */
  price: number;
  color: string;
  /** Mesas: sillas que lleva por defecto. */
  chairs?: number;
  /** Capacidad de personas de pie (mesas de cóctel). */
  standing?: number;
  /** Plazas de asiento propias (sillas, sofás). */
  seats?: number;
  /** Se ancla a la pared más cercana (puertas, salidas, ventanas). */
  wallMount?: boolean;
  /** Dimensiones editables por el usuario (escenario, tabique, pista...). */
  resizable?: boolean;
  /** Mobiliario real del hotel digitalizado (GLB). */
  modelAssetId?: string;
  /** true: el GLB se reescala a w×d×h; false: se usa su escala real. */
  fitToDims?: boolean;
  /** Corrección del eje vertical del modelo (grados sobre X). */
  tilt?: number;
  /** Altura de colocación por defecto (elementos que se cuelgan en la pared). */
  mountY?: number;
  description?: string;
}

export interface Item {
  id: string;
  type: string;
  x: number;
  z: number;
  /** Rotación en grados alrededor del eje vertical. */
  rot: number;
  color?: string;
  chairs?: number;
  w?: number;
  d?: number;
  h?: number;
  label?: string;
  /** Mesas: centro de mesa decorativo. */
  centerpiece?: boolean;
  /** Mesas: tipo de silla que se coloca alrededor (permite usar sillas escaneadas). */
  chairType?: string;
  /** Altura sobre el suelo en metros (cuadros, apliques, lámparas). */
  y?: number;
  /** Foto real (cuadros, fotografías, lienzos). */
  imageAssetId?: string;
}

export type LayoutType = 'teatro' | 'escuela' | 'banquete' | 'coctel' | 'u' | 'imperial';

export interface EventInfo {
  name: string;
  client: string;
  date: string;
  time: string;
  pax: number;
  layout: LayoutType | '';
  notes: string;
  pricePerPax: number;
  roomPrice: number;
}

export type LightingPreset = 'dia' | 'tarde' | 'noche' | 'gala';

export interface Project {
  id: string;
  name: string;
  hotel: string;
  createdAt: number;
  updatedAt: number;
  space: Space;
  items: Item[];
  customCatalog: CatalogDef[];
  event: EventInfo;
  lighting: LightingPreset;
}

export type ViewMode = '3d' | 'planta' | 'paseo';
export type Tool = 'select' | 'place' | 'measure' | 'eyedropper';
