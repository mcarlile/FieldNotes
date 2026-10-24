import Foundation

/// Mirrors `availableTripTypes` in client/src/pages/dashboard.tsx.
enum TripTypes {
    static let all: [(id: String, label: String)] = [
        ("hiking", "Hiking"),
        ("cycling", "Cycling"),
        ("running", "Running"),
        ("backpacking", "Backpacking"),
        ("paddling", "Paddling"),
        ("fishing", "Fishing"),
        ("motorcycle", "Motorcycle"),
        ("climbing", "Climbing"),
        ("skiing", "Skiing"),
        ("openwater", "Open Water Swimming"),
        ("other", "Other"),
    ]

    /// Mirrors `mapStravaSportToTripType` in client/src/pages/inbox.tsx.
    static func fromStravaSport(_ sport: String) -> String {
        let s = sport.lowercased()
        if s.contains("run") { return "running" }
        if s.contains("ride") || s.contains("bike") || s.contains("cycl") { return "cycling" }
        if s.contains("hike") || s.contains("walk") { return "hiking" }
        if s.contains("ski") { return "skiing" }
        if s.contains("swim") { return "openwater" }
        if ["kayak", "canoe", "paddl", "row"].contains(where: s.contains) { return "paddling" }
        if s.contains("climb") { return "climbing" }
        if s.contains("motor") { return "motorcycle" }
        return "other"
    }
}
