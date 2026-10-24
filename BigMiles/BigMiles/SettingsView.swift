import SwiftUI

struct SettingsView: View {
    @EnvironmentObject var auth: AuthManager
    @ObservedObject private var health = HealthSync.shared

    @State private var strava: StravaStatus?
    @State private var stravaBusy = false
    @State private var stravaError: String?
    @State private var confirmDisconnect = false

    private let sand  = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    var body: some View {
        Form {
            stravaSection
            healthSection

            Section {
                Button("Sign out", role: .destructive) { auth.logout() }
            }
        }
        .scrollContentBackground(.hidden)
        .background(sand.ignoresSafeArea())
        .navigationTitle("Settings")
        .toolbarTitleDisplayMode(.inline)
        .task { await loadStrava() }
        .confirmationDialog("Disconnect Strava?", isPresented: $confirmDisconnect, titleVisibility: .visible) {
            Button("Disconnect", role: .destructive) { Task { await disconnectStrava() } }
        } message: {
            Text("Trips you already imported stay. You can reconnect any time.")
        }
    }

    // MARK: - Strava

    private var stravaSection: some View {
        Section {
            HStack {
                Label("Strava", systemImage: "figure.run")
                Spacer()
                if strava == nil || stravaBusy {
                    ProgressView()
                } else {
                    Text(strava?.label ?? "").foregroundColor(muted)
                }
            }
            if let strava, !stravaBusy {
                if strava.connected {
                    Button("Disconnect Strava", role: .destructive) { confirmDisconnect = true }
                } else if strava.state == "disconnected" {
                    Button("Connect Strava") { Task { await connectStrava() } }
                }
            }
            if let stravaError {
                Text(stravaError).font(.system(size: 13)).foregroundColor(.red)
            }
        } header: {
            Text("Strava")
        } footer: {
            Text("Connected Strava activities show up under + › Import from Strava.")
        }
    }

    private func loadStrava() async {
        do {
            strava = try await API.get("/api/strava/status")
        } catch {
            stravaError = error.localizedDescription
        }
    }

    private func connectStrava() async {
        stravaBusy = true
        stravaError = nil
        defer { stravaBusy = false }
        do {
            struct AuthURL: Decodable { let url: String }
            let auth: AuthURL = try await API.get("/api/strava/auth-url")
            guard let url = URL(string: auth.url) else { return }
            // nil means the sheet was closed; just refresh the status.
            if let status = await WebAuth.start(url)?.queryValue("status"), status != "connected" {
                stravaError = status == "denied" ? "Strava access wasn't granted." : "Couldn't connect Strava."
            }
            await loadStrava()
        } catch {
            stravaError = error.localizedDescription
        }
    }

    private func disconnectStrava() async {
        stravaBusy = true
        defer { stravaBusy = false }
        do {
            try await API.delete("/api/strava/disconnect")
            await loadStrava()
        } catch {
            stravaError = error.localizedDescription
        }
    }

    // MARK: - Apple Health

    private var healthSection: some View {
        Section {
            Toggle(isOn: Binding(
                get: { health.isEnabled },
                set: { on in
                    if on { Task { await health.enable() } } else { health.disable() }
                }
            )) {
                Label("Import workouts", systemImage: "heart.fill")
            }
            .disabled(!health.isAvailable)

            if health.isEnabled {
                HStack {
                    Text("Imported").foregroundColor(muted)
                    Spacer()
                    Text("\(health.importedCount) workouts")
                }
                HStack {
                    Text("Last checked").foregroundColor(muted)
                    Spacer()
                    if health.isSyncing {
                        ProgressView()
                    } else {
                        Text(health.lastSync.map { $0.formatted(.relative(presentation: .named)) } ?? "Never")
                    }
                }
                Button("Check now") { Task { await health.sync() } }
                    .disabled(health.isSyncing)
            }
            if let error = health.lastError {
                Text(error).font(.system(size: 13)).foregroundColor(.red)
            }
        } header: {
            Text("Apple Health")
        } footer: {
            Text(health.isAvailable
                 ? "New workouts with a GPS route become trips automatically while the app is open or when you return to it. Workouts from before you turn this on aren't imported."
                 : "Apple Health isn't available on this device.")
        }
    }
}

struct StravaStatus: Decodable {
    let state: String
    let connected: Bool

    var label: String {
        switch state {
        case "connected":      return "Connected"
        case "not_configured": return "Unavailable"
        default:               return "Not connected"
        }
    }
}
