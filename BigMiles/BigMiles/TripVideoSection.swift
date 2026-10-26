import SwiftUI
import AVKit
import AVFoundation
import CoreMedia
import Combine
import CoreLocation

/// Plays a trip's video clips and reports where on the route the current
/// frame was filmed. Playback only: the sync offset is the one calibrated on
/// the web, and the app has no calibration controls.
@MainActor
final class TripVideoPlayback: ObservableObject {
    let player = AVPlayer()
    @Published private(set) var clip: VideoClip?
    @Published private(set) var seconds: Double = 0
    @Published private(set) var isPlaying = false
    /// Bumped each time a clip starts playing; the map zooms in behind the
    /// pin and starts following it, as on the web.
    @Published private(set) var focusRequest = 0
    /// The video fills the screen; the same player keeps going.
    @Published var fullScreen = false
    private var timeObserver: Any?
    private var statusObserver: AnyCancellable?

    init() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.seconds = time.seconds.isFinite ? time.seconds : 0 }
        }
        statusObserver = player.publisher(for: \.timeControlStatus)
            .receive(on: DispatchQueue.main)
            .sink { [weak self] status in
                guard let self else { return }
                // Buffering counts as playing, so a stall doesn't re-zoom the map.
                let playing = status != .paused
                if playing && !isPlaying { focusRequest += 1 }
                isPlaying = playing
            }
    }

    deinit {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
    }

    func play(_ clip: VideoClip) {
        guard clip.isReady, let url = clip.streamURL else { return }
        if self.clip?.id != clip.id {
            self.clip = clip
            seconds = 0
            player.replaceCurrentItem(with: AVPlayerItem(url: url))
        }
        player.play()
    }

    func stop() {
        player.pause()
    }

    /// The route position of the frame on screen.
    func playhead(on track: TimedTrack?, syncOffset: Double) -> CLLocationCoordinate2D? {
        guard let clip, let track else { return nil }
        return track.coordinate(at: clip.startTime + syncOffset + seconds)
    }

    /// The direction of travel at the frame on screen; the chase-cam faces it.
    func bearing(on track: TimedTrack?, syncOffset: Double) -> Double? {
        guard let clip, let track else { return nil }
        return track.bearing(at: clip.startTime + syncOffset + seconds)
    }

    /// The stretch of route the selected clip covers.
    func clipSegment(on track: TimedTrack?, syncOffset: Double) -> [CLLocationCoordinate2D] {
        guard let clip, let track else { return [] }
        return track.segment(from: clip.startTime + syncOffset, to: clip.endTime + syncOffset)
    }
}

/// The trip page's video section: the player, then the clips to choose from.
struct TripVideoSection: View {
    let clips: [VideoClip]
    @ObservedObject var playback: TripVideoPlayback

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("VIDEOS · \(clips.count)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(muted)
                .tracking(0.8)

            ZStack {
                Color.black
                // One player can only show in one place, so the inline view
                // steps aside while the video is full screen.
                if playback.clip != nil && !playback.fullScreen {
                    VideoPlayer(player: playback.player)
                        .overlay(alignment: .topTrailing) {
                            Button { playback.fullScreen = true } label: {
                                Image(systemName: "arrow.up.left.and.arrow.down.right")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundColor(.white)
                                    .padding(8)
                                    .background(.black.opacity(0.45), in: Circle())
                            }
                            .buttonStyle(.plain)
                            .padding(8)
                            .accessibilityLabel("Full screen")
                        }
                } else if playback.clip == nil {
                    VStack(spacing: 6) {
                        Image(systemName: "play.rectangle")
                            .font(.system(size: 28))
                        Text("Tap a clip to play")
                            .font(.system(size: 13))
                    }
                    .foregroundColor(.white.opacity(0.7))
                }
            }
            .aspectRatio(16 / 9, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 10))

            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 10) {
                    ForEach(clips) { clip in
                        Button { playback.play(clip) } label: { card(clip) }
                            .buttonStyle(.plain)
                            .disabled(!clip.isReady)
                    }
                }
            }
        }
        // Going full screen covers this view; only leaving the trip stops it.
        .onDisappear { if !playback.fullScreen { playback.stop() } }
        .fullScreenVideo(isPresented: $playback.fullScreen) {
            FullScreenVideo(playback: playback)
        }
    }

    private func card(_ clip: VideoClip) -> some View {
        let selected = playback.clip?.id == clip.id
        return VStack(alignment: .leading, spacing: 4) {
            ZStack {
                Rectangle().fill(Color.black)
                AsyncImage(url: clip.thumbnailURL) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    Image(systemName: "video").foregroundColor(.gray)
                }
                if !clip.isReady {
                    Color.black.opacity(0.55)
                    Text(clip.processingStatus == "error" ? "Failed" : "Processing…")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.white)
                }
            }
            .frame(width: 140, height: 79)
            .clipShape(RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).stroke(selected ? ink : border, lineWidth: selected ? 2 : 1))

            Text(clip.title)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(ink)
                .lineLimit(1)
            Text(clip.timeRange)
                .font(.system(size: 11))
                .foregroundColor(muted)
        }
        .frame(width: 140, alignment: .leading)
        .contentShape(Rectangle())
    }
}

/// The playing clip filling the screen, with a button back to the trip.
private struct FullScreenVideo: View {
    @ObservedObject var playback: TripVideoPlayback

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black.ignoresSafeArea()
            VideoPlayer(player: playback.player)
                .ignoresSafeArea()
            Button { playback.fullScreen = false } label: {
                Image(systemName: "arrow.down.right.and.arrow.up.left")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .padding(10)
                    .background(.black.opacity(0.45), in: Circle())
            }
            .buttonStyle(.plain)
            .padding(16)
            .accessibilityLabel("Exit full screen")
        }
    }
}

private extension View {
    @ViewBuilder
    func fullScreenVideo<Content: View>(
        isPresented: Binding<Bool>,
        @ViewBuilder content: @escaping () -> Content
    ) -> some View {
        #if os(iOS) || os(visionOS) || os(tvOS)
        self.fullScreenCover(isPresented: isPresented, content: content)
        #else
        self.sheet(isPresented: isPresented, content: content)
        #endif
    }
}
