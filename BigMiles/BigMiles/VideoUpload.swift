import Foundation
import SwiftUI
import AVFoundation
import PhotosUI
import CoreTransferable
import UniformTypeIdentifiers
import UserNotifications

/// A video picked while creating a trip, copied into the app so it can still
/// upload after the picker and the form are gone.
struct PendingVideo: Identifiable {
    let id = UUID()
    /// File name inside `VideoUploadManager.pendingFolder`.
    let storedName: String
    let filename: String
    let duration: Double
    let recordedAt: Date?
    let fileSize: Int64

    var fileURL: URL { VideoUploadManager.pendingFolder.appendingPathComponent(storedName) }

    var subtitle: String {
        let minutes = Int(duration) / 60, seconds = Int(duration) % 60
        let size = ByteCountFormatter.string(fromByteCount: fileSize, countStyle: .file)
        return String(format: "%d:%02d · %@", minutes, seconds, size)
    }

    /// Reads length and recording time from a picked movie.
    static func load(_ movie: PickedMovie) async -> PendingVideo? {
        let asset = AVURLAsset(url: movie.url)
        guard let time = try? await asset.load(.duration), time.seconds.isFinite, time.seconds > 0 else {
            try? FileManager.default.removeItem(at: movie.url)
            return nil
        }
        // Camera filenames win over the movie's own date, as on the web:
        // exporters such as Insta360 Studio stamp the export time instead.
        var recordedAt = cameraFilenameTime(movie.filename)
        if recordedAt == nil, let item = try? await asset.load(.creationDate) {
            recordedAt = try? await item.load(.dateValue)
        }
        let size = (try? FileManager.default.attributesOfItem(atPath: movie.url.path)[.size] as? Int64) ?? 0
        return PendingVideo(storedName: movie.url.lastPathComponent, filename: movie.filename,
                            duration: time.seconds, recordedAt: recordedAt, fileSize: size)
    }

    /// Mirrors parseCameraFilenameTime in shared/clip-timing.ts: names such as
    /// VID_20261017_142758_00_004.mp4 carry the camera's local clock time.
    static func cameraFilenameTime(_ name: String) -> Date? {
        guard let match = name.firstMatch(of: #/(?:^|[^0-9])(\d{8}_\d{6})(?:[^0-9]|$)/#) else { return nil }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = .current
        f.dateFormat = "yyyyMMdd_HHmmss"
        return f.date(from: String(match.1))
    }
}

/// What the Photos picker hands over for a video: a copy in the app's
/// pending-uploads folder, plus the name it had.
nonisolated struct PickedMovie: Transferable {
    let url: URL
    let filename: String

    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let ext = received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension
            let dest = VideoUploadManager.pendingFolder
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension(ext)
            try FileManager.default.copyItem(at: received.file, to: dest)
            return PickedMovie(url: dest, filename: received.file.lastPathComponent)
        }
    }
}

/// One video's way through: get a signed URL, upload, add the clip.
nonisolated struct VideoUploadJob: Codable {
    let id: UUID
    let tripId: String
    let storedName: String
    let filename: String
    let duration: Double
    let recordedAt: Date?
    let fileSize: Int64
    var attempt = 0
    /// Set once the file is in storage; the clip still has to be added.
    var uploadURL: String?
}

/// Uploads a new trip's videos with a background URLSession, so they keep
/// going after the form closes, the app is left, or the phone is locked. Each
/// file goes straight to storage with a signed URL, then becomes a clip; the
/// server places it on the route from its recording time and processes it on
/// its own. When a trip's last video is up, a notification says so.
@MainActor
final class VideoUploadManager: NSObject, ObservableObject {
    static let shared = VideoUploadManager()

    nonisolated static let sessionIdentifier = "com.bigmiles.BigMiles.video-uploads"
    private static let stateKey = "videoUploads.v1"
    private static let maxAttempts = 3

    /// Where picked videos wait until they're uploaded. Not tmp: iOS may
    /// relaunch the app to finish an upload, and the file has to still be there.
    nonisolated static var pendingFolder: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let folder = base.appendingPathComponent("PendingVideos", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// A trip's videos, for the progress bar and the notification.
    struct Batch: Codable {
        var title: String
        var total = 0
        var done = 0
        var failed = 0
        var finished: Int { done + failed }
    }

    private struct State: Codable {
        var batches: [String: Batch] = [:]
        /// Jobs waiting on the app: no signed URL yet, a retry, or a clip to
        /// add (when the phone was locked or offline at the time).
        var waiting: [Job] = []
    }

    typealias Job = VideoUploadJob

    @Published private(set) var batches: [String: Batch] = [:]
    /// Bytes sent so far per job, for the progress bar.
    @Published private var sentBytes: [UUID: Int64] = [:]
    /// Bumped each time a clip is added to a trip, so its page reloads.
    @Published private(set) var clipsAdded: [String: Int] = [:]

    private var state = State()
    private var running: [UUID: Job] = [:]
    private var isFlushing = false
    /// The sign-in token, read while the app is in front: the keychain can't
    /// be read while the phone is locked.
    private var token: String?
    /// Handed over by iOS when it relaunches the app for finished uploads.
    var backgroundCompletion: (() -> Void)?
    private var pendingWork = 0
    private var backgroundEventsDone = false

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionIdentifier)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 2
        return URLSession(configuration: config, delegate: self, delegateQueue: .main)
    }()

    override private init() {
        super.init()
        if let data = UserDefaults.standard.data(forKey: Self.stateKey),
           let saved = try? JSONDecoder().decode(State.self, from: data) {
            state = saved
        }
        batches = state.batches
    }

    /// Reconnects to uploads from an earlier launch and retries anything
    /// left waiting. Called at launch and whenever the app comes to the front.
    func resume() {
        token = AuthManager.shared.storedToken ?? token
        Task {
            for task in await session.allTasks {
                if let job = Self.decode(task.taskDescription) { running[job.id] = job }
            }
            await flush()
        }
    }

    /// Asks once for permission to say when uploads finish.
    func requestNotificationPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Starts uploading a new trip's videos. Returns once they're queued.
    func enqueue(_ videos: [PendingVideo], for trip: FieldNote) async {
        guard !videos.isEmpty else { return }
        token = AuthManager.shared.storedToken ?? token
        var batch = state.batches[trip.id] ?? Batch(title: trip.title)
        batch.total += videos.count
        state.batches[trip.id] = batch
        state.waiting += videos.map {
            Job(id: $0.id, tripId: trip.id, storedName: $0.storedName, filename: $0.filename,
                duration: $0.duration, recordedAt: $0.recordedAt, fileSize: $0.fileSize)
        }
        save()
        await flush()
    }

    /// Removes a picked video that won't be uploaded.
    static func discard(_ video: PendingVideo) {
        try? FileManager.default.removeItem(at: video.fileURL)
    }

    /// Progress for a trip's page: finished and total videos, and the share
    /// of bytes sent.
    func progress(for tripId: String) -> (batch: Batch, fraction: Double)? {
        guard let batch = batches[tripId] else { return nil }
        let jobs = running.values.filter { $0.tripId == tripId } + state.waiting.filter { $0.tripId == tripId }
        let pendingBytes = jobs.reduce(Int64(0)) { $0 + $1.fileSize }
        let sent = jobs.reduce(Int64(0)) { $0 + min(sentBytes[$1.id] ?? 0, $1.fileSize) }
        let doneShare = Double(batch.finished) / Double(max(batch.total, 1))
        let pendingShare = 1 - doneShare
        let fraction = doneShare + (pendingBytes > 0 ? pendingShare * Double(sent) / Double(pendingBytes) : 0)
        return (batch, min(fraction, 1))
    }

    // MARK: Steps

    /// Works through the waiting jobs: starts uploads and adds finished clips.
    private func flush() async {
        guard !isFlushing else { return }
        isFlushing = true
        pendingWork += 1
        defer {
            isFlushing = false
            pendingWork -= 1
            callBackgroundCompletionIfIdle()
        }
        var index = 0
        while index < state.waiting.count {
            let job = state.waiting[index]
            let ok = job.uploadURL == nil ? await startUpload(job) : await addClip(job)
            if ok {
                state.waiting.removeAll { $0.id == job.id }
                save()
            } else {
                index += 1
            }
        }
    }

    /// Gets a signed URL and hands the file to the background session.
    private func startUpload(_ job: Job) async -> Bool {
        let file = Self.pendingFolder.appendingPathComponent(job.storedName)
        guard FileManager.default.fileExists(atPath: file.path) else {
            finish(job, ok: false)
            return true
        }
        struct Upload: Decodable { let uploadURL: String }
        guard let target: Upload = try? await request("/api/objects/upload", body: [:]),
              let url = URL(string: target.uploadURL)
        else { return false }  // No token or offline: try again later.

        var put = URLRequest(url: url)
        put.httpMethod = "PUT"
        put.setValue(Self.contentType(job.filename), forHTTPHeaderField: "Content-Type")
        let task = session.uploadTask(with: put, fromFile: file)
        task.taskDescription = Self.encode(job)
        running[job.id] = job
        task.resume()
        return true
    }

    /// Makes the uploaded file a clip on its trip.
    private func addClip(_ job: Job) async -> Bool {
        guard let url = job.uploadURL else { return true }
        var body: [String: Any] = [
            "fieldNoteId": job.tripId,
            "title": (job.filename as NSString).deletingPathExtension,
            "filename": job.filename,
            "url": url,
            "duration": (job.duration * 1000).rounded() / 1000,
            "fileSize": ByteCountFormatter.string(fromByteCount: job.fileSize, countStyle: .file),
            "videoFormat": (job.filename as NSString).pathExtension.uppercased().isEmpty
                ? "MOV" : (job.filename as NSString).pathExtension.uppercased(),
        ]
        if let recordedAt = job.recordedAt {
            body["recordedAt"] = ISO8601DateFormatter().string(from: recordedAt)
        }
        struct Created: Decodable { let id: String }
        do {
            let _: Created = try await request("/api/video-clips", body: body)
        } catch APIError.httpError(let code, _, _) where code == 400 || code == 404 {
            finish(job, ok: false)  // The trip is gone or the server won't take it.
            return true
        } catch {
            return false
        }
        clipsAdded[job.tripId, default: 0] += 1
        finish(job, ok: true)
        return true
    }

    private func uploadEnded(_ job: Job, url: URL?, success: Bool) {
        running[job.id] = nil
        sentBytes[job.id] = nil
        var next = job
        if success, let url {
            next.uploadURL = url.absoluteString
        } else {
            next.attempt += 1
            if next.attempt >= Self.maxAttempts {
                finish(job, ok: false)
                return
            }
        }
        state.waiting.append(next)
        save()
        // Counted as work, so a background relaunch isn't ended before the
        // clip is added.
        pendingWork += 1
        Task {
            await flush()
            pendingWork -= 1
            callBackgroundCompletionIfIdle()
        }
    }

    /// Counts the video for its trip, and tells the user once the trip's
    /// last one is through.
    private func finish(_ job: Job, ok: Bool) {
        try? FileManager.default.removeItem(at: Self.pendingFolder.appendingPathComponent(job.storedName))
        guard var batch = state.batches[job.tripId] else { return }
        if ok { batch.done += 1 } else { batch.failed += 1 }
        if batch.finished >= batch.total {
            state.batches[job.tripId] = nil
            notify(batch)
        } else {
            state.batches[job.tripId] = batch
        }
        save()
    }

    private func notify(_ batch: Batch) {
        let content = UNMutableNotificationContent()
        if batch.done > 0 {
            content.title = batch.done == 1 ? "Video uploaded" : "\(batch.done) videos uploaded"
            content.body = batch.failed > 0
                ? "\(batch.title): \(batch.failed) couldn't upload."
                : "\(batch.title): they'll play once processing finishes."
        } else {
            content.title = "Video upload failed"
            content.body = "\(batch.title): \(batch.failed == 1 ? "the video" : "\(batch.failed) videos") couldn't upload."
        }
        content.sound = .default
        UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)
        )
    }

    private func save() {
        batches = state.batches
        if let data = try? JSONEncoder().encode(state) {
            UserDefaults.standard.set(data, forKey: Self.stateKey)
        }
    }

    private func callBackgroundCompletionIfIdle() {
        guard backgroundEventsDone, pendingWork == 0, let done = backgroundCompletion else { return }
        backgroundCompletion = nil
        backgroundEventsDone = false
        done()
    }

    /// Like API.post, but with the token kept from when the app was in front,
    /// and without signing out on a 401: a locked phone can't read the keychain.
    private func request<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        if token == nil { token = AuthManager.shared.storedToken }
        guard let token, let url = URL(string: API.base + path) else { throw APIError.unauthorized }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, response) = try await URLSession.shared.data(for: req)
        if let http = response as? HTTPURLResponse, http.statusCode >= 300 {
            if http.statusCode == 401 { self.token = nil }
            throw APIError.httpError(http.statusCode, message: nil, body: data)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    nonisolated private static func encode(_ job: Job) -> String? {
        (try? JSONEncoder().encode(job)).flatMap { String(data: $0, encoding: .utf8) }
    }

    nonisolated private static func decode(_ text: String?) -> Job? {
        guard let data = text?.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(Job.self, from: data)
    }

    private static func contentType(_ filename: String) -> String {
        UTType(filenameExtension: (filename as NSString).pathExtension)?.preferredMIMEType ?? "video/quicktime"
    }
}

extension VideoUploadManager: URLSessionTaskDelegate {
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64,
                                totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        guard let job = Self.decode(task.taskDescription) else { return }
        MainActor.assumeIsolated { sentBytes[job.id] = totalBytesSent }
    }

    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let job = Self.decode(task.taskDescription) else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        let success = error == nil && (200..<300).contains(status)
        let url = task.originalRequest?.url
        MainActor.assumeIsolated { uploadEnded(job, url: url, success: success) }
    }

    nonisolated func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        MainActor.assumeIsolated {
            backgroundEventsDone = true
            callBackgroundCompletionIfIdle()
        }
    }
}

// MARK: - Picker section

/// The Videos section of the new-trip forms: pick from the photo library;
/// they upload in the background once the trip is saved.
struct VideoPickerSection: View {
    @Binding var videos: [PendingVideo]
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var isLoading = false

    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    var body: some View {
        Section {
            ForEach(videos) { video in
                HStack(spacing: 10) {
                    Image(systemName: "video").foregroundColor(muted)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(video.filename).lineLimit(1).truncationMode(.middle)
                        Text(video.subtitle).font(.system(size: 12)).foregroundColor(muted)
                    }
                    Spacer()
                    Button {
                        VideoUploadManager.discard(video)
                        videos.removeAll { $0.id == video.id }
                    } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(video.filename)")
                }
            }
            PhotosPicker(selection: $pickerItems, matching: .videos) {
                HStack {
                    SwiftUI.Label("Add videos", systemImage: "video.badge.plus")
                    if isLoading { Spacer(); ProgressView() }
                }
            }
            .disabled(isLoading)
        } header: {
            Text("Videos")
        } footer: {
            Text(videos.isEmpty
                 ? "Videos are placed on the route by the time they were recorded."
                 : "They upload in the background after you save. You'll get a notification when they're up.")
        }
        .onChange(of: pickerItems) { Task { await load() } }
    }

    private func load() async {
        guard !pickerItems.isEmpty else { return }
        isLoading = true
        VideoUploadManager.shared.requestNotificationPermission()
        let items = pickerItems
        pickerItems = []
        for item in items {
            guard let movie = try? await item.loadTransferable(type: PickedMovie.self),
                  let video = await PendingVideo.load(movie)
            else { continue }
            videos.append(video)
        }
        isLoading = false
    }
}

// MARK: - Trip page progress

/// "Uploading 2 of 3 videos" on a trip's page while its videos go up.
struct VideoUploadBanner: View {
    let tripId: String
    @ObservedObject private var uploads = VideoUploadManager.shared

    private let ink   = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted = Color(red: 138/255, green: 132/255, blue: 126/255)

    var body: some View {
        if let progress = uploads.progress(for: tripId) {
            let batch = progress.batch
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Image(systemName: "icloud.and.arrow.up")
                    Text("Uploading \(min(batch.finished + 1, batch.total)) of \(batch.total) video\(batch.total == 1 ? "" : "s")")
                }
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(ink)
                ProgressView(value: progress.fraction).tint(ink)
                Text("Keeps going if you leave the app. Don't force-quit it.")
                    .font(.system(size: 11))
                    .foregroundColor(muted)
            }
        }
    }
}
