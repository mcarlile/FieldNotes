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
    private var timeObserver: Any?

    init() {
        timeObserver = player.addPeriodicTimeObserver(
            forInterval: CMTime(seconds: 0.25, preferredTimescale: 600), queue: .main
        ) { [weak self] time in
            MainActor.assumeIsolated { self?.seconds = time.seconds.isFinite ? time.seconds : 0 }
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
}

/// The trip page's video section: the player, then the clips to choose from.
struct TripVideoSection: View {
    let clips: [VideoClip]
    @ObservedObject var playback: TripVideoPlayback
    /// In the side column on wide screens the clips wrap into a grid under
    /// the player instead of scrolling sideways.
    var stacked = false
    /// Shows a button that hides the side column.
    var onCollapse: (() -> Void)? = nil

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("VIDEOS · \(clips.count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(muted)
                    .tracking(0.8)
                Spacer()
                if let onCollapse {
                    Button(action: onCollapse) {
                        Image(systemName: "sidebar.right")
                            .font(.system(size: 15))
                            .foregroundColor(muted)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Hide videos")
                }
            }

            ZStack {
                Color.black
                if playback.clip != nil {
                    VideoPlayer(player: playback.player)
                } else {
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

            if stacked {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10, alignment: .top)], spacing: 12) {
                    clipButtons
                }
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 10) { clipButtons }
                }
            }
        }
        .onDisappear { playback.stop() }
    }

    private var clipButtons: some View {
        ForEach(clips) { clip in
            Button { playback.play(clip) } label: { card(clip) }
                .buttonStyle(.plain)
                .disabled(!clip.isReady)
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
