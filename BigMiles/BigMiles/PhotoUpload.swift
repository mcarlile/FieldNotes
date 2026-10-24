import Foundation
import ImageIO
import UniformTypeIdentifiers
#if canImport(UIKit)
import UIKit
#endif

/// A photo picked on device, resized to a JPEG and waiting to upload.
struct PendingPhoto: Identifiable {
    let id = UUID()
    let jpeg: Data
    let filename: String
    var latitude: Double?
    var longitude: Double?
    var elevation: Double?
    var timestamp: Date?
    var camera: String?

    var hasLocation: Bool { latitude != nil && longitude != nil }
}

enum PhotoUploader {
    /// Longest edge of uploaded photos, plenty for the web gallery.
    private static let maxPixelSize = 3000

    /// Reads location, time and camera from the original file (before
    /// re-encoding drops them) and makes a JPEG, so HEIC shows on the web too.
    static func prepare(_ data: Data, index: Int) -> PendingPhoto? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                  kCGImageSourceCreateThumbnailFromImageAlways: true,
                  kCGImageSourceCreateThumbnailWithTransform: true,
                  kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
              ] as CFDictionary)
        else { return nil }

        let out = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(out, UTType.jpeg.identifier as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, image, [kCGImageDestinationLossyCompressionQuality: 0.85] as CFDictionary)
        guard CGImageDestinationFinalize(dest) else { return nil }

        let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] ?? [:]
        let gps = props[kCGImagePropertyGPSDictionary] as? [CFString: Any]
        let exif = props[kCGImagePropertyExifDictionary] as? [CFString: Any]
        let tiff = props[kCGImagePropertyTIFFDictionary] as? [CFString: Any]

        var photo = PendingPhoto(jpeg: out as Data, filename: "photo-\(index + 1).jpg")
        if let gps, let lat = gps[kCGImagePropertyGPSLatitude] as? Double,
           let lon = gps[kCGImagePropertyGPSLongitude] as? Double {
            photo.latitude = (gps[kCGImagePropertyGPSLatitudeRef] as? String) == "S" ? -lat : lat
            photo.longitude = (gps[kCGImagePropertyGPSLongitudeRef] as? String) == "W" ? -lon : lon
            photo.elevation = gps[kCGImagePropertyGPSAltitude] as? Double
        }
        if let taken = exif?[kCGImagePropertyExifDateTimeOriginal] as? String {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyy:MM:dd HH:mm:ss"
            photo.timestamp = f.date(from: taken)
        }
        photo.camera = tiff?[kCGImagePropertyTIFFModel] as? String
        return photo
    }

    /// Same steps as the web uploader: get a signed URL, PUT the file, then
    /// return the photo entry for the trip's `photos` array.
    static func upload(_ photo: PendingPhoto) async throws -> [String: Any] {
        struct Upload: Decodable { let uploadURL: String }
        let target: Upload = try await API.post("/api/photos/upload")
        guard let url = URL(string: target.uploadURL) else { throw APIError.badURL }

        var put = URLRequest(url: url)
        put.httpMethod = "PUT"
        put.setValue("image/jpeg", forHTTPHeaderField: "Content-Type")
        let (_, response) = try await URLSession.shared.upload(for: put, from: photo.jpeg)
        if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
            throw APIError.httpError(http.statusCode, message: "Photo upload failed.", body: Data())
        }

        var entry: [String: Any] = [
            "filename": photo.filename,
            "url": storedPath(for: url),
            "caption": "",
            "fileSize": "\(photo.jpeg.count)",
        ]
        entry["latitude"] = photo.latitude
        entry["longitude"] = photo.longitude
        entry["elevation"] = photo.elevation
        entry["timestamp"] = photo.timestamp.map { ISO8601DateFormatter().string(from: $0) }
        entry["camera"] = photo.camera
        return entry
    }

    /// Mirrors `normalize` in client/src/pages/admin.tsx: a signed storage URL
    /// becomes the site path the server serves it from.
    private static func storedPath(for url: URL) -> String {
        guard url.host == "storage.googleapis.com" else { return url.absoluteString }
        let parts = url.path.split(separator: "/", maxSplits: 1).map(String.init)  // [bucket, object]
        guard parts.count == 2, parts[1].hasPrefix(".private/uploads/") else { return url.absoluteString }
        return "/objects/uploads/" + parts[1].dropFirst(".private/uploads/".count)
    }
}
