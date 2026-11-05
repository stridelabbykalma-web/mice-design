# MICE Design

Prototipo del Trabajo de Fin de Grado **MICE Design**: una herramienta web de diseño 3D para planificar y presentar eventos en hoteles sobre una réplica fiel del espacio real y del mobiliario propio del hotel.

## Versión publicada

Cada cambio que se sube a `main` se compila y se publica automáticamente en GitHub Pages (`.github/workflows/pages.yml`):
https://stridelabbykalma-web.github.io/mice-design/

Para activarlo la primera vez: en GitHub, *Settings → Pages → Build and deployment → Source: GitHub Actions*.

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

## Método recomendado para el duplicado 3D (plano + iPhone 16 Pro + Quest 3S)

Cada herramienta aporta lo que mejor hace: **las medidas salen del plano, el aspecto del iPhone y la comprobación en la sala, de las gafas**.

1. **Plano del hotel → geometría exacta.** En *Espacio*, contorno (rectángulo o polígono dibujado sobre el plano a escala), altura, puertas, salidas y columnas. De aquí salen el aforo, la evacuación, la accesibilidad y los montajes.
2. **iPhone 16 Pro, RoomPlan (MICE Capture) → comprobar el plano.** Una pasada por la sala vacía: si alguna medida difiere más de 5 cm del plano, se corrige (los planos no siempre reflejan obras posteriores).
3. **iPhone 16 Pro, Gaussian splatting → aspecto fotográfico.** Con Scaniverse (gratis, procesa en el propio iPhone): sala vacía, luz de trabajo encendida, recorrido lento en dos alturas (pecho y por encima de la cabeza) cubriendo paredes, cuadros, techo y lámparas; exportar en **.spz** o .ply. En la app: *Importar splat* → *Encajar con el plano (4 clics)*: dos esquinas del escaneo y sus esquinas del plano; la escala, el giro y la posición se calculan solos.
4. **Revopoint Inspire 2 → mobiliario real** (silla y mesa de banquete), para que el montaje use las piezas del hotel.
5. **Meta Quest 3S → verlo.** En la sala vacía, *Realidad mixta*: el montaje sobre la sala real, con sombras en el suelo, en directo desde el ordenador. Fuera del hotel, *Realidad virtual*: el gemelo completo con el splat. Las gafas no sirven para escanear el aspecto (una web no puede usar sus cámaras) y sin sensor de profundidad miden peor que el iPhone.

Para splats en las gafas conviene que el archivo no pase de ~1 millón de puntos (Scaniverse permite elegir la calidad al exportar).

## Gemelo digital de la sala

El objetivo es que el espacio sea un **doble exacto de la sala real**, decoración incluida, y que el evento se monte encima.

1. **Escaneo completo (recomendado)**: importa el escaneo de la sala (`.glb`, también con compresión Draco/Meshopt/KTX2, o `.ply` con colores por vértice). Con *Colores y texturas reales* la sala se ve tal como se capturó: pinturas, papel pintado, molduras, apliques, lámparas, suelos. Los ambientes de luz no alteran esos colores.
2. **Vaciar la sala**: si se escaneó con muebles, la app los oculta y conserva lo que forma parte de la sala: una franja junto a las paredes (cuadros, molduras, radiadores, consolas), otra bajo el techo (lámparas, molduras) y el suelo con sus alfombras. Las franjas son ajustables y el modelo original no se modifica.
3. **Vista del interior**: en la vista 3D el techo y la pared que queda delante de la cámara se recortan solos; en el paseo la sala se ve completa.
4. **Sin escaneo completo**: se puede subir una foto frontal de cada pared y del suelo (indicando cuánto mide la muestra para repetirla a escala), colocar cada cuadro real con su foto, su tamaño y su altura, y colgar piezas de decoración escaneadas en la pared o el techo.
5. **Cuentagotas**: copia el color real de cualquier punto del escaneo o de las fotos y lo aplica a paredes, suelo, mantelerías o a la selección.

La guía de captura que aparece en la app (luz uniforme, sin flash, 60-70 % de solape, pasadas a dos alturas y una al techo, acercarse a cuadros y molduras, exportar texturas en 4K) puede servir para el capítulo de metodología.

El ejemplo *Gemelo digital de una sala* usa un **escaneo simulado** (`src/assets/salon-escaneado.glb`, generado con `tools/sala_ejemplo.py`) para demostrar el flujo. Para el caso práctico del TFG hay que sustituirlo por el escaneo real del hotel.

## Novedades

- **Catálogo del hotel compartido**: muebles escaneados, salas y *mesas decoradas* se guardan una vez y sirven para todos los eventos (con copia de seguridad `.mice-hotel.json`). La decoración de mesa (cubiertos, bajoplatos, copas, velas, candelabros, centros florales, número de mesa, carta, camino) se apoya sola en la mesa y se mueve y gira con ella; se puede copiar a todas las mesas iguales o aplicar en los montajes automáticos.
- **Varias propuestas por evento** (A, B, C…): cada una con su montaje, decoración, luz e invitados; comparación lado a lado (aforo, seguridad, presupuesto y plano) y cambio de propuesta en la vista cliente.
- **Salas con cualquier forma**: contorno poligonal (formas en L, U o T, dibujo con clics sobre el plano o vértices a mano) que siguen paredes, suelo, techo, cotas, montajes, aforo y seguridad. La medición de RoomPlan reconstruye el contorno real.
- **Plano de mesas con invitados**: importación CSV, asignación automática que mantiene juntos a los grupos, ocupación por mesa, resumen de dietas y alergias para cocina, exportación CSV y plano en la orden de montaje.
- **Gaussian splatting**: importación de capturas `.ply`, `.splat` o `.ksplat` para un realismo casi fotográfico (la librería se carga solo cuando se usa).

## Ver el evento en la sala real

- **Con el iPhone o el iPad (realidad aumentada)**: *Exportar → Ver en la sala con el iPhone*. Genera un USDZ del montaje a escala real (no se puede escalar por error), anclado al suelo, con el contorno de la sala marcado en azul y un punto de referencia (centro, esquina del frente o puerta). El visor de Apple (AR Quick Look) lo coloca en la sala vacía y se camina entre las mesas. No se exporta lo que ya existe (puertas, ventanas, columnas, cuadros).
- **Con gafas (WebXR, recomendado Meta Quest 3)**: botón *Gafas* (solo aparece en navegadores compatibles).
  - *Realidad mixta*: se ve la sala real y encima el montaje. Se alinea marcando con el mando o pellizcando con la mano las dos esquinas del frente; si la distancia real no coincide con la de la app, avisa de la diferencia en centímetros.
  - *Realidad virtual*: el gemelo digital completo; se camina o se teletransporta apuntando al suelo.
  - Probado con el emulador oficial IWER (Quest 3): la alineación recupera exactamente una sala girada 30° y desplazada. Falta la prueba con gafas físicas.

## Rendimiento

Medido con montajes grandes (órdenes de dibujo por fotograma y tiempo de dibujo):

| Montaje | Antes | Ahora |
| --- | --- | --- |
| Teatro, 675 sillas | 4.046 órdenes · 86 ms | 16 órdenes · 1 ms |
| Banquete, 42 mesas | 2.652 órdenes · 45 ms | 134 órdenes · 3 ms |

Claves: sillas genéricas dibujadas en grupo (instancing, siguen siendo seleccionables), dibujo solo cuando algo cambia, comprobaciones de seguridad con rejilla espacial y caché, texturas de escaneos limitadas (2048 px en móvil), menos resolución en móviles y módulos cargados bajo demanda.

## Accesibilidad, plano técnico y registro de uso

- **Accesibilidad** (orientativo, CTE DB-SUA 9): comprueba que desde la entrada hay un paso libre de 1,20 m hasta cada mesa (búsqueda de caminos en una rejilla de 10 cm) y un espacio de giro de 1,50 m delante de la puerta; marca las mesas afectadas. En el banquete de ejemplo, 9 de 15 mesas no son accesibles con pasillos de servicio de 90 cm.
- **Plano para AutoCAD** (*Exportar → Plano para AutoCAD (.dxf)*): DXF R12 en metros con capas de sala, arquitectura, mesas, sillas, mobiliario y textos.
- **Registro automático de uso** (*Evaluación con usuarios → Tareas*): durante una sesión de prueba se anotan de forma anónima y con su hora las acciones del participante; resumen por participante (duración, acciones, deshacer, montajes, avisos, exportaciones) y CSV detallado para el capítulo 7.

## Pruebas automáticas

`npm test` ejecuta 35 pruebas (Vitest) de montajes, aforo y evacuación, accesibilidad, geometría de salas con forma, medición con foto, invitados, mesas decoradas, RoomPlan, alineación de las gafas, DXF y registro de uso. GitHub Actions las ejecuta antes de cada publicación.

## Cuentas de hotel y ver el diseño en directo en las gafas (Supabase)

- **Inicio de sesión por hotel**: cada persona entra con su correo y contraseña; cada hotel tiene sus propias salas, proyectos y catálogo, separados también en el navegador (una base de datos local por hotel). Roles: *administrador*, *diseña y edita* y *solo ver*. Las personas se unen con un código de invitación de un solo uso (válido 7 días) desde *Equipo*. Sin servidor configurado, o con *Seguir sin cuenta*, la app funciona como antes, solo en el dispositivo.
- **Gafas y móviles sin contraseña**: en el editor, *🥽 Ver en gafas* muestra un código de 8 caracteres (un solo uso, 30 min). En el navegador de las Quest se elige *Gafas o móvil*, se escribe el código y se abre directamente ese proyecto en modo presentación; las gafas quedan emparejadas para la próxima vez. Para el móvil (fotos de las paredes) hay además un QR.
- **En directo**: con un proyecto abierto la app consulta los cambios cada 2 s y los sube 0,6 s después de guardar, así que lo que se mueve en el ordenador aparece en las gafas en 1–2 s, también dentro de la realidad mixta sin perder la alineación (medido con el servidor simulado: 1,3–2,1 s). Las gafas (*solo ver*) nunca suben cambios.
- **Compartir con el cliente** (botón *Compartir* del editor): crea un enlace de solo lectura (3D, plano, recorrido, propuestas e idioma) en el que el cliente deja comentarios señalando el punto del plano; el hotel los ve numerados en la escena y los marca como resueltos. Los invitados solo se comparten si se elige.
- **Puesta en marcha**: ejecutar `supabase/schema.sql` en el SQL Editor del proyecto, activar *Authentication → Sign In / Providers → Allow anonymous sign-ins* (para las gafas) y, si se quiere entrar sin confirmar el correo, desactivar *Confirm email*; después poner la *Project URL* en `src/lib/cloud.ts` (la clave pública *publishable* ya está). Nunca se usa la clave secreta. Los datos del hotel solo se leen y escriben mediante funciones que comprueban que el usuario pertenece al hotel y su rol; los archivos del hotel van a un bucket privado (`mice-hotel`) con la misma comprobación. Las propuestas para el cliente solo se abren con su enlace.

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

Por qué no hay realidad aumentada dentro de la web: Safari en iPhone no permite a las webs usar la RA (WebXR). En Android con Chrome sí sería posible.

## App de refuerzo MICE Capture (iPhone/iPad Pro con LiDAR)

En `ios/MICECapture/` está el código de una app nativa (SwiftUI + RoomPlan de Apple) que escanea la sala con el LiDAR en unos segundos y exporta paredes, puertas, ventanas y huecos en un archivo `.mice-room.json`. MICE Design lo importa en *Espacio → Medición con iPhone Pro*: endereza la sala, fija ancho, fondo y altura, coloca puertas y ventanas en su pared (con su altura de alféizar) y añade como tabiques los tramos interiores de salas en L. Para instalarla hace falta un Mac con Xcode; las instrucciones están en `ios/MICECapture/README.md`. El importador está probado con mediciones simuladas (sala girada 30° y desplazada, con tramo interior, puertas y ventana); la app de iPhone no se ha podido compilar en este entorno.

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
