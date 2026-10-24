import SwiftUI
import CoreLocation

struct NoteDetailView: View {
    let note: FieldNote
    @State private var full: FieldNote?
    @State private var lightbox: Photo?
    @State private var showEdit = false
    @AppStorage("mapLayer") private var mapLayer: MapLayer = .standard

    private var display: FieldNote { full ?? note }

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    @State private var panelExpanded = false
    @State private var mapControls = MapControls()
    @StateObject private var playback = TripVideoPlayback()
    /// On wide screens (the Duo unfolded) videos sit in a side panel beside the map.
    @State private var videoPanelOpen = true

    /// Width from which a trip's videos move out of the details panel into a
    /// collapsible column on the right, with the map still beside them.
    private static let sideVideoMinWidth: CGFloat = 700

    private var videoClips: [VideoClip] { display.videoClips ?? [] }

    /// Where the playing clip was filmed, using the sync offset calibrated on the web.
    private var playhead: CLLocationCoordinate2D? {
        playback.playhead(on: display.gpxData?.timedTrack,
                          syncOffset: display.playback?.syncOffsetSeconds ?? 0)
    }

    var body: some View {
        Group {
            if display.mapCoordinates.isEmpty {
                ScrollView { details(includeVideo: true).padding(20) }
                    .background(sand.ignoresSafeArea())
            } else {
                mapWithPanel
            }
        }
        .navigationTitle(display.title)
        .toolbarTitleDisplayMode(.inline)
        .toolbarBackground(display.mapCoordinates.isEmpty ? .automatic : .hidden, for: .navigationBar)
        .task { await loadFull() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { showEdit = true }
            }
            // Same map buttons, in the same place, as the home heat map.
            if !display.mapCoordinates.isEmpty {
                ToolbarItemGroup(placement: .bottomBar) {
                    MapOptionsMenu(layer: $mapLayer, controls: $mapControls)
                    MapLocateToolbarButton(controls: $mapControls)
                }
            }
        }
        .sheet(isPresented: $showEdit) {
            TripFormView(existing: display) { _ in
                Task { await loadFull() }
            }
        }
        .lightboxCover(item: $lightbox) { photo in
            LightboxView(
                initial: photo,
                photos: display.photos ?? [],
                onDismiss: { lightbox = nil }
            )
        }
    }

    // MARK: Full-screen map

    /// The map fills the screen under a see-through navigation bar; the trip
    /// details sit in a panel over its bottom that drags up to read more. On
    /// wide screens a trip's videos get their own collapsible column on the right.
    private var mapWithPanel: some View {
        GeometryReader { geo in
            let sideVideo = !videoClips.isEmpty && geo.size.width >= Self.sideVideoMinWidth
            HStack(spacing: 0) {
                mapAndDetails(geo: geo, includeVideo: !sideVideo)
                    .overlay(alignment: .topTrailing) {
                        if sideVideo && !videoPanelOpen {
                            Button {
                                withAnimation(.snappy) { videoPanelOpen = true }
                            } label: {
                                Label("Videos", systemImage: "sidebar.right")
                                    .font(.system(size: 14, weight: .semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(.regularMaterial, in: Capsule())
                            }
                            .buttonStyle(.plain)
                            .padding(12)
                            .accessibilityLabel("Show videos")
                        }
                    }
                if sideVideo && videoPanelOpen {
                    videoSidePanel
                        .frame(width: min(420, geo.size.width * 0.42))
                        .transition(.move(edge: .trailing))
                }
            }
        }
    }

    /// The trip's videos in a column beside the map: player on top, clips below.
    private var videoSidePanel: some View {
        ScrollView {
            TripVideoSection(clips: videoClips, playback: playback, stacked: true) {
                withAnimation(.snappy) { videoPanelOpen = false }
            }
            .padding(16)
        }
        .background(sand.ignoresSafeArea(edges: .bottom))
        .overlay(alignment: .leading) {
            Rectangle().fill(border).frame(width: 1).ignoresSafeArea()
        }
    }

    private func mapAndDetails(geo: GeometryProxy, includeVideo: Bool) -> some View {
            let collapsed = geo.size.height * 0.36
            let expanded = geo.size.height * 0.82
            let panelHeight = panelExpanded ? expanded : collapsed

            return ZStack(alignment: .bottom) {
                TrailMap(
                    routes: [TrailRoute(id: display.id, coordinates: display.mapCoordinates)],
                    photos: display.photos ?? [],
                    layer: mapLayer,
                    controls: $mapControls,
                    bottomInset: collapsed,
                    playhead: playhead,
                    onSelectPhoto: { lightbox = $0 }
                )
                .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Grabber: drag or tap to resize the panel.
                    Capsule()
                        .fill(muted.opacity(0.5))
                        .frame(width: 40, height: 5)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .contentShape(Rectangle())
                        .onTapGesture { withAnimation(.snappy) { panelExpanded.toggle() } }
                        .gesture(DragGesture(minimumDistance: 8).onEnded { drag in
                            withAnimation(.snappy) {
                                if drag.translation.height < -30 { panelExpanded = true }
                                if drag.translation.height > 30 { panelExpanded = false }
                            }
                        })
                    ScrollView {
                        details(includeVideo: includeVideo).padding(.horizontal, 20).padding(.bottom, 20)
                    }
                    .scrollDisabled(!panelExpanded)
                }
                .frame(height: panelHeight + geo.safeAreaInsets.bottom, alignment: .top)
                .background(sand, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
                .shadow(color: .black.opacity(0.15), radius: 12, y: -2)
                .offset(y: geo.safeAreaInsets.bottom)
            }
    }

    // MARK: Details

    private func details(includeVideo: Bool) -> some View {
        VStack(alignment: .leading, spacing: 16) {

            // Trips with video (formerly Studio projects) lead with the
            // player: playback only, calibration stays on the web.
            if includeVideo && !videoClips.isEmpty {
                TripVideoSection(clips: videoClips, playback: playback)
            }

            // Type badges
            HStack(spacing: 5) {
                ForEach(display.tripType, id: \.self) { type in
                    Text(type.capitalized)
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(muted)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(border)
                        .cornerRadius(4)
                }
            }

            Text(display.formattedDate)
                .font(.system(size: 13))
                .foregroundColor(muted)

            // Stats
            if display.distance != nil || display.elevationGain != nil {
                HStack(spacing: 0) {
                    if let d = display.distance {
                        StatCell(value: String(format: "%.1f", d), label: "Miles")
                    }
                    if let e = display.elevationGain {
                        StatCell(value: "\(Int(e))", label: "ft gain")
                    }
                    if let count = display.photos?.count, count > 0 {
                        StatCell(value: "\(count)", label: "Photos")
                    }
                    if !videoClips.isEmpty {
                        StatCell(value: "\(videoClips.count)", label: "Videos")
                    }
                }
                .padding(16)
                .background(Color.white.opacity(0.6))
                .clipShape(RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(border))
            }

            // Description
            if let desc = display.description, !desc.isEmpty {
                Text(desc)
                    .font(.system(size: 16))
                    .foregroundColor(ink)
                    .lineSpacing(6)
            }

            // Photo grid
            if let photos = display.photos, !photos.isEmpty {
                Text("PHOTOS · \(photos.count)")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(muted)
                    .tracking(0.8)

                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)],
                    spacing: 10
                ) {
                    ForEach(photos) { photo in
                        Rectangle().fill(border)
                            .frame(height: 160)
                            .overlay {
                                AsyncImage(url: photo.imageURL) { phase in
                                    switch phase {
                                    case .success(let img):
                                        img.resizable().scaledToFill()
                                    case .failure:
                                        Image(systemName: "photo.badge.exclamationmark")
                                            .foregroundColor(muted)
                                    default:
                                        ProgressView()
                                    }
                                }
                            }
                            .clipped()
                        .cornerRadius(8)
                        .onTapGesture { lightbox = photo }
                    }
                }
            }
        }
    }

    private func loadFull() async {
        full = try? await API.get("/api/field-notes/\(note.id)")
    }
}

// MARK: - Stat cell

struct StatCell: View {
    let value: String
    let label: String

    private let ink   = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let muted = Color(red: 154/255, green: 148/255, blue: 142/255)

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.system(size: 20, weight: .bold))
                .foregroundColor(ink)
            Text(label.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .tracking(0.4)
                .foregroundColor(muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Lightbox

struct LightboxView: View {
    let initial: Photo
    let photos: [Photo]
    let onDismiss: () -> Void

    @State private var current: Photo

    init(initial: Photo, photos: [Photo], onDismiss: @escaping () -> Void) {
        self.initial = initial
        self.photos = photos
        self.onDismiss = onDismiss
        _current = State(initialValue: initial)
    }

    private var idx: Int { photos.firstIndex(where: { $0.id == current.id }) ?? 0 }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            AsyncImage(url: current.imageURL) { img in
                img.resizable().scaledToFit()
            } placeholder: {
                ProgressView().tint(.white)
            }

            VStack {
                HStack {
                    Spacer()
                    Button { onDismiss() } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.white)
                            .padding(16)
                    }
                }
                Spacer()
                if photos.count > 1 {
                    HStack(spacing: 32) {
                        Button { current = photos[(idx - 1 + photos.count) % photos.count] } label: {
                            Image(systemName: "chevron.left").font(.system(size: 22)).foregroundColor(.white)
                        }
                        Text("\(idx + 1) / \(photos.count)")
                            .foregroundColor(.white.opacity(0.5))
                            .font(.system(size: 14))
                        Button { current = photos[(idx + 1) % photos.count] } label: {
                            Image(systemName: "chevron.right").font(.system(size: 22)).foregroundColor(.white)
                        }
                    }
                    .padding(.bottom, 40)
                }
            }
        }
    }
}

// MARK: - Cross-platform lightbox presentation

private extension View {
    @ViewBuilder
    func lightboxCover<Item: Identifiable, Content: View>(
        item: Binding<Item?>,
        @ViewBuilder content: @escaping (Item) -> Content
    ) -> some View {
        #if os(iOS) || os(visionOS) || os(tvOS)
        self.fullScreenCover(item: item, content: content)
        #else
        self.sheet(item: item, content: content)
        #endif
    }
}

