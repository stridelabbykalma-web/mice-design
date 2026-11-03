# MICE Design

Prototipo del Trabajo de Fin de Grado **MICE Design**: una herramienta web de diseño 3D para planificar y presentar eventos en hoteles sobre una réplica fiel del espacio real y del mobiliario propio del hotel.

## Puesta en marcha

Requisitos: [Node.js](https://nodejs.org) 18 o superior.

```bash
npm install
```

```bash
npm run dev
```

Abre la dirección que aparece en la terminal (normalmente http://localhost:5173). Con `--host`, la app también se puede abrir desde el móvil o la tableta conectados a la misma red wifi.

Para generar la versión de producción (carpeta `dist/`, publicable en GitHub Pages, Netlify o Vercel):

```bash
npm run build
```

Para generar un único archivo `dist/index.html` autocontenido, que se puede enviar por correo o abrir sin servidor:

```bash
SINGLE=1 npx vite build
```

## Funcionalidades (objetivos OE5 y OE6)

| Área | Qué hace |
| --- | --- |
| **Creación del espacio** | Cuatro vías: **plano** (medidas y plano en imagen superpuesto a escala, con calibración por dos puntos), **fotogrametría / escaneo 3D** (importación de `.glb` de Polycam, Scaniverse, RealityScan, Meshroom… con autoajuste de escala, centrado y medidas), **vista satélite** (búsqueda por dirección e imagen Esri World Imagery a escala, o captura propia) y **vídeo** (reproductor de referencia y extracción de fotogramas en ZIP para fotogrametría). |
| **Elementos del espacio** | Columnas, tabiques, puertas, salidas de emergencia, ventanas y tomas de corriente; las puertas y salidas se anclan solas a la pared más cercana. |
| **Mobiliario real del hotel** | Importación de muebles escaneados (`.glb`) con sus medidas reales: sillas, mesas redondas o rectangulares (con sus sillas), sofás o decoración. Se usan en el diseño y en los montajes automáticos. |
| **Catálogo genérico** | Mesas (redonda Ø180/Ø150, imperial, escuela, cóctel, buffet, barra), asientos, escenario, atril, pantalla, pista de baile, decoración, iluminación (uplights, focos) y señalética con texto editable. |
| **Montajes automáticos** | Teatro, escuela, banquete (con tresbolillo), cóctel, U e imperial, para un número de personas o para el máximo que quepa; respetan márgenes, pasillos, columnas y la zona libre delante de las salidas. |
| **Editor** | Colocar, arrastrar, girar, duplicar, eliminar, selección múltiple, ajuste a rejilla, deshacer/rehacer, medición en 3D, colores de mantelería, número de sillas y numeración de mesas. |
| **Vistas** | 3D orbital, planta acotada (2D) y paseo en primera persona; ambientes de luz de día, tarde, noche y gala. |
| **Aforo y seguridad** | Comprobaciones orientativas según el CTE DB-SI 3 (densidad de ocupación, número y anchura de salidas, recorrido de evacuación, salidas obstruidas), además de solapes y elementos fuera del espacio. |
| **Presupuesto y orden de montaje** | Presupuesto orientativo (mobiliario, alquiler, servicio por persona e IVA) y orden de montaje (BEO) con planta, vista 3D, material, seguridad y firmas, imprimible en PDF. |
| **Vista cliente** | Modo de presentación sin herramientas de edición, con recorrido virtual y ficha del evento. |
| **Exportación** | Imagen PNG, modelo 3D del evento (`.glb`, para visores o realidad aumentada) y proyecto completo (`.mice.json`, con planos y modelos incluidos) para compartir o archivar. |
| **Evaluación con usuarios (OE7)** | Tareas cronometradas (éxito, ayuda, errores), cuestionario SUS en castellano con puntuación e interpretación, ítems TAM adaptados (utilidad percibida, facilidad de uso, fiabilidad del diseño e intención de uso), resultados agregados y exportación CSV para Excel o SPSS. |

Los proyectos se guardan automáticamente en el navegador (IndexedDB). Para pasarlos a otro equipo, usa **Exportar → Proyecto completo**.

## Arquitectura (para el capítulo 6)

- **Tecnologías**: React 18 + TypeScript, Three.js mediante React Three Fiber y Drei, Zustand para el estado y Vite como empaquetador. Es una aplicación web sin servidor: todo se ejecuta en el navegador.
- **Modelo de datos** (`src/types.ts`): un `Project` contiene el `Space` (medidas, vía de creación, plano o satélite, modelo escaneado, vídeo), la lista de `Item` (posición, giro, color, sillas…), el catálogo propio del hotel (`CatalogDef` con el `.glb` escaneado), los datos del evento y el ambiente de iluminación.
- **Módulos**:
  - `src/store.ts`: estado global, historial para deshacer y autoguardado.
  - `src/components/Scene.tsx`: escena 3D, cámaras (3D, planta y paseo), iluminación e interacción (colocar, arrastrar, medir).
  - `src/components/Furniture.tsx`: mobiliario procedural y carga de modelos escaneados, que se centran, se apoyan en el suelo y se reescalan a las medidas reales.
  - `src/lib/layouts.ts`: generadores de montajes.
  - `src/lib/safety.ts`: reglas de aforo y evacuación (CTE DB-SI).
  - `src/lib/geometry.ts`: colisiones entre rectángulos orientados (teorema del eje separador) y anclaje a paredes.
  - `src/lib/satellite.ts`, `src/lib/zip.ts`, `src/lib/db.ts`: satélite, fotogramas y persistencia.
  - `src/components/Survey.tsx`: módulo de evaluación SUS/TAM.
- **Convención de ejes**: el espacio está centrado en el origen, X es el ancho y Z el fondo; el frente (escenario o pantalla) está en Z negativa, en la parte superior de la vista en planta. Las unidades son metros.

## Aplicaciones de refuerzo recomendadas

- **Captura de espacios y muebles**: Polycam, Scaniverse o RealityScan en el móvil (con LiDAR si está disponible), o Meshroom o RealityCapture a partir de fotos. Exportar en `.glb`.
- **Medidas**: la herramienta **Medir** de la propia app, o el medidor AR del móvil, para calibrar la escala.
- **Ver el diseño en el lugar**: exporta el evento en `.glb` y ábrelo en un visor AR (por ejemplo, el visor 3D de Android o `<model-viewer>`).

## Limitaciones

Es un prototipo demostrativo (ver apartado 1.5 del TFG): no se integra con sistemas de reservas o facturación, las comprobaciones de seguridad son orientativas y no sustituyen al proyecto técnico ni al plan de autoprotección, y los precios son de ejemplo.

## Créditos

Imágenes satélite: Esri, Maxar, Earthstar Geographics. Geocodificación: © colaboradores de OpenStreetMap (Nominatim).
