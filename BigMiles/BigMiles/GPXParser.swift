import Foundation

/// Swift port of `parseGpxData` in shared/gpx-utils.ts, so trips created on
/// iOS store the same `gpxData` shape (miles, feet, [lon, lat]) as the web app.
struct GPXStats {
    let distance: Double        // miles
    let elevationGain: Double   // feet
    let date: Date?
    let coordinates: [[Double]] // [lon, lat]
    let elevationProfile: [[String: Any]]
    /// The web's compact timed track ({startTime, durationSeconds, points: [[offset, lat, lon]]}),
    /// or nil when the points have no times. It is what places video clips on the route.
    var timedTrack: [String: Any]? = nil

    var asGpxData: [String: Any] {
        var data: [String: Any] = [
            "distance": distance,
            "elevationGain": elevationGain,
            "coordinates": coordinates,
            "elevationProfile": elevationProfile,
        ]
        data["date"] = date.map { ISO8601DateFormatter().string(from: $0) } ?? NSNull()
        data["timedTrack"] = timedTrack ?? NSNull()
        return data
    }
}

enum GPXParseError: LocalizedError {
    case noTrackPoints
    var errorDescription: String? { "No track points found in this GPX file." }
}

enum GPXParser {
    static func parse(_ data: Data) throws -> GPXStats {
        let collector = TrackCollector()
        let parser = XMLParser(data: data)
        parser.delegate = collector
        parser.parse()
        guard !collector.points.isEmpty else { throw GPXParseError.noTrackPoints }
        // First track point is when the activity started; metadata time is
        // often just the export time, so it is only a fallback.
        return stats(from: collector.points, fallbackDate: collector.metadataTime)
    }

    /// Distance, gain and profile for a track, from a GPX file or an Apple Health route.
    static func stats(from points: [GPXPoint], fallbackDate: Date? = nil) -> GPXStats {

        var distance = 0.0
        var gain = 0.0
        var prev: GPXPoint?
        var prevEle: Double?
        var coordinates: [[Double]] = []
        var profile: [[String: Any]] = []

        for p in points {
            coordinates.append([p.lon, p.lat])
            if let prev { distance += haversineMiles(prev.lat, prev.lon, p.lat, p.lon) }

            var elevationFeet = 0.0
            var hasElevation = false
            if let ele = p.ele, ele != 0 {
                hasElevation = true
                elevationFeet = ele * 3.28084
                if let prevEle, ele > prevEle { gain += (ele - prevEle) * 3.28084 }
                prevEle = ele
            }
            if hasElevation || profile.isEmpty {
                profile.append([
                    "distance": distance,
                    "elevation": elevationFeet,
                    "coordinates": [p.lon, p.lat],
                ])
            }
            prev = p
        }

        let date = points.first?.time ?? fallbackDate

        return GPXStats(
            distance: (distance * 100).rounded() / 100,
            elevationGain: gain.rounded(),
            date: date,
            coordinates: coordinates,
            elevationProfile: profile,
            timedTrack: timedTrack(from: points)
        )
    }

    /// Swift port of `compactTimedTrack` in shared/gpx-utils.ts.
    static func timedTrack(from points: [GPXPoint]) -> [String: Any]? {
        let timed = points.compactMap { p in p.time.map { (time: $0, lat: p.lat, lon: p.lon) } }
            .sorted { $0.time < $1.time }
        guard let first = timed.first, let last = timed.last else { return nil }
        let snap = { (value: Double, places: Double) in (value * places).rounded() / places }
        return [
            "startTime": ISO8601DateFormatter().string(from: first.time),
            "durationSeconds": last.time.timeIntervalSince(first.time),
            "points": timed.map { [snap($0.time.timeIntervalSince(first.time), 10), snap($0.lat, 1e6), snap($0.lon, 1e6)] },
        ]
    }

    private static func haversineMiles(_ lat1: Double, _ lon1: Double, _ lat2: Double, _ lon2: Double) -> Double {
        let r = 3959.0
        let dLat = (lat2 - lat1) * .pi / 180
        let dLon = (lon2 - lon1) * .pi / 180
        let a = sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1 * .pi / 180) * cos(lat2 * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
        return r * 2 * atan2(sqrt(a), sqrt(1 - a))
    }
}

nonisolated struct GPXPoint {
    let lat: Double
    let lon: Double
    var ele: Double?    // meters
    var time: Date?
}

private nonisolated final class TrackCollector: NSObject, XMLParserDelegate {
    var points: [GPXPoint] = []
    var metadataTime: Date?

    private var current: GPXPoint?
    private var text = ""
    private var inMetadata = false
    private let iso = ISO8601DateFormatter()
    private let isoFrac: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?,
                qualifiedName: String?, attributes: [String: String] = [:]) {
        text = ""
        switch name {
        case "trkpt":
            if let lat = attributes["lat"].flatMap(Double.init),
               let lon = attributes["lon"].flatMap(Double.init) {
                current = GPXPoint(lat: lat, lon: lon)
            }
        case "metadata":
            inMetadata = true
        default:
            break
        }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        text += string
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        switch name {
        case "ele":
            current?.ele = Double(value)
        case "time":
            let date = iso.date(from: value) ?? isoFrac.date(from: value)
            if current != nil { current?.time = date }
            else if inMetadata && metadataTime == nil { metadataTime = date }
        case "trkpt":
            if let current { points.append(current) }
            current = nil
        case "metadata":
            inMetadata = false
        default:
            break
        }
        text = ""
    }
}
