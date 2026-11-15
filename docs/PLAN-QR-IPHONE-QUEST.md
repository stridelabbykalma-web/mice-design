# Escaneo con iPhone y colocación en las gafas con códigos QR

*15 de noviembre de 2026 · investigación, resultado esperado, limitaciones y plan*

## La idea en una frase

El **iPhone** hace el modelo bueno de la sala una sola vez. En la sala se pegan **dos códigos QR**, y las **Quest** los leen para colocar el montaje exactamente encima de la sala real.

## Qué dice la investigación

**Las Quest leen QR de forma nativa** ([documentación de Meta](https://developers.meta.com/horizon/documentation/unity/unity-mr-utility-kit-qrcode-detection), [ejemplo oficial](https://developers.meta.com/horizon/documentation/unity/unity-sample-mruk-qr-code)):
- Quest 3 y 3S, con Meta XR Core SDK y MR Utility Kit v83 o superior. El proyecto MICEScan usa la v209.
- Por cada código detectado da su posición y orientación en 3D y su contenido (`MRUKTrackable.MarkerPayloadString`).
- Se activa en el componente MRUK: *Scene Settings → Tracker Configuration → QR Code Tracking Enabled*. Se escucha el evento `TrackableAdded` y se comprueba `TrackableType == OVRAnchor.TrackableType.QRCode`.
- Necesita el permiso de **datos espaciales**, que la app ya pide, con *Scene Support* y *Anchor Support* activados. No necesita el permiso de cámara.
- Condiciones de Meta: códigos «relativamente grandes y cerca», buena luz, sin logotipos en el código, sin micro‑QR, versión 10 como máximo.
- La posición se actualiza a menor ritmo que la imagen: sirve para cosas fijas, no para objetos en movimiento.

**Lo que no está publicado:** precisión en milímetros, distancia máxima de lectura y tamaño mínimo del código. Hay que medirlo.

**Avisos de otros desarrolladores** ([foro de Meta](https://communityforums.atmeta.com/discussions/Questions_Discussions/mruk-qr-tracking-suddenly-not-working/1372456)):
- La detección dejó de funcionar tras una actualización del sistema de las gafas.
- Funcionaba en unas gafas y no en otras con distinta versión del sistema.

Es una función nueva y conviene tener una alternativa manual.

**Por qué QR y no los «puntos clave» del iPhone:**
- El mapa de puntos de ARKit es un formato de Apple que las Quest no pueden leer ([Apple](https://developer.apple.com/forums/thread/831943)).
- Registrar una cámara contra un escaneo LiDAR de otro aparato dio errores de 18 a 230 m en una tesis de la TU Wien ([tesis](https://www.cg.tuwien.ac.at/research/publications/2025/miklautsch_florian-baa/miklautsch_florian-baa-thesis.pdf)).
- Para salas de 7 a 10 m, en el foro de Meta recomiendan marcadores porque los anclajes compartidos se desvían ([foro](https://communityforums.atmeta.com/discussions/Questions_Discussions/best-method-for-lbe-world-alignment-on-quest-3-shared-spatial-anchors-vs-qr-cali/1371034)).
- Los estudios de realidad mixta entre Quest y móviles usan alineación por uno o dos puntos conocidos ([Glasgow](https://eprints.gla.ac.uk/224062/1/224062.pdf)).

**Sobre el iPhone:**
- Scaniverse exporta en `.ply` y `.spz` ([App Store](https://apps.apple.com/us/app/-/id1541433223), [formato SPZ](https://scaniverse.com/news/spz-gaussian-splat-open-source-file-format)). La web ya los importa.
- No hay datos publicados sobre si la **escala** es exacta. Los propios QR lo resuelven: si se conoce la distancia real entre ellos, la escala del escaneo se corrige sola.

## Cómo sería el resultado

**Una vez por sala** (unos 10 minutos):
1. Se imprimen dos hojas A4 con un QR grande (unos 18 × 18 cm) y una cruz de referencia. La web las genera con el nombre de la sala.
2. Se pegan en dos paredes lo más separadas posible, a la altura de los ojos. Se dejan fijas o se marca su sitio.
3. Se escanea la sala con el iPhone (Scaniverse) y se sube a la web.
4. En la web se hace clic sobre cada hoja en el escaneo 3D. La web calcula giro, posición y escala.

**En cada visita con las gafas:**
1. Se abre la app *MICE* en las Quest y se elige el evento, o se escribe su código.
2. Se mira cada QR unos segundos. El montaje aparece **colocado solo**: mesas, sillas, escenario y decoración, a tamaño real.
3. Las personas y los muebles reales **tapan** a los virtuales, porque la app usa el mapa de profundidad.
4. **No hay círculo de límite**, así que se puede recorrer el salón.
5. Si en el ordenador se mueve una mesa, en las gafas cambia en unos segundos.
6. La segunda vez, las gafas se colocan solas aunque se hayan quitado los QR: guardan un anclaje.

**Precisión esperada.** Es una estimación que hay que medir en la fase 0: **2 a 5 cm** cerca de los códigos, y algo más en el extremo opuesto de un salón grande. Cuanto más separados estén los dos QR, menos error de giro.

## Limitaciones

| Limitación | Consecuencia | Qué se hace |
|---|---|---|
| La lectura de QR solo existe en apps nativas, no en el navegador | El modo gafas actual de la web no puede leerlos | La app nativa enseña el montaje; en la web queda una alternativa manual (tocar cada hoja con el mando) |
| Función nueva, con fallos tras actualizaciones según el foro de Meta | Puede dejar de funcionar sin aviso | Alternativa manual y anclaje guardado |
| Precisión no publicada | Puede no llegar a lo esperado | Fase 0: medirla antes de invertir más |
| Los QR deben estar en el mismo sitio que en el escaneo | Si alguien mueve una hoja, el montaje se desplaza | Placas fijas pequeñas o su sitio marcado. Al aparecer el montaje, la app comprueba que la distancia entre los dos QR coincide |
| Buena luz y QR grandes | En salones a oscuras puede no leerlos | Luz de trabajo durante la colocación (solo unos segundos) |
| Solo Quest 3 y 3S | Quest 2 y Pro no leen QR | Esas gafas usarían la alternativa manual |
| Instalación por cable en cada par de gafas | Cada hotel necesita instalarla | Para el TFG basta; publicarla en la tienda de Meta requiere su revisión |
| El escaneo del iPhone pesa mucho para las gafas | Verlo en las gafas puede ir lento | En realidad mixta no hace falta: se ve la sala real y solo se dibuja el montaje |
| No puedo compilar la app nativa | Cada cambio necesita una vuelta con tu PC | Fases pequeñas y diagnóstico automático, como hasta ahora |

## Plan

Cada fase termina en algo que se puede probar. Las estimaciones son en sesiones de trabajo e incluyen las vueltas de compilación.

### Fase 0 · ¿Funciona la lectura de QR en tus Quest 3S? (1 sesión)
- MICE Scan v9: activar la lectura de QR y enviar en el diagnóstico el contenido, la posición y la orientación de cada código.
- Prueba: dos QR impresos a una distancia medida con cinta métrica, por ejemplo 5,00 m. Se compara la distancia que dan las gafas, en 5 lecturas.
- **Decisión:** con un error menor de 3 cm se sigue; si es mayor, se replantea (QR más grandes, tres en vez de dos, o la vía manual).

### Fase 1 · Marcadores en la web (1 sesión)
- Panel **Espacio → Marcadores de la sala**: genera un PDF para imprimir con el QR (contenido `MICE:<sala>:A` y `:B`), la cruz, el tamaño impreso correcto y las instrucciones.
- Colocar A y B haciendo clic sobre el escaneo 3D (iPhone) o sobre una pared del plano, y guardar su posición y altura en el proyecto.
- Si se conoce la distancia real entre A y B, corregir la escala del escaneo del iPhone.

### Fase 2 · Alternativa manual en la web (1 sesión)
- En el modo gafas de la web: «toca la cruz de la hoja A con la punta del mando y pulsa el gatillo; ahora la B». Alinea igual que la app nativa.
- Funciona en cualquier Quest, sin instalar nada. Es más precisa que marcar las esquinas del suelo con el rayo, como hasta ahora.

### Fase 3 · App nativa que enseña el montaje (2–3 sesiones)
- La web publica, al pulsar **«Ver en gafas»**, un `.glb` del montaje (ya existe *Exportar → Modelo 3D del evento*) y la posición de los marcadores.
- La app (mismo proyecto Unity) pide el código, descarga el `.glb` y lo carga con el paquete glTFast. Lee los dos QR, alinea y guarda un anclaje.
- Oclusión con el mapa de profundidad y sin límite de seguridad (ya probado en MICE Scan).

### Fase 4 · Cambios en directo (1 sesión)
- La app consulta cada pocos segundos si hay una versión nueva del montaje y la recarga. Mantiene la colocación.

### Fase 5 · Validación para el TFG (1 sesión)
- En una sala real: medir con cinta el error en 4 puntos del montaje, el tiempo de colocación y la tasa de lectura de los QR con distintas luces.
- Comparar con los otros métodos ya hechos: esquinas con el mando, encaje con paredes y escaneo con las gafas.
- Redactar los resultados para la memoria.

**Total estimado: 7 a 9 sesiones.** Las fases 1 y 2 no dependen de Unity y se pueden hacer en paralelo con la fase 0.

### Antes de empezar (pendiente del plan general)
Revocar las claves compartidas y cerrar los problemas de seguridad urgentes de `docs/PLAN-MEJORA.md`. La fase 3 publica montajes con datos del evento.
