import SwiftUI

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
                PromoteSheet(item: item) { note in
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

// MARK: - Promote

struct PendingPromote: Identifiable {
    let inboxId: String
    let title: String
    let tripType: String
    var id: String { inboxId }
}

private struct PromoteSheet: View {
    let item: PendingPromote
    var onSaved: (FieldNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var title: String
    @State private var tripTypes: Set<String>
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(item: PendingPromote, onSaved: @escaping (FieldNote) -> Void) {
        self.item = item
        self.onSaved = onSaved
        _title = State(initialValue: item.title)
        _tripTypes = State(initialValue: [item.tripType])
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Title") { TextField("Title", text: $title) }
                Section("Activity") { TripTypePicker(selection: $tripTypes) }
                if let errorMessage {
                    Section { Text(errorMessage).foregroundColor(.red) }
                }
            }
            .navigationTitle("Save as trip")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Back") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if isSaving { ProgressView() } else {
                        Button("Save") { Task { await promote() } }
                            .disabled(title.isEmpty || tripTypes.isEmpty)
                    }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func promote() async {
        isSaving = true
        struct Promoted: Decodable { let fieldNote: FieldNote }
        do {
            let result: Promoted = try await API.post("/api/inbox/\(item.inboxId)/promote", body: [
                "title": title,
                "tripType": TripTypes.all.map(\.id).filter(tripTypes.contains),
            ])
            onSaved(result.fieldNote)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
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
