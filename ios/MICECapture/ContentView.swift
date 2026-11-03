import SwiftUI
import RoomPlan

struct ContentView: View {
    @State private var scanning = false
    @State private var lastExport: URL?
    @State private var summary: String?
    @State private var errorText: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                Text("Escanea la sala del evento y envía sus medidas a MICE Design.")
                    .font(.body)
                    .foregroundStyle(.secondary)

                if RoomCaptureSession.isSupported {
                    Button {
                        scanning = true
                    } label: {
                        Label("Escanear sala", systemImage: "viewfinder")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                } else {
                    Label("Este dispositivo no tiene LiDAR. RoomPlan necesita un iPhone Pro o un iPad Pro.", systemImage: "exclamationmark.triangle")
                        .foregroundStyle(.orange)
                }

                if let summary {
                    GroupBox("Última medición") {
                        Text(summary).frame(maxWidth: .infinity, alignment: .leading)
                    }
                }

                if let lastExport {
                    ShareLink(item: lastExport) {
                        Label("Enviar a MICE Design (AirDrop, Archivos, correo…)", systemImage: "square.and.arrow.up")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                }

                if let errorText {
                    Text(errorText).foregroundStyle(.red)
                }

                Spacer()

                Text("Consejos: enciende todas las luces, recorre la sala despacio apuntando a paredes, esquinas, puertas y ventanas, y termina donde empezaste.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            .padding()
            .navigationTitle("MICE Capture")
            .fullScreenCover(isPresented: $scanning) {
                ScanView { result in
                    scanning = false
                    switch result {
                    case .some(.success(let saved)):
                        lastExport = saved.url
                        summary = saved.summary
                        errorText = nil
                    case .some(.failure(let error)):
                        errorText = error.localizedDescription
                    case .none:
                        break
                    }
                }
            }
        }
    }
}
