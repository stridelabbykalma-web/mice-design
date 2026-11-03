# MICE Capture (app de refuerzo para iPhone/iPad Pro)

Escanea la sala con el LiDAR (RoomPlan de Apple) y exporta un archivo `.mice-room.json` con paredes, puertas, ventanas y huecos. En MICE Design: **Espacio → Medición con iPhone Pro → Importar medición**.

## Requisitos

- iPhone o iPad **con LiDAR** (iPhone 12 Pro o posterior en gama Pro; por ejemplo, iPhone 16 Pro) con iOS 17 o superior.
- Un **Mac con Xcode** (gratuito en la App Store) para compilarla e instalarla en el iPhone. Basta con un Apple ID gratuito; en ese caso la app caduca a los 7 días y hay que volver a instalarla desde Xcode.

## Instalar en el iPhone

1. En Xcode: *File → New → Project → iOS → App*. Nombre `MICECapture`, interfaz **SwiftUI**, lenguaje **Swift**.
2. Borra el `ContentView.swift` y el `MICECaptureApp.swift` que crea Xcode y arrastra al proyecto los cuatro archivos `.swift` de esta carpeta.
3. En *Target → General*, pon **Minimum Deployments: iOS 17.0**.
4. En *Target → Info*, añade la clave **Privacy - Camera Usage Description** (`NSCameraUsageDescription`) con el texto: «MICE Capture usa la cámara y el LiDAR para medir la sala».
5. En *Target → Signing & Capabilities*, marca *Automatically manage signing* y elige tu Apple ID como *Team*.
6. Conecta el iPhone por cable, selecciónalo arriba en Xcode y pulsa ▶ (Run).
7. La primera vez, en el iPhone: *Ajustes → General → VPN y gestión de dispositivos* → confía en tu Apple ID. Y activa *Ajustes → Privacidad y seguridad → Modo de desarrollador*.

## Uso

1. Abre MICE Capture → **Escanear sala**. Recorre la sala despacio apuntando a paredes, esquinas, puertas y ventanas.
2. **Terminar** → revisa el resultado → **Guardar medición**.
3. **Enviar a MICE Design**: por AirDrop al ordenador, a Archivos o por correo, y en MICE Design pulsa *Importar medición*.

## Qué hace MICE Design con el archivo

- Endereza la sala respecto a la pared más larga y calcula ancho, fondo y altura.
- Coloca las puertas, huecos y ventanas en su pared, con su ancho, alto y altura de alféizar reales.
- Los tramos de pared que no están en el contorno (salas en L, entrantes) se añaden como tabiques.
- Después hay que indicar qué puertas son salidas de emergencia.

> Este código no se ha podido compilar en el entorno en el que se escribió (no había macOS ni Xcode). Si Xcode muestra algún error, cópialo tal cual para corregirlo.
