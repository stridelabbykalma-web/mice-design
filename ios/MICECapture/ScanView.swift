import SwiftUI
import RoomPlan

/// Pantalla de escaneo a pantalla completa con la vista de captura de RoomPlan.
struct ScanView: View {
    /// nil = cancelado
    let onFinish: (Result<RoomExport, Error>?) -> Void
    @StateObject private var model = ScanModel()

    var body: some View {
        ZStack {
            RoomCaptureRepresentable(model: model)
                .ignoresSafeArea()

            VStack {
                HStack {
                    Button("Cancelar") {
                        model.stop()
                        onFinish(nil)
                    }
                    .buttonStyle(.bordered)
                    Spacer()
                    if model.processing {
                        ProgressView("Procesando…")
                            .padding(8)
                            .background(.thinMaterial, in: Capsule())
                    } else if model.result == nil {
                        Button("Terminar") { model.stop() }
                            .buttonStyle(.borderedProminent)
                    }
                }
                .padding()
                Spacer()
                if model.result != nil {
                    Button {
                        if let room = model.result {
                            onFinish(Result { try RoomExporter.export(room) })
                        }
                    } label: {
                        Label("Guardar medición", systemImage: "checkmark.circle.fill")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .padding()
                }
            }
        }
        .onAppear { model.start() }
    }
}

/// Puente entre SwiftUI y RoomCaptureView (UIKit).
struct RoomCaptureRepresentable: UIViewRepresentable {
    let model: ScanModel
    func makeUIView(context: Context) -> RoomCaptureView { model.captureView }
    func updateUIView(_ uiView: RoomCaptureView, context: Context) {}
}

/// Gestiona la sesión de RoomPlan y recibe la sala procesada.
@MainActor
final class ScanModel: NSObject, ObservableObject, RoomCaptureViewDelegate {
    @Published var result: CapturedRoom?
    @Published var processing = false
    let captureView: RoomCaptureView

    override init() {
        captureView = RoomCaptureView(frame: .zero)
        super.init()
        captureView.delegate = self
    }

    // RoomCaptureViewDelegate hereda de NSCoding: estos dos métodos son obligatorios
    // aunque la app no los use.
    required nonisolated init?(coder: NSCoder) { fatalError("No se usa") }
    nonisolated func encode(with coder: NSCoder) {}

    func start() {
        captureView.captureSession.run(configuration: RoomCaptureSession.Configuration())
    }

    func stop() {
        processing = true
        captureView.captureSession.stop()
    }

    nonisolated func captureView(shouldPresent roomDataForProcessing: CapturedRoomData, error: Error?) -> Bool {
        true
    }

    nonisolated func captureView(didPresent processedResult: CapturedRoom, error: Error?) {
        Task { @MainActor in
            self.processing = false
            self.result = processedResult
        }
    }
}
