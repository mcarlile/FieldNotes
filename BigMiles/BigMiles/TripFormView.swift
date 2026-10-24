import SwiftUI
import UniformTypeIdentifiers
import CoreLocation
import PhotosUI

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
    @State private var keptPhotos: [Photo] = []
    @State private var newPhotos: [PendingPhoto] = []
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isLoadingPhotos = false
    @State private var uploadProgress: String?

    private static let maxPhotos = 100  // MAX_TRIP_PHOTOS in shared/photo-limit.ts

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
            _keptPhotos = State(initialValue: note.photos ?? [])
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

                photosSection

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
                        HStack(spacing: 6) {
                            if let uploadProgress { Text(uploadProgress).font(.system(size: 13)).foregroundColor(muted) }
                            ProgressView()
                        }
                    } else {
                        Button("Save") { Task { await save() } }
                            .disabled(!canSave)
                    }
                }
            }
            .onChange(of: pickerItems) { Task { await loadPicked() } }
            .fileImporter(isPresented: $showImporter, allowedContentTypes: [.gpx, .xml, .data]) { result in
                loadGPX(result)
            }
        }
    }

    // MARK: Photos

    private var photoCount: Int { keptPhotos.count + newPhotos.count }

    private var photosSection: some View {
        Section {
            if photoCount > 0 {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 8)], spacing: 8) {
                    ForEach(keptPhotos) { photo in
                        thumbnail { AsyncImage(url: photo.imageURL) { $0.resizable().scaledToFill() } placeholder: { border } }
                            remove: { keptPhotos.removeAll { $0.id == photo.id } }
                    }
                    ForEach(newPhotos) { photo in
                        thumbnail {
                            #if canImport(UIKit)
                            if let image = UIImage(data: photo.jpeg) { Image(uiImage: image).resizable().scaledToFill() }
                            #endif
                        } remove: { newPhotos.removeAll { $0.id == photo.id } }
                        .overlay(alignment: .bottomLeading) {
                            if photo.hasLocation {
                                Image(systemName: "mappin.circle.fill")
                                    .foregroundStyle(.white, .black.opacity(0.5))
                                    .padding(4)
                            }
                        }
                    }
                }
                .padding(.vertical, 4)
            }
            PhotosPicker(selection: $pickerItems,
                         maxSelectionCount: max(Self.maxPhotos - photoCount, 1),
                         matching: .images) {
                HStack {
                    Label("Add photos", systemImage: "photo.on.rectangle.angled")
                    if isLoadingPhotos { Spacer(); ProgressView() }
                }
            }
            .disabled(photoCount >= Self.maxPhotos || isLoadingPhotos)
        } header: {
            Text("Photos")
        } footer: {
            Text("Photos with a location show as pins on the route map.")
        }
    }

    private func thumbnail<Content: View>(@ViewBuilder _ content: () -> Content,
                                          remove: @escaping () -> Void) -> some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { content() }
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(alignment: .topTrailing) {
                Button(action: remove) {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.white, .black.opacity(0.6))
                        .padding(3)
                }
                .buttonStyle(.plain)
            }
    }

    private func loadPicked() async {
        guard !pickerItems.isEmpty else { return }
        isLoadingPhotos = true
        let items = pickerItems
        pickerItems = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let photo = PhotoUploader.prepare(data, index: photoCount)
            else { continue }
            newPhotos.append(photo)
        }
        isLoadingPhotos = false
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
            var uploaded: [[String: Any]] = []
            for (i, photo) in newPhotos.enumerated() {
                uploadProgress = "Uploading \(i + 1) of \(newPhotos.count)"
                uploaded.append(try await PhotoUploader.upload(photo))
            }
            uploadProgress = nil
            // The server replaces a trip's photos with this list: existing ones
            // are kept by id. Only sent when the set changed, and never when the
            // trip was opened without its photos loaded.
            let photosChanged = !uploaded.isEmpty || keptPhotos.count != (existing?.photos?.count ?? 0)
            if photosChanged && (existing == nil || existing?.photos != nil) {
                body["photos"] = keptPhotos.map { ["id": $0.id] as [String: Any] } + uploaded
            }

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
        uploadProgress = nil
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
