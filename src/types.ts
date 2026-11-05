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

export interface SplatScene {
  assetId: string;
  name: string;
  format: 'ply' | 'splat' | 'ksplat' | 'spz';
  scale: number;
  /** Giro alrededor del eje vertical (grados). */
  rotation: number;
  /** Corrección del eje vertical (grados sobre X); muchas capturas vienen con Y hacia abajo (180). */
  tilt: number;
  offsetX: number;
  offsetY: number;
  offsetZ: number;
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
  /** Captura fotorrealista por Gaussian splatting (.ply, .splat, .ksplat). */
  splat?: SplatScene;
  wallPhotos?: Partial<Record<WallSide, PhotoTexture>>;
  /** Contorno de la sala si no es rectangular (metros, centrado en el origen). */
  outline?: { x: number; z: number }[];
  /** Fotos de pared por tramo del contorno ('e0', 'e1'…) en salas no rectangulares. */
  edgePhotos?: Record<string, PhotoTexture>;
  floorPhoto?: PhotoTexture;
  ceilingPhoto?: PhotoTexture;
  videoAssetId?: string;
}

export type Category =
  | 'mesas'
  | 'mesa-deco'
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
  /** Pieza que se apoya sobre la mesa en la que se coloque (decoración de mesa escaneada). */
  onTable?: boolean;
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
  /** Idioma de lo que ve el cliente (vista cliente, propuesta, comparación, plano de mesas). */
  language?: 'es' | 'en';
}

export type LightingPreset = 'dia' | 'tarde' | 'noche' | 'gala';

/** Invitado del evento y su sitio en el plano de mesas. */
export interface Guest {
  id: string;
  name: string;
  /** Empresa, familia o grupo: se intenta sentar juntos. */
  group?: string;
  /** Dieta o alergias (vegetariano, celíaco, sin lactosa…). */
  diet?: string;
  notes?: string;
  /** Mesa asignada (id del elemento) en la propuesta actual. */
  tableId?: string;
}

/** Propuesta alternativa de montaje dentro de un mismo evento. */
export interface Variant {
  id: string;
  name: string;
  items: Item[];
  lighting: LightingPreset;
  layout: LayoutType | '';
  guests?: Guest[];
}

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
  /** Enlaces enviados al cliente (propuestas publicadas). */
  shares?: { id: string; createdAt: number; includeGuests: boolean; variant?: string }[];
  /** Invitados y su mesa en la propuesta actual. */
  guests?: Guest[];
  /** Propuestas alternativas; la activa vive en items/lighting. */
  variants?: Variant[];
  activeVariant?: string;
}

export type ViewMode = '3d' | 'planta' | 'paseo';
export type Tool = 'select' | 'place' | 'measure' | 'eyedropper' | 'outline' | 'align';

/** Pieza de una mesa decorada, en coordenadas locales de la mesa. */
export type TemplateDecor = Omit<Item, 'id' | 'x' | 'z' | 'rot'> & { dx: number; dz: number; drot: number };

/** Mesa decorada guardada en el catálogo del hotel. */
export interface TableTemplate {
  base: Omit<Item, 'id' | 'x' | 'z' | 'rot' | 'label'>;
  decor: TemplateDecor[];
  /** Definiciones del catálogo propio que usa (mesa, sillas o piezas escaneadas). */
  defs: CatalogDef[];
}

/** Sala guardada en el catálogo del hotel: espacio y elementos fijos (arquitectura, cuadros...). */
export interface RoomTemplate {
  space: Space;
  items: Item[];
  defs: CatalogDef[];
}

export type LibraryKind = 'mueble' | 'mesa' | 'sala';

export interface LibraryEntry {
  id: string;
  kind: LibraryKind;
  name: string;
  createdAt: number;
  /** Última modificación (para sincronizar entre dispositivos). */
  updatedAt?: number;
  def?: CatalogDef;
  table?: TableTemplate;
  room?: RoomTemplate;
}
