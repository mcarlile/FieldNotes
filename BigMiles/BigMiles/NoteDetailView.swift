import SwiftUI

struct NoteDetailView: View {
    let note: FieldNote
    @State private var full: FieldNote?
    @State private var lightbox: Photo?

    private var display: FieldNote { full ?? note }

    private let ink    = Color(red: 26/255,  green: 24/255,  blue: 21/255)
    private let sand   = Color(red: 245/255, green: 240/255, blue: 232/255)
    private let muted  = Color(red: 138/255, green: 132/255, blue: 126/255)
    private let border = Color(red: 232/255, green: 226/255, blue: 214/255)

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {

                // Map
                if !display.mapCoordinates.isEmpty {
                    RouteMapView(coordinates: display.mapCoordinates)
                        .frame(height: 260)
                }

                VStack(alignment: .leading, spacing: 16) {

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
                                AsyncImage(url: URL(string: photo.url)) { img in
                                    img.resizable().scaledToFill()
                                } placeholder: {
                                    Rectangle().fill(border)
                                }
                                .frame(height: 160)
                                .clipped()
                                .cornerRadius(8)
                                .onTapGesture { lightbox = photo }
                            }
                        }
                    }
                }
                .padding(20)
            }
        }
        .background(sand.ignoresSafeArea())
        .navigationTitle(display.title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await loadFull() }
        .fullScreenCover(item: $lightbox) { photo in
            LightboxView(
                initial: photo,
                photos: display.photos ?? [],
                onDismiss: { lightbox = nil }
            )
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

            AsyncImage(url: URL(string: current.url)) { img in
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
