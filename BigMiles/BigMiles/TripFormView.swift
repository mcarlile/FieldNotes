import SwiftUI
import UniformTypeIdentifiers
import CoreLocation

/// Create a trip from a GPX file, or edit an existing one.
/// Same fields and payload as the web form at /admin.
struct TripFormView: View {
    let existing: FieldNote?
    var onSaved: (FieldNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title = ""
    @State private var date = Date()
    @State private var tripTypes: Set<String> = []
    @State private var description = ""
    @State private var gpx: GPXStats?
    @State private var gpxFilename: String?
    @State private var showImporter = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    init(existing: FieldNote? = nil, onSaved: @escaping (FieldNote) -> Void) {
        self.existing = existing
        self.onSaved = onSaved
        if let note = existing {
            _title = State(initialValue: note.title)
            _date = State(initialValue: note.parsedDate ?? Date())
            _tripTypes = State(initialValue: Set(note.tripType))
            _description = State(initialValue: note.description ?? "")
        }
    }

    private var canSave: Bool {
        !title.trimmingCharacters(in: .whitespaces).isEmpty && !tripTypes.isEmpty && !isSaving
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Route") {
                    Button {
                        showImporter = true
                    } label: {
                        Label(gpxFilename ?? (existing == nil ? "Choose GPX file" : "Replace GPX file"),
                              systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                    }
                    if let gpx {
                        RouteMapView(coordinates: gpx.coordinates.map {
                            .init(latitude: $0[1], longitude: $0[0])
                        })
                        .frame(height: 160)
                        .listRowInsets(EdgeInsets())
                        Text(String(format: "%.1f mi · %d ft gain", gpx.distance, Int(gpx.elevationGain)))
                            .font(.system(size: 13))
                            .foregroundColor(muted)
                    }
                }

                Section("Details") {
                    TextField("Title", text: $title)
                    DatePicker("Date", selection: $date, displayedComponents: .date)
                }

                Section("Activity") {
                    TripTypePicker(selection: $tripTypes)
                }

                Section("Notes") {
                    TextField("What happened out there?", text: $description, axis: .vertical)
                        .lineLimit(4...12)
                }

                if let errorMessage {
                    Section {
                        Text(errorMessage).foregroundColor(.red).font(.system(size: 14))
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(sand.ignoresSafeArea())
            .navigationTitle(existing == nil ? "New trip" : "Edit trip")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!canSave)
                    }
                }
            }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.gpx, .xml, .data]) { result in
                loadGPX(result)
            }
        }
    }

    private func loadGPX(_ result: Result<URL, Error>) {
        errorMessage = nil
        do {
            let url = try result.get()
            let scoped = url.startAccessingSecurityScopedResource()
            defer { if scoped { url.stopAccessingSecurityScopedResource() } }
            let stats = try GPXParser.parse(try Data(contentsOf: url))
            gpx = stats
            gpxFilename = url.lastPathComponent
            if let d = stats.date { date = d }
            if title.isEmpty {
                title = url.deletingPathExtension().lastPathComponent
                    .replacingOccurrences(of: "_", with: " ")
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func save() async {
        isSaving = true
        errorMessage = nil
        var body: [String: Any] = [
            "title": title.trimmingCharacters(in: .whitespaces),
            "description": description,
            "tripType": TripTypes.all.map(\.id).filter(tripTypes.contains),
            "date": ISO8601DateFormatter().string(from: date),
        ]
        // On edit, route fields are only sent when a new GPX was chosen, so the
        // stored elevation profile isn't overwritten by our slimmer model.
        if let gpx {
            body["distance"] = gpx.distance
            body["elevationGain"] = gpx.elevationGain
            body["gpxData"] = gpx.asGpxData
        }
        do {
            let saved: FieldNote
            if let existing {
                saved = try await API.put("/api/field-notes/\(existing.id)", body: body)
            } else {
                saved = try await API.post("/api/field-notes", body: body)
            }
            onSaved(saved)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        isSaving = false
    }
}

// MARK: - Trip type chips

struct TripTypePicker: View {
    @Binding var selection: Set<String>

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
            ForEach(TripTypes.all, id: \.id) { type in
                let on = selection.contains(type.id)
                Button {
                    if on { selection.remove(type.id) } else { selection.insert(type.id) }
                } label: {
                    Text(type.label)
                        .font(.system(size: 13, weight: .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundColor(on ? .white : ink)
                        .background(on ? ink : border)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.vertical, 4)
    }
}

extension UTType {
    static let gpx = UTType(filenameExtension: "gpx") ?? .xml
}
