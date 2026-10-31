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
    @State private var showHealthImport = false
    /// The app always opens on the map.
    @State private var showsMap = true
    @AppStorage("mapLayer") private var mapLayer: MapLayer = .standard
    @State private var selectedRouteIds: [String] = []
    @State private var mapControls = MapControls()
    @AppStorage("mediaFilter") private var mediaFilter: MediaFilter = .all

    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)

    var filtered: [FieldNote] {
        notes.filter { note in
            switch mediaFilter {
            case .all: break
            case .photos: if !note.hasPhotos { return false }
            case .videos: if !note.hasVideos { return false }
            }
            return searchText.isEmpty || note.title.localizedCaseInsensitiveContains(searchText)
        }
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
                        notes.isEmpty ? "No field notes yet" : "No results",
                        systemImage: "map",
                        description: Text(notes.isEmpty
                            ? "Tap + to add a trip from a GPX file, Strava, or Apple Health."
                            : mediaFilter == .all
                                ? "Try a different search term."
                                : "No trips match “\(mediaFilter.label)”. Change the filter to see more.")
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
            // In map mode the bar stays (so the toggle sits where it does on the
            // list) but goes transparent over the edge-to-edge map.
            .toolbarTitleDisplayMode(showsMap ? .inline : .automatic)
            .toolbarBackground(showsMap ? .hidden : .automatic, for: .navigationBar)
            .navigationDestination(for: FieldNote.self) { note in
                NoteDetailView(note: note) {
                    // Back to the list or map, without the deleted trip.
                    notes.removeAll { $0.id == note.id }
                    path.removeAll { $0.id == note.id }
                }
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
                    MediaFilterMenu(filter: $mediaFilter)
                }
                if !showsMap {
                    ToolbarItem(placement: .primaryAction) {
                        createMenu { Image(systemName: "plus") }
                    }
                }
                // Map mode puts its buttons in the bottom toolbar beside search,
                // which the iPhone Duo shows in its right-hand sidebar.
                if showsMap {
                    ToolbarItemGroup(placement: .bottomBar) {
                        createMenu { Image(systemName: "plus") }
                        MapOptionsMenu(layer: $mapLayer, controls: $mapControls)
                        MapLocateToolbarButton(controls: $mapControls)
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
            .sheet(isPresented: $showHealthImport) {
                HealthImportView(onSaved: added)
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

    /// Edge-to-edge heat map under a transparent navigation bar.
    private var fullScreenMap: some View {
        TrailMap(
            routes: filtered.map { TrailRoute(id: $0.id, coordinates: $0.mapCoordinates) },
            heat: true,
            layer: mapLayer,
            controls: $mapControls,
            startAtUserLocation: true,
            onSelectRoutes: { selectedRouteIds = $0 }
        )
        .ignoresSafeArea()
    }

    // The web dashboard's Create dropdown, plus Apple Health.
    private func createMenu<Label: View>(@ViewBuilder label: () -> Label) -> some View {
        Menu {
            Button { showNewTrip = true } label: {
                SwiftUI.Label("New trip from GPX file", systemImage: "square.and.pencil")
            }
            Button { showStravaImport = true } label: {
                SwiftUI.Label("Import from Strava", systemImage: "square.and.arrow.down")
            }
            if HealthSync.shared.isAvailable {
                Button { showHealthImport = true } label: {
                    SwiftUI.Label("Import from Apple Health", systemImage: "heart")
                }
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

// MARK: - Media filter

/// Same choices as the web dashboard's Media filter.
enum MediaFilter: String, CaseIterable, Identifiable {
    case all, photos, videos
    var id: String { rawValue }
    var label: String {
        switch self {
        case .all: return "All trips"
        case .photos: return "Has photos"
        case .videos: return "Contains videos"
        }
    }
    var systemImage: String {
        switch self {
        case .all: return "square.stack"
        case .photos: return "photo"
        case .videos: return "video"
        }
    }
}

private struct MediaFilterMenu: View {
    @Binding var filter: MediaFilter

    var body: some View {
        Menu {
            Picker("Show", selection: $filter) {
                ForEach(MediaFilter.allCases) { option in
                    Label(option.label, systemImage: option.systemImage).tag(option)
                }
            }
        } label: {
            Image(systemName: filter == .all
                  ? "line.3.horizontal.decrease.circle"
                  : "line.3.horizontal.decrease.circle.fill")
        }
        .accessibilityLabel("Filter trips, \(filter.label)")
    }
}

// MARK: - List / map toggle

private struct ViewModeToggle: View {
    @Binding var showsMap: Bool

    var body: some View {
        Picker("View", selection: $showsMap) {
            Image(systemName: "map").tag(true).accessibilityLabel("Map")
            Image(systemName: "list.bullet").tag(false).accessibilityLabel("List")
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
                if note.hasVideos {
                    Text("·")
                    Label("\(note.videoCount ?? 0)", systemImage: "video.fill")
                        .labelStyle(.titleAndIcon)
                        .accessibilityLabel("\(note.videoCount ?? 0) videos")
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
