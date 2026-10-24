import SwiftUI

struct NotesListView: View {
    @EnvironmentObject var auth: AuthManager
    @ObservedObject private var health = HealthSync.shared
    @State private var notes: [FieldNote] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var path: [FieldNote] = []
    @State private var showNewTrip = false
    @State private var showStravaImport = false
    @AppStorage("homeShowsMap") private var showsMap = false
    @AppStorage("mapLayer") private var mapLayer: MapLayer = .standard
    @State private var selectedRouteIds: [String] = []
    @State private var mapControls = MapControls()

    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)

    var filtered: [FieldNote] {
        guard !searchText.isEmpty else { return notes }
        return notes.filter { $0.title.localizedCaseInsensitiveContains(searchText) }
    }

    var body: some View {
        NavigationStack(path: $path) {
            Group {
                if isLoading {
                    ProgressView()
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .background(sand)
                } else if let msg = errorMessage {
                    ContentUnavailableView(msg, systemImage: "exclamationmark.triangle")
                } else if filtered.isEmpty {
                    ContentUnavailableView(
                        searchText.isEmpty ? "No field notes yet" : "No results",
                        systemImage: "map",
                        description: Text(searchText.isEmpty
                            ? "Tap + to add a trip from a GPX file or Strava."
                            : "Try a different search term.")
                    )
                    .background(sand)
                } else if showsMap {
                    fullScreenMap
                } else {
                    List(filtered) { note in
                        NavigationLink(value: note) {
                            NoteRow(note: note)
                        }
                        .listRowBackground(sand)
                        .listRowSeparatorTint(border)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                    .background(sand)
                }
            }
            .navigationTitle("Field Notes")
            .toolbar(showsMap && !isLoading ? .hidden : .visible, for: .navigationBar)
            .navigationDestination(for: FieldNote.self) { note in
                NoteDetailView(note: note)
            }
            .searchable(text: $searchText, prompt: "Search")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    NavigationLink { SettingsView() } label: {
                        Image(systemName: "gearshape")
                    }
                    .accessibilityLabel("Settings")
                }
                ToolbarItem(placement: .principal) {
                    ViewModeToggle(showsMap: $showsMap)
                }
                ToolbarItem(placement: .primaryAction) {
                    createMenu { Image(systemName: "plus") }
                }
                // Map mode puts its buttons in the bottom toolbar beside search,
                // which the iPhone Duo shows in its right-hand sidebar.
                if showsMap {
                    ToolbarItemGroup(placement: .bottomBar) {
                        createMenu { Image(systemName: "plus") }
                        Menu {
                            Picker("Map layer", selection: $mapLayer) {
                                ForEach(MapLayer.allCases) { Text($0.name).tag($0) }
                            }
                        } label: {
                            Image(systemName: "square.3.layers.3d")
                        }
                        .accessibilityLabel("Map layer")
                        Button { mapControls.locateRequest += 1 } label: {
                            Image(systemName: "location")
                        }
                        .accessibilityLabel("Show my location")
                        Button { mapControls.is3D.toggle() } label: {
                            Text(mapControls.is3D ? "2D" : "3D").font(.system(size: 14, weight: .bold))
                        }
                        .accessibilityLabel(mapControls.is3D ? "Flat map" : "3D map")
                    }
                    // With custom bottom-bar items, iOS only keeps search there
                    // when asked to.
                    ToolbarSpacer(.fixed, placement: .bottomBar)
                    DefaultToolbarItem(kind: .search, placement: .bottomBar)
                }
            }
            .background(sand.ignoresSafeArea())
            .refreshable { await loadNotes() }
            .sheet(isPresented: $showNewTrip) {
                TripFormView(onSaved: added)
            }
            .sheet(isPresented: $showStravaImport) {
                StravaImportView(onSaved: added)
            }
            // Like the web heat map popup: every trip under the tap.
            .sheet(isPresented: Binding(
                get: { !selectedRouteIds.isEmpty },
                set: { if !$0 { selectedRouteIds = [] } }
            )) {
                RoutePickerSheet(notes: notes.filter { selectedRouteIds.contains($0.id) }) { note in
                    selectedRouteIds = []
                    path = [note]
                }
            }
        }
        .task { await loadNotes() }
        .onChange(of: health.importedCount) { Task { await loadNotes() } }
    }

    // MARK: Map mode

    /// Edge-to-edge heat map with the view toggle floating on it.
    private var fullScreenMap: some View {
        TrailMap(
            routes: filtered.map { TrailRoute(id: $0.id, coordinates: $0.mapCoordinates) },
            heat: true,
            layer: mapLayer,
            controls: $mapControls,
            onSelectRoutes: { selectedRouteIds = $0 }
        )
        .ignoresSafeArea()
        .overlay(alignment: .top) {
            ViewModeToggle(showsMap: $showsMap)
                .padding(2)
                .background(.regularMaterial, in: Capsule())
                .padding(.top, 8)
        }
    }

    // Same two entries as the web dashboard's Create dropdown.
    private func createMenu<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Menu {
            Button { showNewTrip = true } label: {
                SwiftUI.Label("New trip", systemImage: "square.and.pencil")
            }
            Button { showStravaImport = true } label: {
                SwiftUI.Label("Import from Strava", systemImage: "square.and.arrow.down")
            }
        } label: {
            label()
        }
        .accessibilityLabel("Create")
    }

    private func added(_ note: FieldNote) {
        notes.insert(note, at: 0)
        path = [note]
    }

    private func loadNotes() async {
        if notes.isEmpty { isLoading = true }
        errorMessage = nil
        do {
            notes = try await API.get("/api/field-notes?sortOrder=recent")
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }
}

// MARK: - List / map toggle

private struct ViewModeToggle: View {
    @Binding var showsMap: Bool

    var body: some View {
        Picker("View", selection: $showsMap) {
            Image(systemName: "list.bullet").tag(false).accessibilityLabel("List")
            Image(systemName: "map").tag(true).accessibilityLabel("Map")
        }
        .pickerStyle(.segmented)
        .frame(width: 110)
    }
}

// MARK: - Map selection

private struct RoutePickerSheet: View {
    let notes: [FieldNote]
    var onOpen: (FieldNote) -> Void

    private let sand = Color(red: 245/255, green: 240/255, blue: 232/255)

    var body: some View {
        NavigationStack {
            List(notes) { note in
                Button { onOpen(note) } label: {
                    HStack {
                        NoteRow(note: note)
                        Spacer()
                        Image(systemName: "chevron.right").foregroundColor(.secondary)
                    }
                }
                .buttonStyle(.plain)
                .listRowBackground(sand)
            }
            .listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(sand)
            .navigationTitle(notes.count == 1 ? "1 trip" : "\(notes.count) trips here")
            .toolbarTitleDisplayMode(.inline)
        }
        .presentationDetents(notes.count > 2 ? [.medium, .large] : [.height(200), .medium])
    }
}

// MARK: - Row

struct NoteRow: View {
    let note: FieldNote

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            // Type badges
            HStack(spacing: 5) {
                ForEach(note.tripType.prefix(2), id: \.self) { type in
                    Text(type.capitalized)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(border)
                        .cornerRadius(4)
                }
            }

            Text(note.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(ink)

            HStack(spacing: 6) {
                Text(note.formattedDate)
                if let dist = note.distance {
                    Text("·"); Text(String(format: "%.1f mi", dist))
                }
                if let elev = note.elevationGain {
                    Text("·"); Text("\(Int(elev)) ft")
                }
            }
            .font(.system(size: 12))
            .foregroundColor(muted)
        }
        .padding(.vertical, 4)
    }
}

#Preview {
    NotesListView().environmentObject(AuthManager.shared)
}
