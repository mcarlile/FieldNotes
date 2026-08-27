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

    // gpxData can arrive as a JSON object OR as a raw JSON string depending on
    // how it was originally stored. Handle both so the decoder never throws.
    enum CodingKeys: String, CodingKey {
        case id, title, description, tripType, date, distance, elevationGain, photos, gpxData
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id            = try c.decode(String.self, forKey: .id)
        title         = try c.decode(String.self, forKey: .title)
        description   = try c.decodeIfPresent(String.self, forKey: .description)
        tripType      = try c.decode([String].self, forKey: .tripType)
        date          = try c.decode(String.self, forKey: .date)
        distance      = try c.decodeIfPresent(Double.self, forKey: .distance)
        elevationGain = try c.decodeIfPresent(Double.self, forKey: .elevationGain)
        photos        = try c.decodeIfPresent([Photo].self, forKey: .photos)

        // Try object first, then fall back to parsing a JSON string
        if let gpx = try? c.decodeIfPresent(GpxData.self, forKey: .gpxData) {
            gpxData = gpx
        } else if let raw = try? c.decodeIfPresent(String.self, forKey: .gpxData),
                  let data = raw.data(using: .utf8),
                  let gpx = try? JSONDecoder().decode(GpxData.self, from: data) {
            gpxData = gpx
        } else {
            gpxData = nil
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encodeIfPresent(description, forKey: .description)
        try c.encode(tripType, forKey: .tripType)
        try c.encode(date, forKey: .date)
        try c.encodeIfPresent(distance, forKey: .distance)
        try c.encodeIfPresent(elevationGain, forKey: .elevationGain)
        try c.encodeIfPresent(photos, forKey: .photos)
        try c.encodeIfPresent(gpxData, forKey: .gpxData)
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
