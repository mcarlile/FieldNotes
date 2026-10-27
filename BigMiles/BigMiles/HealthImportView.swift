import SwiftUI
import HealthKit

/// Pick any Apple Health workout and turn it into a trip, the same way
/// StravaImportView lists Strava activities. Works whether or not automatic
/// import is on in Settings.
struct HealthImportView: View {
    var onSaved: (FieldNote) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var workouts: [HKWorkout] = []
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var importingId: UUID?
    @State private var pending: PendingWorkout?

    private let health = HealthSync.shared
    private let sand  = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let ink   = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    var body: some View {
        NavigationStack {
            Group {
                if isLoading {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let errorMessage, workouts.isEmpty {
                    ContentUnavailableView(errorMessage, systemImage: "exclamationmark.triangle")
                } else if workouts.isEmpty {
                    ContentUnavailableView("No workouts", systemImage: "heart",
                                           description: Text("Workouts you record on your iPhone or Apple Watch show up here."))
                } else {
                    List(workouts, id: \.uuid) { workout in
                        Button { Task { await pick(workout) } } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(HealthSync.defaultTitle(for: workout))
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundColor(ink)
                                    Text(subtitle(for: workout))
                                        .font(.system(size: 12))
                                        .foregroundColor(muted)
                                }
                                Spacer()
                                if importingId == workout.uuid { ProgressView() }
                            }
                        }
                        .disabled(importingId != nil || isIndoor(workout))
                        .listRowBackground(sand)
                    }
                    .listStyle(.plain)
                }
            }
            .scrollContentBackground(.hidden)
            .background(sand.ignoresSafeArea())
            .navigationTitle("Import from Apple Health")
            .toolbarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
            .alert("Couldn't import", isPresented: Binding(
                get: { errorMessage != nil && !workouts.isEmpty },
                set: { if !$0 { errorMessage = nil } }
            )) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
            .sheet(item: $pending) { item in
                SaveAsTripSheet(title: HealthSync.defaultTitle(for: item.workout),
                                tripType: WorkoutKind(item.workout.workoutActivityType).tripType) { title, tripTypes in
                    try await health.importWorkout(item.workout, points: item.points,
                                                   title: title, tripTypes: tripTypes)
                } onSaved: { note in
                    onSaved(note)
                    dismiss()
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        guard health.isAvailable else {
            errorMessage = "Apple Health isn't available on this device."
            isLoading = false
            return
        }
        do {
            try await health.requestAccess()
            workouts = try await health.allWorkouts()
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func pick(_ workout: HKWorkout) async {
        importingId = workout.uuid
        defer { importingId = nil }
        do {
            let points = try await health.routePoints(for: workout)
            guard points.count >= 2 else {
                errorMessage = "This workout doesn't have a GPS route."
                return
            }
            pending = PendingWorkout(workout: workout, points: points)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func isIndoor(_ workout: HKWorkout) -> Bool {
        workout.metadata?[HKMetadataKeyIndoorWorkout] as? Bool == true
    }

    private func subtitle(for workout: HKWorkout) -> String {
        var parts = [workout.startDate.formatted(date: .abbreviated, time: .shortened)]
        if let meters = workout.totalDistance?.doubleValue(for: .meter()), meters > 0 {
            parts.append(String(format: "%.1f mi", meters / 1609.344))
        }
        if let gain = workout.metadata?[HKMetadataKeyElevationAscended] as? HKQuantity {
            parts.append("\(Int(gain.doubleValue(for: .foot()))) ft")
        }
        if isIndoor(workout) { parts.append("indoor") }
        if health.isImported(workout) { parts.append("imported") }
        return parts.joined(separator: " · ")
    }
}

private struct PendingWorkout: Identifiable {
    let workout: HKWorkout
    let points: [GPXPoint]
    var id: UUID { workout.uuid }
}
