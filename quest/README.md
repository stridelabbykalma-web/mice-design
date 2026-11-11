# MICE Scan (app nativa para Meta Quest 3 / 3S)

App pequeña de Unity que solo escanea: se camina por la sala, la app lanza rayos contra el mapa de profundidad de las gafas y acumula en una rejilla el suelo visto, las paredes y lo que ocupa sitio. Al terminar sube el resultado y enseña un código de 6 cifras; en la web (*Espacio → Escaneo de la app de las gafas*) se escribe el código y aparece la sala con sus muebles. La planta se reconstruye en la web con el mismo algoritmo del escaneo caminando (`src/lib/walkScan.ts`).

## Montaje del proyecto (Unity 6.6, Meta XR SDK 209)

1. Proyecto *Universal 3D*, perfil de compilación **Meta Quest** con *Development Build*, paquetes *OpenXR Plugin*, *Meta XR Core SDK* y *Meta MR Utility Kit*.
2. *Building Blocks*: **Camera Rig**, **Passthrough** y **Occlusion** (este último activa el mapa de profundidad).
3. Copiar `MiceScan.cs` a `Assets/`, crear un objeto vacío en la escena y añadirle el componente *Mice Scan*.
4. *Project Setup Tool → Fix All* y *Build And Run* con las gafas conectadas por USB.

## Mandos

Gatillo: terminar y subir · B o Y: empezar de nuevo · A o X: mostrar u ocultar los puntos verdes.

## Estado

Escrito sin poder compilarlo ni probarlo en gafas: los errores de compilación se corrigen sobre la marcha.
