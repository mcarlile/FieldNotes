import SwiftUI

@main
struct BigMilesApp: App {
    @StateObject private var auth = AuthManager.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        HealthSync.shared.resume()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await HealthSync.shared.sync() } }
        }
    }
}
