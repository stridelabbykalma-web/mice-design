// Idioma de lo que ve el cliente (vista cliente, propuesta, comparación, plano de mesas).
// El editor del hotel está en español; el inglés es opcional por evento.

export type Lang = 'es' | 'en';

const EN: Record<string, string> = {
  // Vista cliente
  'Vista 3D': '3D view',
  Plano: 'Floor plan',
  Recorrido: 'Walkthrough',
  'Salir de la vista cliente': 'Exit client view',
  'Propuesta de evento': 'Event proposal',
  Fecha: 'Date',
  Horario: 'Time',
  Montaje: 'Setup',
  Asistentes: 'Guests',
  Espacio: 'Venue',
  'de altura': 'ceiling height',
  'Haz clic para recorrer el espacio': 'Click to walk through the venue',
  'W A S D o flechas para moverte · ratón para mirar · Mayús para ir más rápido · Esc para salir':
    'W A S D or arrow keys to move · mouse to look around · Shift to go faster · Esc to exit',
  // Luz
  Día: 'Day',
  Tarde: 'Afternoon',
  Noche: 'Night',
  Gala: 'Gala',
  // Propuesta / orden de montaje
  'Orden de montaje': 'Event setup proposal',
  Cliente: 'Client',
  Personalizado: 'Custom',
  'plazas sentadas': 'seats',
  'de pie': 'standing',
  'Plano de planta (el frente/escenario en la parte superior)': 'Floor plan (front/stage at the top)',
  'Vista 3D del evento': '3D view of the event',
  'Material y mobiliario': 'Furniture and equipment',
  Elemento: 'Item',
  'Ud.': 'Qty',
  Importe: 'Amount',
  'Seguridad y aforo': 'Safety and capacity',
  'Salidas de emergencia señalizadas': 'Signposted emergency exits',
  'Presupuesto orientativo': 'Estimated budget',
  'Mobiliario y montaje': 'Furniture and setup',
  'Alquiler del espacio': 'Venue hire',
  'Servicio por persona': 'Service per guest',
  'IVA (21 %)': 'VAT (21%)',
  Total: 'Total',
  Observaciones: 'Notes',
  'Plano de mesas': 'Seating plan',
  'Dietas y alergias para cocina': 'Dietary requirements',
  'Sin mesa asignada': 'Without a table',
  invitados: 'guests',
  'Departamento de eventos': 'Events department',
  'Conforme del cliente': 'Client approval',
  'Generado con MICE Design': 'Generated with MICE Design',
  'Las comprobaciones de seguridad son orientativas (CTE DB-SI) y no sustituyen al plan de autoprotección.':
    'Safety checks are indicative (Spanish Building Code CTE DB-SI) and do not replace the venue’s emergency plan.',
  'Imprimir / Guardar como PDF': 'Print / Save as PDF',
  Cerrar: 'Close',
  'Para imprimir o guardar en PDF, abre la app instalada.': 'To print or save as PDF, open the installed app.',
  // Comparación
  'Comparación de propuestas': 'Proposal comparison',
  'Ver el plano de cada propuesta': 'Show the floor plan of each proposal',
  'Generando planos…': 'Generating plans…',
  actual: 'current',
  'Plazas sentadas': 'Seats',
  'Personas de pie': 'Standing guests',
  Mesas: 'Tables',
  'Aforo máximo (CTE)': 'Maximum capacity (CTE)',
  Seguridad: 'Safety',
  Correcta: 'OK',
  'Total con IVA': 'Total incl. VAT',
  'Ambiente de luz': 'Lighting',
  Abrir: 'Open',
  // Montajes
  Teatro: 'Theatre',
  Escuela: 'Classroom',
  Banquete: 'Banquet',
  Cóctel: 'Cocktail',
  'En U': 'U-shape',
  Imperial: 'Boardroom',
  // Plano de mesas (CSV)
  Mesa: 'Table',
  Nombre: 'Name',
  Grupo: 'Group',
  'Dieta o alergias': 'Dietary requirements',
  Notas: 'Notes',
  'Sin mesa': 'No table',
};

/** Nombres del catálogo en inglés (para el presupuesto de la propuesta). */
const CATALOG_EN: Record<string, string> = {
  'mesa-redonda-180': 'Round table Ø180 (10 guests)',
  'mesa-redonda-150': 'Round table Ø150 (8 guests)',
  'mesa-imperial': 'Rectangular table 180×75',
  'mesa-escuela': 'Classroom table 180×50',
  'mesa-coctel': 'Cocktail poseur table Ø60',
  buffet: 'Buffet table 240×75',
  barra: 'Bar counter',
  cubierto: 'Place setting',
  bajoplato: 'Charger plate',
  copa: 'Glass',
  vela: 'Candle',
  candelabro: 'Three-arm candelabra',
  'centro-alto': 'Tall floral centrepiece',
  'centro-bajo': 'Low floral centrepiece',
  'numero-mesa': 'Table number',
  'menu-carta': 'Menu card',
  'camino-mesa': 'Table runner',
  silla: 'Banquet chair',
  'silla-conferencia': 'Conference chair',
  sofa: 'Three-seat lounge sofa',
  butaca: 'Lounge armchair',
  escenario: 'Stage',
  atril: 'Lectern',
  pantalla: '16:9 projection screen',
  'pista-baile': 'Dance floor',
  planta: 'Decorative plant',
  photocall: 'Photocall 3×2.4 m',
  alfombra: 'Rug',
  cuadro: 'Painting / photograph',
  espejo: 'Wall mirror',
  uplight: 'LED uplight',
  foco: 'Spotlight on tripod',
  totem: 'Sign totem',
  'atril-bienvenida': 'Welcome sign',
};

export function t(lang: Lang | undefined, es: string): string {
  return lang === 'en' ? EN[es] ?? es : es;
}

export function itemName(lang: Lang | undefined, type: string, es: string) {
  return lang === 'en' ? CATALOG_EN[type] ?? es : es;
}

export const locale = (lang?: Lang) => (lang === 'en' ? 'en-GB' : 'es-ES');

/** «Mesa 3» → «Table 3» en inglés. */
export const tableLabel = (lang: Lang | undefined, label?: string) => (lang === 'en' ? (label ?? 'Mesa').replace(/^Mesa\b/, 'Table') : label ?? 'Mesa');

/** Importe en euros con el formato del idioma (216,00 € / €216.00). */
export const money = (lang: Lang | undefined, v: number) =>
  v.toLocaleString(lang === 'en' ? 'en-IE' : 'es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });

/** Número con la coma o el punto decimal del idioma. */
export const decimal = (lang: Lang | undefined, v: number, d = 2) => (lang === 'en' ? v.toFixed(d) : v.toFixed(d).replace('.', ','));
