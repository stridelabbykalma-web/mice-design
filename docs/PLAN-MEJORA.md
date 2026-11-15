# Auditoría y plan de mejora (14 de noviembre de 2026)

## Qué se ha revisado y cómo

| Parte | Cómo | Resultado |
|---|---|---|
| Web: compilación y pruebas | `tsc`, 81 pruebas automáticas, compilación de producción | Todo pasa |
| Web: uso real | Navegador automático (escritorio y móvil): inicio, ejemplo con 6 fases, vista cliente, exportar, proyecto corrupto, importación de un escaneo **real** de Quest 3S | Sin errores de consola; dos fallos del escaneo, corregidos |
| App de las gafas (`quest/MiceScan.cs`) | Lectura por un revisor independiente (no se puede compilar aquí) | Sin errores de compilación seguros; 4 fallos de ejecución, corregidos en la v8 |
| Seguridad y datos | Lectura por un revisor independiente de `supabase/schema.sql` y del código que habla con la nube | 9 problemas altos, 8 medios; 2 corregidos, el resto en este plan |
| Dependencias | `npm audit` | 2 avisos moderados (`uuid`, vía `@react-three/drei`) |

No se ha podido probar: la app de las gafas v6–v8 en el dispositivo, las fotos de las cámaras, la sala anotada por Meta, ni el estado real de la base de datos más allá de lo ya ejecutado.

## Corregido durante la auditoría

- **Muebles del escaneo fuera de la sala.** Las cajas se pegaban a la pared pasándose unos centímetros y la app las marcaba como «fuera de los límites». Ahora quedan 3 cm dentro.
- **Muebles fundidos en un bloque.** Un salón con sofás y mesas salía como una caja de 4,3 × 4,5 m. Los grupos grandes y poco densos se parten en zonas de 1,5 m (de 6 cajas a 14 con el escaneo real).
- **Escaneo manipulado.** Un escaneo de 90 bytes con índices enormes bloqueaba el navegador 11 s y consumía 1 GB. Ahora se valida antes de reservar memoria.
- **Salones grandes.** Por encima de unos 1.200 m² de suelo visto, la importación fallaba. Probado ahora con 50 × 30 m.
- **App de las gafas v8.** Una sola petición de permisos (antes la de cámara podía perderse), sin reintentos de foto en cada fotograma, la recarga de la sala no reabre el escaneo de Meta, y los permisos de cámara se escriben en el manifiesto sin depender de una pieza que podía no compilar.

## Actualización del 15 de noviembre (prueba real en Quest 3S, escaneos 635310 y 358844)

- **Medidas:** el usuario las ha contrastado en la sala y son aproximadamente correctas (criterio acordado: unos 20 cm).
- **Sala de Meta nueva:** tras borrar el historial del espacio físico de las gafas solo queda la sala escaneada.
- **Salas no rectangulares:** la web perdía paredes, puertas y ventanas; ahora usa toda la habitación de Meta (17 paredes, 5 puertas y 3 ventanas en el caso real).
- **Fotos:** funcionan con el componente PassthroughCameraAccess (v10); 28 fotos en color con la posición y la calibración de la cámara.
- **Paredes con foto:** cada pared se pinta proyectando las fotos; comprobado dibujando las puertas y cuadros de Meta sobre las fotos.
- **Muebles:** Meta tiene pocas etiquetas; se afinan por tamaño y se corrigen con «Convertir en…». Colorearlos con las fotos se probó y se descartó: tomaba el color del suelo.
- **Pendiente:** el nombre de la sala desde el teclado de las gafas llega vacío.

## Estado por áreas

- **Diseño de eventos en la web** (montajes, programa por fases, aforo, accesibilidad, exportaciones): sólido. Es la parte más probada.
- **Cuentas de hotel y sincronización:** funciona, con riesgos conocidos (ver P1).
- **Gafas por navegador** (ver el montaje en realidad mixta, medir): funciona en simulador; en gafas reales, probado el medido con la sala de Meta.
- **App nativa de escaneo:** el escaneo caminando funciona en Quest 3S (dos escaneos reales). La reconstrucción da la forma general pero no es exacta; fotos y sala de Meta están sin probar.
- **Aspecto realista de la sala:** es la mayor carencia. Hoy solo se consigue con un escaneo del iPhone (Gaussian splatting).

## Plan de mejora

### P0 · Esta semana (bloquean o comprometen datos)

1. **Revocar las dos claves compartidas en el chat.** La clave secreta `sb_secret_…` salta todas las protecciones de la base de datos y el token `sbp_…` da control total del proyecto. No están en el repositorio. *(Lo hace el propietario en Supabase.)*
2. **Códigos de escaneo adivinables.** Con 6 cifras y sin límite de intentos, cualquiera puede recorrer todos los códigos en dos horas, llevarse los escaneos y las fotos de interiores, y borrarlos. Solución: código de 8 caracteres, clave propia para las fotos y límite de intentos.
3. **La base de datos se puede llenar desde fuera.** Las fotos del escaneo no se borran nunca, y hay tres vías antiguas de subida sin límite (`ws_push`, la tabla `shares` y el almacén público `mice-assets`). En el plan gratuito, al llenarse deja de funcionar todo, también la sincronización de los hoteles. Solución: borrar lo que no se usa, poner límites de tamaño y limpieza programada.
4. **Probar la app de las gafas v8** y cerrar el ciclo: sala anotada por Meta → muebles con nombre en la web.
5. **Site URL y recuperación de contraseña.** La web no gestiona el enlace de «he olvidado la contraseña».

### P1 · Antes de enseñarlo a un hotel

6. **Sincronización robusta.** Un dispositivo con la fecha mal puesta puede dejar un proyecto imposible de actualizar y parar la sincronización de todo el hotel. Solución: contador del servidor en vez de la hora del dispositivo, y rechazar fechas futuras.
7. **Permisos de dispositivos emparejados.** Unas gafas emparejadas «para un proyecto» pueden leer todos los proyectos del hotel, incluidas listas de invitados con alergias. Quitar a un miembro no anula los códigos que creó.
8. **Propuestas publicadas.** No se pueden retirar ni caducan, y pueden llevar datos personales de invitados. Añadir «retirar enlace» y caducidad.
9. **Fotos de las paredes desde las gafas.** Con la primera foto real se calibra la cámara y se pegan en las paredes de la sala.
10. **Reconstrucción de la sala más exacta.** Con dos escaneos reales la forma sale con 16 lados; hay que contrastarla con medidas reales y con la sala de Meta, y elegir la mejor de las dos fuentes por pared.
11. **«Convertir en…»** para cambiar un bloque sin identificar por un mueble del catálogo.
12. **Importar proyectos con seguridad.** Un archivo importado puede sustituir un proyecto existente del hotel; asignar siempre un identificador nuevo y validar el contenido.

### P2 · Calidad y TFG

13. **Tiempos de montaje reales.** Los minutos por pieza del programa son una estimación; calibrarlos con datos de un hotel.
14. **Evaluación con usuarios** (SUS/TAM) con el registro de uso ya incorporado.
15. **Peso de la web.** El archivo principal ocupa 1,5 MB (445 kB comprimido); separar el editor 3D de la pantalla de inicio.
16. **Dominio propio.** En `github.io` las sesiones se guardan en un origen compartido con otros proyectos de la misma cuenta.
17. **Actualizar dependencias** (`vite`, `vitest`, `@react-three/drei`).
18. **Pruebas automáticas de la nube** contra una base de datos de pruebas, y medir la cobertura.
19. **Publicar la app de las gafas** como archivo instalable, para no depender de Unity en cada cambio.

## Riesgos que conviene tener presentes

- La app de las gafas se escribe sin poder compilarla: cada versión nueva puede traer un error que solo se ve en el PC del usuario.
- La precisión de la Quest 3S (sin sensor de profundidad) no está medida contra un plano. Para aforo y evacuación, la referencia sigue siendo el plano o el iPhone con LiDAR.
- El plan gratuito de Supabase limita almacenamiento y tráfico; con fotos y escaneos reales se puede agotar.
