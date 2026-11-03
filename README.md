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

## Gemelo digital de la sala

El objetivo es que el espacio sea un **doble exacto de la sala real**, decoración incluida, y que el evento se monte encima.

1. **Escaneo completo (recomendado)**: importa el escaneo de la sala (`.glb`, también con compresión Draco/Meshopt/KTX2, o `.ply` con colores por vértice). Con *Colores y texturas reales* la sala se ve tal como se capturó: pinturas, papel pintado, molduras, apliques, lámparas, suelos. Los ambientes de luz no alteran esos colores.
2. **Vaciar la sala**: si se escaneó con muebles, la app los oculta y conserva lo que forma parte de la sala: una franja junto a las paredes (cuadros, molduras, radiadores, consolas), otra bajo el techo (lámparas, molduras) y el suelo con sus alfombras. Las franjas son ajustables y el modelo original no se modifica.
3. **Vista del interior**: en la vista 3D el techo y la pared que queda delante de la cámara se recortan solos; en el paseo la sala se ve completa.
4. **Sin escaneo completo**: se puede subir una foto frontal de cada pared y del suelo (indicando cuánto mide la muestra para repetirla a escala), colocar cada cuadro real con su foto, su tamaño y su altura, y colgar piezas de decoración escaneadas en la pared o el techo.
5. **Cuentagotas**: copia el color real de cualquier punto del escaneo o de las fotos y lo aplica a paredes, suelo, mantelerías o a la selección.

La guía de captura que aparece en la app (luz uniforme, sin flash, 60-70 % de solape, pasadas a dos alturas y una al techo, acercarse a cuadros y molduras, exportar texturas en 4K) puede servir para el capítulo de metodología.

El ejemplo *Gemelo digital de una sala* usa un **escaneo simulado** (`src/assets/salon-escaneado.glb`, generado con `tools/sala_ejemplo.py`) para demostrar el flujo. Para el caso práctico del TFG hay que sustituirlo por el escaneo real del hotel.

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

## Captura de la sala desde la propia app (sin apps externas)

En *Espacio → Capturar la sala con la cámara* se fotografía cada superficie (cuatro paredes, suelo y techo) con el móvil. Después se arrastran sus cuatro esquinas sobre la foto y la app **corrige la perspectiva** (homografía) y la coloca a escala sobre las medidas reales del espacio, aunque la foto esté hecha de lado. Las fotos se muestran con sus colores reales. El mismo editor sirve para enderezar la foto de cada cuadro.

Limitación: las paredes quedan planas y los relieves (molduras, apliques) son imagen. Para tener volumen exacto hay que hacer un escaneo 3D completo (fotogrametría o LiDAR), que requiere un procesado pesado que hoy no es viable dentro del navegador, o escanear esas piezas aparte como decoración.

## Medir una pared con una foto (cualquier móvil, sin LiDAR ni realidad aumentada)

En *Espacio → Medir una pared con foto*: se marca en la foto un rectángulo de la pared cuyo tamaño real se ha medido una vez (con la app Medidas del iPhone o con un metro) y las cuatro esquinas de la pared. Con una homografía entre ambos (metrología plana) la app calcula el ancho y el alto reales de la pared, rellena las medidas del espacio y aplica la foto enderezada a esa pared. Incluye una lupa para colocar las esquinas con precisión y un indicador de fiabilidad.

Precisión simulada para una pared de 16 × 3,6 m fotografiada en perspectiva (foto de 1600 px), según el tamaño de la referencia y el error al marcar sus esquinas:

| Referencia | Error con ±1 px | Error con ±3 px |
| --- | --- | --- |
| Folio A4 | inutilizable | inutilizable |
| Puerta 0,9 × 2,1 m | 3–5 % | 19–28 % |
| Puerta doble 1,8 × 2,3 m | 1–2 % | 4–6 % |
| Tramo de pared de 4 m × alto completo | 0,3–0,5 % | 1–1,5 % |

En la prueba completa marcando a mano en pantalla se obtuvieron 16,03 × 3,62 m para una pared real de 16,00 × 3,60 m. Las fotos de un móvil actual (unos 4000 px) reducen aún más el error.

Por qué no hay realidad aumentada: Safari en iPhone no permite a las webs usar la RA (WebXR), y el escaneo automático de salas de Apple (RoomPlan) necesita LiDAR (modelos Pro) y una app nativa. En Android con Chrome sí sería posible añadir medición con RA dentro de la web.

## Escáner Revopoint Inspire 2 (mobiliario y decoración)

El escáner de mano se usa para digitalizar **piezas**: sillas, mesas, sofás, lámparas, jarrones, esculturas, molduras o elementos decorativos sueltos. Para la **sala entera** es mejor la fotogrametría o el LiDAR del móvil, porque el escáner trabaja a poca distancia y escanear un salón con él sería lentísimo.

Flujo recomendado en Revo Scan:
1. Escanear la pieza en modo color (textura), con marcadores o mesa giratoria en las piezas pequeñas.
2. Fusionar, limpiar el fondo y **simplificar la malla** (entre 100.000 y 500.000 triángulos por pieza para que el diseño siga fluido).
3. Exportar en **PLY con color** (o en GLB si la versión de Revo Scan lo ofrece; si solo da OBJ con textura, convertirlo a GLB con Blender).
4. En MICE Design: Catálogo → *Añadir mueble escaneado*. La app detecta si el archivo está en milímetros, propone las medidas en metros, corrige el eje vertical si la pieza sale tumbada y la ajusta a las medidas reales tomadas con un metro.

Las superficies negras, brillantes o transparentes (cristal, cromado, lacado negro) se escanean mal con luz estructurada; en esos casos ayuda un spray matificante temporal.

## Aplicaciones de refuerzo recomendadas

- **Captura de espacios y muebles**: Polycam, Scaniverse o RealityScan en el móvil (con LiDAR si está disponible), o Meshroom o RealityCapture a partir de fotos. Exportar en `.glb`.
- **Medidas**: la herramienta **Medir** de la propia app, o el medidor AR del móvil, para calibrar la escala.
- **Ver el diseño en el lugar**: exporta el evento en `.glb` y ábrelo en un visor AR (por ejemplo, el visor 3D de Android o `<model-viewer>`).

## Limitaciones

Es un prototipo demostrativo (ver apartado 1.5 del TFG): no se integra con sistemas de reservas o facturación, las comprobaciones de seguridad son orientativas y no sustituyen al proyecto técnico ni al plan de autoprotección, y los precios son de ejemplo.

## Créditos

Imágenes satélite: Esri, Maxar, Earthstar Geographics. Geocodificación: © colaboradores de OpenStreetMap (Nominatim).
