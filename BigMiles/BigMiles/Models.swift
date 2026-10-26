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
    /// From the list endpoint; the detail endpoint sends the photos and clips themselves.
    let photoCount: Int?
    let videoCount: Int?
    let videoClips: [VideoClip]?
    let playback: Playback?

    struct GpxData: Codable {
        let coordinates: [[Double]]?
        /// Present on trips whose GPX had timestamps; places video on the route.
        var timedTrack: TimedTrack? = nil

        init(coordinates: [[Double]]?, timedTrack: TimedTrack? = nil) {
            self.coordinates = coordinates
            self.timedTrack = timedTrack
        }

        // A malformed timed track must not cost the trip its route.
        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            coordinates = try c.decodeIfPresent([[Double]].self, forKey: .coordinates)
            timedTrack = try? c.decodeIfPresent(TimedTrack.self, forKey: .timedTrack)
        }
    }

    /// Video settings saved on the web (the calibrated sync offset and
    /// follow-cam angle). The app only reads them: calibration stays on the web.
    struct Playback: Codable {
        let syncOffsetSeconds: Double?
        var cameraAngle: CameraAngle? = nil
    }

    /// The 3D follow-cam's view, relative to the direction of travel.
    struct CameraAngle: Codable, Equatable {
        let pitch: Double
        let zoom: Double
        /// Degrees the camera turns from facing the way the ride goes.
        let bearingOffset: Double
    }

    // gpxData can arrive as a JSON object OR as a raw JSON string depending on
    // how it was originally stored. Handle both so the decoder never throws.
    enum CodingKeys: String, CodingKey {
        case id, title, description, tripType, date, distance, elevationGain, photos, gpxData
        case photoCount, videoCount, videoClips, playback
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
        photoCount    = try? c.decodeIfPresent(Int.self, forKey: .photoCount)
        videoCount    = try? c.decodeIfPresent(Int.self, forKey: .videoCount)
        videoClips    = try? c.decodeIfPresent([VideoClip].self, forKey: .videoClips)
        playback      = try? c.decodeIfPresent(Playback.self, forKey: .playback)

        // Try object first, then a JSON string, then raw GPX XML (what the web
        // editor stores).
        if let gpx = try? c.decodeIfPresent(GpxData.self, forKey: .gpxData) {
            gpxData = gpx
        } else if let raw = try? c.decodeIfPresent(String.self, forKey: .gpxData),
                  let data = raw.data(using: .utf8) {
            if let gpx = try? JSONDecoder().decode(GpxData.self, from: data) {
                gpxData = gpx
            } else if let stats = try? GPXParser.parse(data) {
                gpxData = GpxData(coordinates: stats.coordinates)
            } else {
                gpxData = nil
            }
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
        try c.encodeIfPresent(photoCount, forKey: .photoCount)
        try c.encodeIfPresent(videoCount, forKey: .videoCount)
        try c.encodeIfPresent(videoClips, forKey: .videoClips)
        try c.encodeIfPresent(playback, forKey: .playback)
    }

    /// Trips that were TrailCam Studio projects, or that had clips added since.
    var hasVideos: Bool { (videoCount ?? videoClips?.count ?? 0) > 0 }
    var hasPhotos: Bool { (photoCount ?? photos?.count ?? 0) > 0 }

    func hash(into hasher: inout Hasher) { hasher.combine(id) }
    static func == (lhs: FieldNote, rhs: FieldNote) -> Bool { lhs.id == rhs.id }

    var mapCoordinates: [CLLocationCoordinate2D] {
        (gpxData?.coordinates ?? []).compactMap { pair in
            guard pair.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: pair[1], longitude: pair[0])
        }
    }

    /// The calendar day of the trip, as local midnight.
    var parsedDate: Date? {
        let parser = ISO8601DateFormatter()
        parser.formatOptions = [.withFullDate, .withDashSeparatorInDate]
        parser.timeZone = .current
        return parser.date(from: String(date.prefix(10)))
    }

    var formattedDate: String {
        guard let d = parsedDate else { return String(date.prefix(10)) }
        let fmt = DateFormatter()
        fmt.dateStyle = .long
        return fmt.string(from: d)
    }
}

// MARK: - Timed track

/// The compact timed track the server stores: [secondsFromStart, lat, lon] per point.
struct TimedTrack: Codable {
    let startTime: String?
    let durationSeconds: Double?
    let points: [[Double]]

    /// Where the route was `seconds` after it started, between the two nearest points.
    func coordinate(at seconds: Double) -> CLLocationCoordinate2D? {
        let pts = points.filter { $0.count >= 3 }
        guard let first = pts.first, let last = pts.last else { return nil }
        if seconds <= first[0] { return CLLocationCoordinate2D(latitude: first[1], longitude: first[2]) }
        if seconds >= last[0] { return CLLocationCoordinate2D(latitude: last[1], longitude: last[2]) }
        var lo = 0, hi = pts.count - 1
        while hi - lo > 1 {
            let mid = (lo + hi) / 2
            if pts[mid][0] <= seconds { lo = mid } else { hi = mid }
        }
        let a = pts[lo], b = pts[hi]
        let span = b[0] - a[0]
        let f = span > 0 ? (seconds - a[0]) / span : 0
        return CLLocationCoordinate2D(latitude: a[1] + (b[1] - a[1]) * f,
                                      longitude: a[2] + (b[2] - a[2]) * f)
    }

    /// Direction of travel at `seconds`, in degrees from north, measured over
    /// a few seconds of track like the web's chase-cam. Nil when standing still.
    func bearing(at seconds: Double, span: Double = 6) -> Double? {
        guard let from = coordinate(at: seconds - span / 3),
              let to = coordinate(at: seconds + span * 2 / 3) else { return nil }
        let rad = Double.pi / 180
        let lat1 = from.latitude * rad, lat2 = to.latitude * rad
        let dLon = (to.longitude - from.longitude) * rad
        let y = sin(dLon) * cos(lat2)
        let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
        // Under about a metre of movement the direction is noise.
        if abs(x) < 1.5e-7 && abs(y) < 1.5e-7 { return nil }
        return (atan2(y, x) / rad + 360).truncatingRemainder(dividingBy: 360)
    }

    /// The stretch of route between two times, ends included.
    func segment(from start: Double, to end: Double) -> [CLLocationCoordinate2D] {
        guard end > start, let first = coordinate(at: start), let last = coordinate(at: end) else { return [] }
        let middle = points.filter { $0.count >= 3 && $0[0] > start && $0[0] < end }
            .map { CLLocationCoordinate2D(latitude: $0[1], longitude: $0[2]) }
        return [first] + middle + [last]
    }
}

// MARK: - Video clip

struct VideoClip: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    /// Seconds after the trip's route start.
    let startTime: Double
    let endTime: Double
    let duration: Double
    let processingStatus: String?
    let thumbnailUrl: String?

    var isReady: Bool { processingStatus == "ready" }

    /// Redirects to a signed storage URL, which AVPlayer follows.
    var streamURL: URL? { URL(string: "\(API.base)/api/video-clips/\(id)/stream") }
    var thumbnailURL: URL? {
        thumbnailUrl == nil ? nil : URL(string: "\(API.base)/api/video-clips/\(id)/thumbnail")
    }

    var timeRange: String {
        func fmt(_ s: Double) -> String {
            let t = Int(s.rounded(.down))
            return t >= 3600
                ? String(format: "%d:%02d:%02d", t / 3600, (t % 3600) / 60, t % 60)
                : String(format: "%d:%02d", t / 60, t % 60)
        }
        return "\(fmt(startTime)) → \(fmt(endTime))"
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

    /// Uploaded photos are usually stored as site-relative paths
    /// (/objects/uploads/…); resolve those the way the web map does.
    var imageURL: URL? {
        let raw = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let full: String
        if raw.hasPrefix("http://") || raw.hasPrefix("https://") {
            full = raw
        } else if raw.hasPrefix("//") {
            full = "https:" + raw
        } else {
            full = API.base + (raw.hasPrefix("/") ? "" : "/") + raw
        }
        return URL(string: full)
            ?? full.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed).flatMap(URL.init(string:))
    }

    var coordinate: CLLocationCoordinate2D? {
        guard let latitude, let longitude else { return nil }
        return CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }
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
