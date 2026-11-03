import Foundation
import RoomPlan
import simd

struct RoomExport {
    let url: URL
    let summary: String
}

/// Convierte CapturedRoom al formato que importa MICE Design (format "mice-roomplan", versión 1).
/// Cada superficie lleva sus dimensiones (ancho, alto, fondo en metros) y su matriz de
/// transformación 4×4 por columnas, en el sistema de coordenadas de ARKit (Y hacia arriba).
enum RoomExporter {
    static func matrix(_ t: simd_float4x4) -> [Float] {
        [t.columns.0, t.columns.1, t.columns.2, t.columns.3].flatMap { [$0.x, $0.y, $0.z, $0.w] }
    }

    static func surface(_ s: CapturedRoom.Surface) -> [String: Any] {
        ["dimensions": [s.dimensions.x, s.dimensions.y, s.dimensions.z], "transform": matrix(s.transform)]
    }

    static func export(_ room: CapturedRoom) throws -> RoomExport {
        let objects: [[String: Any]] = room.objects.map { o in
            ["category": String(describing: o.category),
             "dimensions": [o.dimensions.x, o.dimensions.y, o.dimensions.z],
             "transform": matrix(o.transform)]
        }
        let json: [String: Any] = [
            "format": "mice-roomplan",
            "version": 1,
            "createdAt": ISO8601DateFormatter().string(from: Date()),
            "walls": room.walls.map(surface),
            "doors": room.doors.map(surface),
            "windows": room.windows.map(surface),
            "openings": room.openings.map(surface),
            "objects": objects,
        ]
        let data = try JSONSerialization.data(withJSONObject: json, options: [.prettyPrinted])
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyyMMdd-HHmm"
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("sala-\(formatter.string(from: Date())).mice-room.json")
        try data.write(to: url)

        let height = room.walls.map(\.dimensions.y).max() ?? 0
        let summary = "\(room.walls.count) paredes · \(room.doors.count + room.openings.count) puertas o huecos · "
            + "\(room.windows.count) ventanas · altura \(String(format: "%.2f", height)) m"
        return RoomExport(url: url, summary: summary)
    }
}
