import Foundation
import CoreLocation

// MARK: - FieldNote

struct FieldNote: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let description: String?
    let tripType: [String]
    let date: String
    let distance: Double?
    let elevationGain: Double?
    let photos: [Photo]?
    let gpxData: GpxData?

    struct GpxData: Codable {
        let coordinates: [[Double]]?
    }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: FieldNote, rhs: FieldNote) -> Bool { lhs.id == rhs.id }

    var mapCoordinates: [CLLocationCoordinate2D] {
        (gpxData?.coordinates ?? []).compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }

    var formattedDate: String {
        let s = String(date.prefix(10))
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withFullDate, .withDashSeparatorInDate]
        guard let d = parser.date(from: s) else { return s }
        let fmt = DateFormatter()
        fmt.dateStyle = .long
        return fmt.string(from: d)
    }
}

// MARK: - Photo

struct Photo: Codable, Identifiable, Hashable {
    let id: String
    let fieldNoteId: String
    let filename: String
    let url: String
    let latitude: Double?
    let longitude: Double?
    let elevation: Double?
    let timestamp: String?
    let camera: String?
}

// MARK: - User

struct User: Codable {
    let id: String
    let email: String?
    let firstName: String?
    let lastName: String?

    enum CodingKeys: String, CodingKey {
        case id, email
        case firstName = "first_name"
        case lastName = "last_name"
    }

    var displayName: String {
        let parts = [firstName, lastName].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? (email ?? "Account") : parts.joined(separator: " ")
    }
}
