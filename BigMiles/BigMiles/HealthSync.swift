import Foundation
import Combine
import HealthKit
import CoreLocation

/// Imports Apple Health workouts that have a GPS route as trips.
///
/// Only workouts that start after the moment the user turns this on are
/// imported, so turning it on doesn't flood the list with old workouts (or
/// duplicate ones already imported from Strava). Imported workout ids are
/// remembered on device so each one becomes a trip once.
@MainActor
final class HealthSync: ObservableObject {
    static let shared = HealthSync()

    @Published private(set) var isEnabled: Bool
    @Published private(set) var isSyncing = false
    @Published private(set) var lastSync: Date?
    @Published private(set) var importedCount: Int
    @Published private(set) var lastError: String?

    var isAvailable: Bool { HKHealthStore.isHealthDataAvailable() }

    private let store = HKHealthStore()
    private var observer: HKObserverQuery?
    private let defaults = UserDefaults.standard

    private enum Key {
        static let enabled  = "health.enabled"
        static let since    = "health.since"
        static let imported = "health.importedWorkoutIds"
        static let lastSync = "health.lastSync"
    }

    private var importedIds: Set<String> {
        get { Set(defaults.stringArray(forKey: Key.imported) ?? []) }
        set {
            defaults.set(Array(newValue), forKey: Key.imported)
            importedCount = newValue.count
        }
    }

    private init() {
        isEnabled = defaults.bool(forKey: Key.enabled)
        importedCount = defaults.stringArray(forKey: Key.imported)?.count ?? 0
        lastSync = defaults.object(forKey: Key.lastSync) as? Date
    }

    // MARK: - Turning it on and off

    /// Asks for read access to workouts and their routes. iOS only shows the
    /// prompt the first time; after that this returns right away.
    func requestAccess() async throws {
        try await store.requestAuthorization(
            toShare: [],
            read: [HKObjectType.workoutType(), HKSeriesType.workoutRoute()]
        )
    }

    func enable() async {
        lastError = nil
        do {
            try await requestAccess()
        } catch {
            lastError = error.localizedDescription
            return
        }
        if defaults.object(forKey: Key.since) == nil {
            defaults.set(Date(), forKey: Key.since)
        }
        defaults.set(true, forKey: Key.enabled)
        isEnabled = true
        startObserving()
        await sync()
    }

    func disable() {
        defaults.set(false, forKey: Key.enabled)
        isEnabled = false
        if let observer { store.stop(observer) }
        observer = nil
    }

    /// Call on launch: re-attaches the observer when the setting is on.
    func resume() {
        guard isEnabled else { return }
        startObserving()
        Task { await sync() }
    }

    private func startObserving() {
        guard observer == nil else { return }
        // HealthKit calls this on a background queue.
        let query = HKObserverQuery(sampleType: .workoutType(), predicate: nil) { @Sendable _, completion, _ in
            Task { @MainActor in await HealthSync.shared.sync() }
            completion()
        }
        store.execute(query)
        observer = query
    }

    // MARK: - Sync

    func sync() async {
        guard isEnabled, !isSyncing, AuthManager.shared.storedToken != nil else { return }
        isSyncing = true
        lastError = nil
        defer { isSyncing = false }

        let since = defaults.object(forKey: Key.since) as? Date ?? Date()
        do {
            let descriptor = HKSampleQueryDescriptor(
                predicates: [.workout(HKQuery.predicateForSamples(withStart: since, end: nil))],
                sortDescriptors: [SortDescriptor(\.startDate)]
            )
            for workout in try await descriptor.result(for: store) {
                let id = workout.uuid.uuidString
                guard !importedIds.contains(id) else { continue }

                let points = try await routePoints(for: workout)
                if points.count < 2 {
                    // The Watch can save the route a little after the workout;
                    // give it an hour before treating the workout as route-less.
                    if workout.endDate < Date().addingTimeInterval(-3600) { importedIds.insert(id) }
                    continue
                }
                try await createTrip(from: workout, points: points)
                importedIds.insert(id)
            }
            lastSync = Date()
            defaults.set(lastSync, forKey: Key.lastSync)
        } catch {
            lastError = error.localizedDescription
        }
    }

    // MARK: - Picking a workout by hand

    /// Every workout in Apple Health, newest first, for the import list.
    func allWorkouts() async throws -> [HKWorkout] {
        try await HKSampleQueryDescriptor(
            predicates: [.workout()],
            sortDescriptors: [SortDescriptor(\.startDate, order: .reverse)]
        ).result(for: store)
    }

    func isImported(_ workout: HKWorkout) -> Bool {
        importedIds.contains(workout.uuid.uuidString)
    }

    /// Turns a workout picked from the list into a trip, and remembers it so
    /// automatic import doesn't add it a second time.
    func importWorkout(_ workout: HKWorkout, points: [GPXPoint],
                       title: String, tripTypes: [String]) async throws -> FieldNote {
        let note = try await createTrip(from: workout, points: points, title: title, tripTypes: tripTypes)
        importedIds.insert(workout.uuid.uuidString)
        return note
    }

    func routePoints(for workout: HKWorkout) async throws -> [GPXPoint] {
        let routes = try await HKSampleQueryDescriptor(
            predicates: [.workoutRoute(HKQuery.predicateForObjects(from: workout))],
            sortDescriptors: [SortDescriptor(\.startDate)]
        ).result(for: store)

        var points: [GPXPoint] = []
        for route in routes {
            for try await location in HKWorkoutRouteQueryDescriptor(route).results(for: store) {
                points.append(GPXPoint(lat: location.coordinate.latitude, lon: location.coordinate.longitude,
                                       ele: location.altitude, time: location.timestamp))
            }
        }
        return points
    }

    @discardableResult
    private func createTrip(from workout: HKWorkout, points: [GPXPoint],
                            title: String? = nil, tripTypes: [String]? = nil) async throws -> FieldNote {
        let stats = GPXParser.stats(from: points, fallbackDate: workout.startDate)
        let kind = WorkoutKind(workout.workoutActivityType)
        return try await API.post("/api/field-notes", body: [
            "title": title ?? Self.defaultTitle(for: workout),
            "description": "",
            "tripType": tripTypes ?? [kind.tripType],
            "date": ISO8601DateFormatter().string(from: workout.startDate),
            "distance": stats.distance,
            "elevationGain": stats.elevationGain,
            "gpxData": stats.asGpxData,
        ])
    }

    /// "Morning ride", "Evening hike", and so on.
    static func defaultTitle(for workout: HKWorkout) -> String {
        "\(partOfDay(workout.startDate)) \(WorkoutKind(workout.workoutActivityType).noun)"
    }

    private static func partOfDay(_ date: Date) -> String {
        switch Calendar.current.component(.hour, from: date) {
        case 5..<12:  return "Morning"
        case 12..<17: return "Afternoon"
        case 17..<21: return "Evening"
        default:      return "Night"
        }
    }
}

/// Maps a HealthKit activity onto the web app's trip types.
struct WorkoutKind {
    let tripType: String
    let noun: String

    init(_ type: HKWorkoutActivityType) {
        switch type {
        case .hiking:                       (tripType, noun) = ("hiking", "hike")
        case .walking:                      (tripType, noun) = ("hiking", "walk")
        case .running:                      (tripType, noun) = ("running", "run")
        case .cycling:                      (tripType, noun) = ("cycling", "ride")
        case .paddleSports, .rowing:        (tripType, noun) = ("paddling", "paddle")
        case .downhillSkiing, .crossCountrySkiing, .snowboarding:
                                            (tripType, noun) = ("skiing", "ski")
        case .swimming:                     (tripType, noun) = ("openwater", "swim")
        case .climbing:                     (tripType, noun) = ("climbing", "climb")
        case .fishing:                      (tripType, noun) = ("fishing", "fishing trip")
        default:                            (tripType, noun) = ("other", "workout")
        }
    }
}
