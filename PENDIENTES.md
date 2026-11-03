# Pendientes de MICE Design

## 1. Tareas del TFG

### Puesta en marcha
- [ ] Activar GitHub Pages: *Settings → Pages → Source: GitHub Actions*, y relanzar el flujo en *Actions → Publicar en GitHub Pages → Re-run jobs*.
- [ ] Instalar MICE Capture en el iPhone 16 Pro desde un Mac con Xcode (`ios/MICECapture/README.md`) y corregir los errores de compilación que aparezcan.
- [ ] Probar en el iPhone real la captura de paredes con la cámara, la medición con foto y la importación de RoomPlan.

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
- [ ] Compartir la propuesta con el cliente por enlace, con comentarios (requiere un backend, por ejemplo Supabase; pendiente de crear la cuenta).
- [x] Salas con cualquier forma (polígono).
- [x] Gaussian splatting para un realismo casi fotográfico.
- [x] Plano de mesas con invitados (importación CSV).
- [x] Inglés como idioma opcional en lo que ve el cliente (vista cliente, propuesta, comparación y plano de mesas); el editor sigue en español.

Descartadas o aplazadas:
- PDF real de la orden de montaje (se mantiene la impresión del navegador).
- Ver el montaje en RA en el iPhone (AR Quick Look), evacuación con búsqueda de caminos, pruebas automáticas y RA en Android: sin decidir.

## 3. Rendimiento (sin decidir)

1. Dibujar sillas y mesas agrupadas (instancing): solo cambia cómo se dibujan, cada pieza sigue siendo editable.
2. Dibujar solo cuando algo cambia (`frameloop="demand"`).
3. Optimizar los escaneos al importarlos (menos triángulos y texturas de 2K en móvil).
4. Sombras más baratas.
5. Calidad automática según el dispositivo.
6. Comprobación de seguridad con rejilla espacial y sin recalcular durante el arrastre.
7. Carga del código por partes.
