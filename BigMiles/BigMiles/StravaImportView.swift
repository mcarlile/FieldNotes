import SwiftUI
import PhotosUI
#if canImport(UIKit)
import UIKit
#endif

/// Pick a recent Strava activity and turn it into a trip. Uses the same two
/// calls as the web Inbox: import into the GPX inbox, then promote.
struct StravaImportView: View {
    var onSaved: (FieldNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var activities: [StravaActivity] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var importingId: Int64?
    @State private var pending: PendingPromote?

    private let sand  = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let ink   = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, activities.isEmpty {
                    ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
                } else if activities.isEmpty {
                    ContentUnavailableView("No recent activities", systemImage: "figure.hiking")
                } else {
                    List(activities) { activity in
                        Button { Task { await importActivity(activity) } } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(activity.name)
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(ink)
                                    Text(activity.subtitle)
                                        .font(.system(size: 12))
                                        .foregroundColor(muted)
                                }
                                Spacer()
                                if importingId == activity.id { ProgressView() }
                            }
                        }
                        .disabled(importingId != nil || activity.hasNoRoute)
                        .listRowBackground(sand)
                    }
                    .listStyle(.plain)
                }
            }
            .scrollContentBackground(.hidden)
            .background(sand.ignoresSafeArea())
            .navigationTitle("Import from Strava")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("Couldn't import", isPresented: Binding(
                get: { errorMessage != nil && !activities.isEmpty },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(item: $pending) { item in
                SaveAsTripSheet(title: item.title, tripType: item.tripType) { title, tripTypes, photos in
                    struct Promoted: Decodable { let fieldNote: FieldNote }
                    var body: [String: Any] = ["title": title, "tripType": tripTypes]
                    if !photos.isEmpty { body["photos"] = photos }
                    let result: Promoted = try await API.post("/api/inbox/\(item.inboxId)/promote", body: body)
                    return result.fieldNote
                } onSaved: { note in
                    onSaved(note)
                    dismiss()
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        do {
            activities = try await API.get("/api/strava/activities")
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func importActivity(_ activity: StravaActivity) async {
        importingId = activity.id
        defer { importingId = nil }
        do {
            let inboxId: String
            do {
                let item: InboxItem = try await API.post("/api/strava/import/activity/\(activity.id)")
                inboxId = item.id
            } catch APIError.httpError(409, _, let body) {
                // Already in the inbox: reuse that item.
                struct Duplicate: Decodable { let inboxItemId: String }
                inboxId = try JSONDecoder().decode(Duplicate.self, from: body).inboxItemId
            }
            pending = PendingPromote(
                inboxId: inboxId,
                title: activity.name,
                tripType: TripTypes.fromStravaSport(activity.sportType ?? "")
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

// MARK: - Save as trip

struct PendingPromote: Identifiable {
    let inboxId: String
    let title: String
    let tripType: String
    var id: String { inboxId }
}

/// Title, activity, photos and videos for an imported route, then save.
/// Shared by the Strava and Apple Health import lists; `save` makes the trip
/// with the uploaded photo entries. Videos upload in the background after.
struct SaveAsTripSheet: View {
    typealias Save = (_ title: String, _ tripTypes: [String], _ photos: [[String: Any]]) async throws -> FieldNote
    var save: Save
    var onSaved: (FieldNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var tripTypes: Set<String>
    @State private var photos: [PendingPhoto] = []
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var isLoadingPhotos = false
    @State private var videos: [PendingVideo] = []
    @State private var isSaving = false
    @State private var uploadProgress: String?
    @State private var errorMessage: String?

    private static let maxPhotos = 100  // MAX_TRIP_PHOTOS in shared/photo-limit.ts
    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    init(title: String, tripType: String, save: @escaping Save, onSaved: @escaping (FieldNote) -> Void) {
        self.save = save
        self.onSaved = onSaved
        _title = State(initialValue: title)
        _tripTypes = State(initialValue: [tripType])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") { TextField("Title", text: $title) }
                Section("Activity") { TripTypePicker(selection: $tripTypes) }
                photosSection
                VideoPickerSection(videos: $videos)
                if let errorMessage {
                    Section { Text(errorMessage).foregroundColor(.red) }
                }
            }
            .navigationTitle("Save as trip")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving {
                        HStack(spacing: 6) {
                            if let uploadProgress { Text(uploadProgress).font(.system(size: 13)).foregroundColor(muted) }
                            ProgressView()
                        }
                    } else {
                        Button("Save") { Task { await saveTrip() } }
                            .disabled(title.isEmpty || tripTypes.isEmpty || isLoadingPhotos)
                    }
                }
            }
            .onChange(of: photoItems) { Task { await loadPhotos() } }
            .onDisappear { videos.forEach(VideoUploadManager.discard) }
        }
        .presentationDetents([.medium, .large])
    }

    private var photosSection: some View {
        Section {
            if !photos.isEmpty {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 76), spacing: 8)], spacing: 8) {
                    ForEach(photos) { photo in
                        Color.clear
                            .aspectRatio(1, contentMode: .fit)
                            .overlay {
                                #if canImport(UIKit)
                                if let image = UIImage(data: photo.jpeg) { Image(uiImage: image).resizable().scaledToFill() }
                                #endif
                            }
                            .clipShape(RoundedRectangle(cornerRadius: 6))
                            .overlay(alignment: .topTrailing) {
                                Button { photos.removeAll { $0.id == photo.id } } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundStyle(.white, .black.opacity(0.6))
                                        .padding(3)
                                }
                                .buttonStyle(.plain)
                            }
                    }
                }
                .padding(.vertical, 4)
            }
            PhotosPicker(selection: $photoItems,
                         maxSelectionCount: max(Self.maxPhotos - photos.count, 1),
                         matching: .images) {
                HStack {
                    SwiftUI.Label("Add photos", systemImage: "photo.on.rectangle.angled")
                    if isLoadingPhotos { Spacer(); ProgressView() }
                }
            }
            .disabled(photos.count >= Self.maxPhotos || isLoadingPhotos)
        } header: {
            Text("Photos")
        } footer: {
            Text("Photos with a location show as pins on the route map.")
        }
    }

    private func loadPhotos() async {
        guard !photoItems.isEmpty else { return }
        isLoadingPhotos = true
        let items = photoItems
        photoItems = []
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self),
                  let photo = PhotoUploader.prepare(data, index: photos.count)
            else { continue }
            photos.append(photo)
        }
        isLoadingPhotos = false
    }

    private func saveTrip() async {
        isSaving = true
        errorMessage = nil
        do {
            let uploaded = try await PhotoUploader.uploadAll(photos) { uploadProgress = $0 }
            let note = try await save(title, TripTypes.all.map(\.id).filter(tripTypes.contains), uploaded)
            // Videos go up in the background; the sheet closes now.
            let picked = videos
            videos = []
            Task { await VideoUploadManager.shared.enqueue(picked, for: note) }
            onSaved(note)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
        uploadProgress = nil
        isSaving = false
    }
}

// MARK: - Models

struct InboxItem: Decodable { let id: String }

struct StravaActivity: Decodable, Identifiable {
    let id: Int64
    let name: String
    let sportType: String?
    let startDateLocal: String?
    let distance: Double?            // meters
    let totalElevationGain: Double?  // meters
    let map: MapSummary?

    struct MapSummary: Decodable { let summaryPolyline: String? }

    enum CodingKeys: String, CodingKey {
        case id, name, distance, map
        case sportType = "sport_type"
        case startDateLocal = "start_date_local"
        case totalElevationGain = "total_elevation_gain"
    }

    var hasNoRoute: Bool { (map?.summaryPolyline ?? "").isEmpty }

    var subtitle: String {
        var parts: [String] = []
        if let d = startDateLocal?.prefix(10) { parts.append(String(d)) }
        if let sportType { parts.append(sportType) }
        if let m = distance { parts.append(String(format: "%.1f mi", m / 1609.344)) }
        if let g = totalElevationGain { parts.append("\(Int(g * 3.28084)) ft") }
        if hasNoRoute { parts.append("no GPS") }
        return parts.joined(separator: " · ")
    }
}

extension StravaActivity.MapSummary {
    enum CodingKeys: String, CodingKey { case summaryPolyline = "summary_polyline" }
}
