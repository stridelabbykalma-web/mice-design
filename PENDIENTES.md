# Pendientes de MICE Design

## 1. Tareas del TFG

### Puesta en marcha
- [x] Activar GitHub Pages (publicado en https://stridelabbykalma-web.github.io/mice-design/).
- [ ] Instalar MICE Capture en el iPhone 16 Pro desde un Mac con Xcode (`ios/MICECapture/README.md`) y corregir los errores de compilación que aparezcan.
- [ ] Probar en el iPhone real la captura de paredes con la cámara, la medición con foto, la importación de RoomPlan y la realidad aumentada (USDZ).
- [ ] Probar el modo gafas en unas Meta Quest 3 (o 3S): realidad mixta con alineación por esquinas y realidad virtual.
- [ ] Probar «Medir esta sala con las gafas» en una sala real: comparar las medidas con el plano, comprobar que al volver a entrar el montaje aparece en su sitio (anclaje) y hasta qué tamaño de salón llega el escaneo de la Quest 3S.

### Nube (Supabase)
- [ ] Revocar la clave secreta `sb_secret_…` que se compartió en el chat y generar otra (no hace falta en la app).
- [x] Ejecutar `supabase/schema.sql` y poner la *Project URL* en `src/lib/cloud.ts`.
- [ ] En Supabase: *Authentication → Sign In / Providers*: activar «Allow anonymous sign-ins» (gafas) y decidir si se pide confirmar el correo.
- [ ] En Supabase: *Authentication → URL Configuration*: Site URL = `https://stridelabbykalma-web.github.io/mice-design/` (ahora es localhost:3000).
- [ ] Borrar el token personal `sbp_…` usado para la instalación.
- [ ] Crear la cuenta del hotel, emparejar las Quest con «🥽 Ver en gafas» y probar el directo en la sala.
- [ ] Probar con el iPhone real: emparejar por QR y capturar fotos desde el móvil.

### Caso práctico (OE6)
- [ ] Elegir 1 o 2 salas reales y pedir permiso al hotel por escrito.
- [ ] Medir cada sala con MICE Capture (LiDAR) e importar la medición.
- [ ] Capturar el aspecto real: fotos de paredes, suelo y techo desde la app, o escaneo 3D completo.
- [ ] Escanear con el Revopoint Inspire 2 al menos la silla y la mesa de banquete del hotel (simplificar la malla antes de exportar).
- [ ] Fotografiar los cuadros reales y marcar las salidas de emergencia reales.
- [ ] Introducir los precios reales del hotel.
- [ ] Sustituir el escaneo simulado del ejemplo por el real.

### Evaluación con usuarios (OE7)
- [ ] Revisar el texto del SUS palabra por palabra con Sevilla-González et al. (2020).
- [ ] Definir la muestra (por ejemplo, 5–8 personas del hotel y 5–8 clientes u organizadores).
- [ ] Preparar el consentimiento informado (RGPD) y el guion de tareas.
- [ ] Realizar las pruebas y exportar el CSV al terminar cada sesión.
- [ ] Pregunta P4: comparar el mismo evento con mobiliario genérico y con mobiliario escaneado (ítems FR1–FR3).

### Memoria
- [ ] Capítulo 6: arquitectura y tecnologías (README) y capturas de la app.
- [ ] Capítulos 7 y 8: resultados SUS/TAM, tabla de precisión de la medición con foto y comparación de las vías de creación del espacio (P3).

## 2. Mejoras de la app

Elegidas:
- [x] Catálogo del hotel compartido entre proyectos: mobiliario escaneado, salas reutilizables y **mesas decoradas** guardadas como plantilla (cada pieza sigue siendo editable).
- [x] Varias propuestas por evento (A, B, C) para comparar montajes.
- [x] Compartir la propuesta con el cliente por enlace, con comentarios (falta la URL de Supabase).
- [x] Sincronizar proyectos y catálogo entre ordenador y móvil por QR (falta la URL de Supabase).
- [x] Salas con cualquier forma (polígono).
- [x] Gaussian splatting para un realismo casi fotográfico.
- [x] Plano de mesas con invitados (importación CSV).
- [x] Inglés como idioma opcional en lo que ve el cliente (vista cliente, propuesta, comparación y plano de mesas); el editor sigue en español.

Descartadas o aplazadas:
- PDF real de la orden de montaje (se mantiene la impresión del navegador).
- Ver el montaje en RA en el iPhone (AR Quick Look), evacuación con búsqueda de caminos, pruebas automáticas y RA en Android: sin decidir.

## 3. Hecho después de la lista inicial

- [x] Rendimiento: sillas agrupadas (teatro de 675 sillas: 4.046 → 16 órdenes de dibujo), dibujo bajo demanda, escaneos ligeros.
- [x] Realidad aumentada en iPhone/iPad (USDZ) y modo gafas WebXR (realidad mixta y virtual).
- [x] Pruebas automáticas (35) ejecutadas en GitHub Actions antes de publicar.
- [x] Plano en DXF, comprobación de accesibilidad y registro automático de uso en las pruebas.
- [x] Realidad mixta más realista: sombras sobre el suelo real, luz neutra, reflejos y más nitidez.
- [x] Programa del evento por fases según el tipo de evento, con cambios de montaje (personal y tiempo) y avisos.
- [ ] Ajustar con el hotel los minutos de montaje por pieza y su personal habitual.
- [x] Cuentas de hotel con inicio de sesión y roles; gafas y móviles emparejados con código; diseño en el ordenador visto en directo en las gafas.

## 4. Ideas para más adelante

- Opción de pasillo accesible de 1,20 m en los montajes automáticos.
- Medición con realidad aumentada en Android (WebXR) y oclusión por profundidad en Quest 3.
