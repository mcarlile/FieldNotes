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

    @State private var mediaCardOpen = true
    @State private var detailsCardOpen = true
    @State private var mediaTab: MediaTab?
    @State private var mediaContentHeight: CGFloat = 400
    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    #endif

    private var videoClips: [VideoClip] { display.videoClips ?? [] }

    /// The Duo (and other wide screens), laid out like the web trip page: the
    /// map fills the screen, the details float in a card on the left that
    /// folds down to its title, and videos and photos share a card on the right.
    private var isWide: Bool {
        #if os(iOS)
        return sizeClass == .regular && !display.mapCoordinates.isEmpty
        #else
        return false
        #endif
    }

    private var photos: [Photo] { display.photos ?? [] }
    private var hasMedia: Bool { !videoClips.isEmpty || !photos.isEmpty }
    private var mediaInCard: Bool { isWide && hasMedia }

    private enum MediaTab: String, CaseIterable { case videos = "Videos", photos = "Photos" }
    /// Videos first when the trip has any, as on the web.
    private var currentTab: MediaTab {
        mediaTab ?? (videoClips.isEmpty ? .photos : .videos)
    }

    private let detailsCardWidth: CGFloat = 340
    private let mediaCardWidth: CGFloat = 360
    /// A playing clip widens the media card, as on the web.
    private var mediaCardExpanded: Bool { currentTab == .videos && playback.clip != nil }

    private var track: TimedTrack? { display.gpxData?.timedTrack }
    private var syncOffset: Double { display.playback?.syncOffsetSeconds ?? 0 }

    /// Where the playing clip was filmed, using the sync offset calibrated on the web.
    private var playhead: CLLocationCoordinate2D? {
        playback.playhead(on: track, syncOffset: syncOffset)
    }

    /// Zoom-in and follow-along for the playing clip, as on the web.
    private var videoFollow: VideoFollow? {
        guard !videoClips.isEmpty else { return nil }
        return VideoFollow(
            bearing: playback.bearing(on: track, syncOffset: syncOffset),
            isPlaying: playback.isPlaying,
            focusRequest: playback.focusRequest,
            angle: display.playback?.cameraAngle,
            clipId: playback.clip?.id,
            clipIndex: videoClips.firstIndex { $0.id == playback.clip?.id } ?? 0,
            segment: playback.clipSegment(on: track, syncOffset: syncOffset)
        )
    }

    var body: some View {
        Group {
            if display.mapCoordinates.isEmpty {
                ScrollView { details.padding(20) }
                    .background(sand.ignoresSafeArea())
            } else if isWide {
                mapWithCards
            } else {
                mapWithPanel
            }
        }
        // On wide screens the trip's name heads the details card instead.
        .navigationTitle(isWide ? "" : display.title)
        .toolbarTitleDisplayMode(.inline)
        .toolbarBackground(display.mapCoordinates.isEmpty ? .automatic : .hidden, for: .navigationBar)
        .task { await loadFull() }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button("Edit") { showEdit = true }
            }
            if mediaInCard {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        withAnimation(.snappy) { mediaCardOpen.toggle() }
                    } label: {
                        Image(systemName: "sidebar.right")
                    }
                    .accessibilityLabel(mediaCardOpen ? "Hide media" : "Show media")
                }
            }
            // Same map buttons, in the same place, as the home heat map.
            if !display.mapCoordinates.isEmpty {
                ToolbarItemGroup(placement: .bottomBar) {
                    MapOptionsMenu(layer: $mapLayer, controls: $mapControls)
                    MapLocateToolbarButton(controls: $mapControls)
                }
            }
        }
        // Playing a clip goes to the 3D chase view, as on the web.
        .onChange(of: playback.focusRequest) { mapControls.is3D = true }
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
    /// details sit in a panel over its bottom that drags up to read more.
    private var mapWithPanel: some View {
        GeometryReader { geo in
            let collapsed = geo.size.height * 0.36
            let expanded = geo.size.height * 0.82
            let panelHeight = panelExpanded ? expanded : collapsed

            ZStack(alignment: .bottom) {
                TrailMap(
                    routes: [TrailRoute(id: display.id, coordinates: display.mapCoordinates)],
                    photos: display.photos ?? [],
                    layer: mapLayer,
                    controls: $mapControls,
                    bottomInset: collapsed,
                    playhead: playhead,
                    video: videoFollow,
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
                    // The panel's bottom sits under the toolbar and home
                    // indicator, so pad past them to reach the last photo.
                    // Scrolling the folded panel opens it.
                    ScrollView {
                        details
                            .padding(.horizontal, 20)
                            .padding(.bottom, 20 + geo.safeAreaInsets.bottom)
                    }
                    .onScrollGeometryChange(for: Bool.self) { scroll in
                        scroll.contentOffset.y + scroll.contentInsets.top > 8
                    } action: { _, scrolled in
                        if scrolled && !panelExpanded {
                            withAnimation(.snappy) { panelExpanded = true }
                        }
                    }
                }
                .frame(height: panelHeight + geo.safeAreaInsets.bottom, alignment: .top)
                .background(sand, in: UnevenRoundedRectangle(topLeadingRadius: 20, topTrailingRadius: 20))
                .shadow(color: .black.opacity(0.15), radius: 12, y: -2)
                .offset(y: geo.safeAreaInsets.bottom)
            }
        }
    }

    // MARK: Wide layout

    /// The full-screen map with the details card over its left side and the
    /// media card over its right; the map keeps the route and the followed
    /// pin in the space between them.
    private var mapWithCards: some View {
        GeometryReader { geo in
            let showMedia = mediaInCard && mediaCardOpen
            let mediaWidth = mediaCardExpanded
                ? max(mediaCardWidth, min(600, geo.size.width - detailsCardWidth - 64))
                : mediaCardWidth

            ZStack(alignment: .top) {
                TrailMap(
                    routes: [TrailRoute(id: display.id, coordinates: display.mapCoordinates)],
                    photos: photos,
                    layer: mapLayer,
                    controls: $mapControls,
                    leadingInset: detailsCardOpen ? detailsCardWidth + 16 : 0,
                    trailingInset: showMedia ? mediaWidth + 16 : 0,
                    playhead: playhead,
                    video: videoFollow,
                    onSelectPhoto: { lightbox = $0 }
                )
                .ignoresSafeArea()

                HStack(alignment: .top, spacing: 16) {
                    detailsCard
                    Spacer(minLength: 0)
                    if showMedia {
                        mediaCard(width: mediaWidth)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
                .padding(16)
            }
            .animation(.snappy, value: mediaCardExpanded)
        }
    }

    /// Sized to its contents, scrolling only once they outgrow the screen.
    /// Folded, only the title row is left.
    private var detailsCard: some View {
        ViewThatFits(in: .vertical) {
            detailsCardBody(scrolls: false)
            detailsCardBody(scrolls: true)
        }
    }

    private func detailsCardBody(scrolls: Bool) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.snappy) { detailsCardOpen.toggle() }
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    Text(display.title)
                        .font(.system(size: 22, weight: .bold, design: .serif))
                        .foregroundColor(ink)
                        .multilineTextAlignment(.leading)
                        .lineLimit(detailsCardOpen ? nil : 1)
                    Spacer()
                    Image(systemName: detailsCardOpen ? "chevron.up" : "chevron.down")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(muted)
                        .frame(width: 28, height: 28)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(detailsCardOpen ? "Collapse details" : "Expand details")
            .padding(.horizontal, 20)
            .padding(.top, 16)
            .padding(.bottom, detailsCardOpen ? 12 : 16)

            if detailsCardOpen {
                if scrolls {
                    ScrollView { details.padding(.horizontal, 20).padding(.bottom, 20) }
                } else {
                    details.padding(.horizontal, 20).padding(.bottom, 20)
                }
            }
        }
        .frame(width: detailsCardWidth)
        .background(sand, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 2)
    }

    // MARK: Media card

    /// Videos and photos in one card pinned to the right, with a switch
    /// between them; the playhead pin keeps moving on the map beside it.
    private func mediaCard(width: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if !videoClips.isEmpty && !photos.isEmpty {
                Picker("Media", selection: Binding(get: { currentTab }, set: { mediaTab = $0 })) {
                    ForEach(MediaTab.allCases, id: \.self) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            // Sized to its contents, scrolling once they outgrow the screen.
            // (Not ViewThatFits: that would build the player twice.)
            ScrollView {
                mediaContent
                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { mediaContentHeight = $0 }
            }
            .scrollBounceBehavior(.basedOnSize)
            .frame(maxHeight: mediaContentHeight)
        }
        .padding(16)
        .frame(width: width)
        .background(sand, in: RoundedRectangle(cornerRadius: 16))
        .shadow(color: .black.opacity(0.15), radius: 12, y: 2)
    }

    @ViewBuilder
    private var mediaContent: some View {
        switch currentTab {
        case .videos: TripVideoSection(clips: videoClips, playback: playback)
        case .photos: photoSection
        }
    }

    // MARK: Details

    private var details: some View {
        VStack(alignment: .leading, spacing: 16) {

            // Trips with video (formerly Studio projects) lead with the
            // player: playback only, calibration stays on the web.
            if !videoClips.isEmpty && !mediaInCard {
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

            if !mediaInCard {
                photoSection
            }
        }
    }

    // MARK: Photos

    @ViewBuilder
    private var photoSection: some View {
        if !photos.isEmpty {
            VStack(alignment: .leading, spacing: 16) {
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

