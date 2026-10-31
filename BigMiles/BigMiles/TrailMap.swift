import SwiftUI
import MapKit
import CoreLocation
#if os(iOS)
import MapboxMaps
#endif

// MARK: - Mapbox base layers

/// The web route map's "Map layer" choices.
enum MapLayer: String, CaseIterable, Identifiable {
    case standard = "outdoors-v12"
    case topo = "topo"
    case satellite = "satellite-streets-v12"

    var id: String { rawValue }

    var name: String {
        switch self {
        case .standard:  return "Default"
        case .topo:      return "Topo"
        case .satellite: return "Satellite"
        }
    }

    /// Topo is Mapbox Light with hillshade and contour lines added on top.
    var styleURI: StyleURI? {
        StyleURI(rawValue: "mapbox://styles/mapbox/\(self == .topo ? "light-v11" : rawValue)")
    }
}

private struct MapControlButton: View {
    var systemImage: String? = nil
    var text: String? = nil
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Group {
                if let systemImage { Image(systemName: systemImage) }
                else { Text(text ?? "").font(.system(size: 13, weight: .bold)) }
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundColor(.black)
            .frame(width: 36, height: 36)
            .background(.regularMaterial, in: Circle())
        }
        .accessibilityLabel(label)
    }
}

struct TrailRoute: Identifiable {
    let id: String
    let coordinates: [CLLocationCoordinate2D]
}

/// The map's 3D and "show my location" state, for screens that put those
/// buttons in their own toolbar.
struct MapControls {
    var is3D = false
    /// Bump to fly to the user's location.
    var locateRequest = 0
}

/// What the map needs to follow a playing clip like the web player: zoom in
/// behind the pin when a clip starts, then keep it in view as it moves.
struct VideoFollow {
    /// Direction of travel at the pin; the 3D chase-cam faces it.
    var bearing: Double?
    var isPlaying: Bool
    /// Changes each time a clip starts playing.
    var focusRequest: Int
    /// The follow-cam angle calibrated on the web, if any.
    var angle: FieldNote.CameraAngle?
    /// The selected clip's stretch of route.
    var clipId: String?
    var segment: [CLLocationCoordinate2D] = []
    /// Every clip's stretch of route, drawn in yellow over the trip line.
    var segments: [[CLLocationCoordinate2D]] = []
}

/// A Mapbox map with routes and photo pins, plus location and 3D terrain
/// controls. In heat mode routes are colored by how many trips overlap, like
/// the web heat map.
struct TrailMap: View {
    var routes: [TrailRoute]
    var photos: [Photo] = []
    var heat = false
    var layer: MapLayer = .standard
    /// When given, the caller shows the location and 3D buttons itself.
    var controls: Binding<MapControls>? = nil
    /// Open on the user's location (when they allow it) instead of the routes.
    var startAtUserLocation = false
    /// Height covered by something floating over the bottom of the map (a
    /// details panel): the controls sit above it and the route fits above it.
    var bottomInset: CGFloat = 0
    /// Width covered by something floating over the left of the map (a
    /// details card): the followed pin stays centered in the rest.
    var leadingInset: CGFloat = 0
    /// Width covered by something floating over the right of the map (a
    /// media card), likewise kept clear.
    var trailingInset: CGFloat = 0
    /// Where the playing video was filmed; drawn as a pin that moves with it.
    var playhead: CLLocationCoordinate2D? = nil
    var video: VideoFollow? = nil
    var onSelectRoutes: (([String]) -> Void)? = nil
    var onSelectPhoto: ((Photo) -> Void)? = nil

    @State private var ownControls = MapControls()
    /// True once the user pans away from the pin while a clip plays.
    @State private var followPaused = false
    @State private var resumeRequest = 0

    var body: some View {
        #if os(iOS)
        let state = controls?.wrappedValue ?? ownControls
        TrailMapView(routes: routes, photos: photos, heat: heat, layer: layer, is3D: state.is3D,
                     locateRequest: state.locateRequest, startAtUserLocation: startAtUserLocation,
                     bottomInset: bottomInset, leadingInset: leadingInset, trailingInset: trailingInset, playhead: playhead,
                     video: video, resumeRequest: resumeRequest,
                     onFollowPausedChange: { followPaused = $0 },
                     onSelectRoutes: onSelectRoutes, onSelectPhoto: onSelectPhoto)
            .overlay(alignment: .bottom) {
                // Like the web's "Follow" button: back to the pin after panning away.
                if followPaused, video?.isPlaying == true {
                    Button {
                        resumeRequest += 1
                    } label: {
                        Label("Follow", systemImage: "location.north.line.fill")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.black)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .padding(.leading, leadingInset)
                    .padding(.trailing, trailingInset)
                    .padding(.bottom, 16 + bottomInset)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if controls == nil {
                    VStack(spacing: 8) {
                        MapLocateButton(controls: $ownControls)
                        Map3DButton(controls: $ownControls)
                    }
                    .padding(12)
                    .padding(.bottom, 16 + bottomInset)
                }
            }
        #else
        RouteMapView(coordinates: routes.first?.coordinates ?? [])
        #endif
    }
}

/// Toolbar version of the map controls, shared by the home heat map and
/// trip pages so both put the same buttons in the same place (the Duo's
/// sidebar). Layers and 3D share a menu: the sidebar fits three buttons
/// beside search.
struct MapOptionsMenu: View {
    @Binding var layer: MapLayer
    @Binding var controls: MapControls

    var body: some View {
        Menu {
            Picker("Map layer", selection: $layer) {
                ForEach(MapLayer.allCases) { Text($0.name).tag($0) }
            }
            Toggle("3D terrain", systemImage: "mountain.2", isOn: $controls.is3D)
        } label: {
            Image(systemName: "square.3.layers.3d")
        }
        .accessibilityLabel("Map options")
    }
}

struct MapLocateToolbarButton: View {
    @Binding var controls: MapControls

    var body: some View {
        Button { controls.locateRequest += 1 } label: {
            Image(systemName: "location")
        }
        .accessibilityLabel("Show my location")
    }
}

struct MapLocateButton: View {
    @Binding var controls: MapControls
    var body: some View {
        MapControlButton(systemImage: "location", label: "Show my location") {
            controls.locateRequest += 1
        }
    }
}

struct Map3DButton: View {
    @Binding var controls: MapControls
    var body: some View {
        MapControlButton(text: controls.is3D ? "2D" : "3D", label: controls.is3D ? "Flat map" : "3D map") {
            controls.is3D.toggle()
        }
    }
}

#if os(iOS)

private struct TrailMapView: UIViewRepresentable {
    var routes: [TrailRoute]
    var photos: [Photo]
    var heat: Bool
    var layer: MapLayer
    var is3D: Bool
    var locateRequest: Int
    var startAtUserLocation: Bool
    var bottomInset: CGFloat
    var leadingInset: CGFloat
    var trailingInset: CGFloat
    var playhead: CLLocationCoordinate2D?
    var video: VideoFollow?
    var resumeRequest: Int
    var onFollowPausedChange: (Bool) -> Void
    var onSelectRoutes: (([String]) -> Void)?
    var onSelectPhoto: ((Photo) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MapView {
        let map = MapView(frame: .zero, mapInitOptions: MapInitOptions(
            styleURI: layer.styleURI
        ))
        map.ornaments.options.scaleBar.visibility = .hidden
        context.coordinator.attach(to: map, layer: layer)
        if startAtUserLocation { context.coordinator.centerOnFirstLocation() }
        return map
    }

    func updateUIView(_ map: MapView, context: Context) {
        let c = context.coordinator
        c.parent = self
        c.bottomInset = bottomInset
        c.leadingInset = leadingInset
        c.trailingInset = trailingInset
        c.playhead = playhead
        c.video = video
        c.update(layer: layer, is3D: is3D, routes: routes, heat: heat, photos: photos)
        c.movePlayhead(to: playhead)
        c.followVideo(resumeRequest: resumeRequest)
        if c.locateRequest != locateRequest {
            c.locateRequest = locateRequest
            c.followUser()
        }
    }

    // MARK: Coordinator

    final class Coordinator: NSObject, GestureManagerDelegate {
        var parent: TrailMapView?
        var locateRequest = 0
        var bottomInset: CGFloat = 0
        var leadingInset: CGFloat = 0
        var trailingInset: CGFloat = 0
        var playhead: CLLocationCoordinate2D?
        var video: VideoFollow?

        private weak var map: MapView?
        private var cancelables = Set<AnyCancelable>()
        private var styleReady = false
        private var layer: MapLayer?
        private var is3D = false
        private var routeKey = ""
        private var photoKey = "-"
        private var fitted = false
        private var routes: [TrailRoute] = []
        private var heat = false
        private var photos: [Photo] = []
        private var pins: [ViewAnnotation] = []
        private var playheadPin: ViewAnnotation?
        private var thumbnails: [String: UIImage] = [:]

        private let sourceId = "trail-routes"
        private let layerId = "trail-routes-line"
        private let demId = "mapbox-dem"
        private let clipSourceId = "clip-segment"
        private let clipLayerId = "clip-segment-line"

        // Follow-cam, as on the web: keep the pin in view until the user pans
        // away. Zooming or tilting keeps tracking; turning the map stops the
        // camera swinging to face the direction of travel until the next play.
        private var following = true
        private var autoBearing = true
        private var userGesture = false
        private var focusAnimatingUntil = Date.distantPast
        private var focusRequest = 0
        private var resumeRequest = 0
        private var clipKey = ""

        private static let ink = UIColor(red: 26/255, green: 24/255, blue: 21/255, alpha: 1)
        // The web heat map's blue / orange / red for 1, 2–3 and 4+ overlapping trips.
        private static let heatColors = [
            UIColor(red: 59/255, green: 130/255, blue: 246/255, alpha: 1),
            UIColor(red: 245/255, green: 158/255, blue: 11/255, alpha: 1),
            UIColor(red: 220/255, green: 38/255, blue: 38/255, alpha: 1),
        ]

        func attach(to map: MapView, layer: MapLayer) {
            self.map = map
            self.layer = layer
            // Sources and layers are dropped whenever the style changes, so
            // everything is re-added each time a style finishes loading.
            map.mapboxMap.onStyleLoaded.observe { [weak self] _ in
                self?.styleReady = true
                self?.installTopoLayers()
                self?.installRouteLayer()
                self?.installClipSegment()
                self?.applyTerrain()
            }.store(in: &cancelables)
            map.mapboxMap.onMapLoaded.observeNext { [weak self] _ in
                self?.fitIfNeeded()
            }.store(in: &cancelables)
            map.gestures.onMapTap.observe { [weak self] context in
                self?.tapped(at: context.point)
            }.store(in: &cancelables)
            map.gestures.delegate = self
        }

        func update(layer: MapLayer, is3D: Bool, routes: [TrailRoute], heat: Bool, photos: [Photo]) {
            guard let map else { return }
            if self.layer != layer {
                self.layer = layer
                styleReady = false
                map.mapboxMap.styleURI = layer.styleURI
            }
            if self.is3D != is3D {
                self.is3D = is3D
                applyTerrain()
                // Playing a clip turns 3D on; that goes straight to the chase view.
                if is3D, following, video?.isPlaying == true {
                    focus(duration: 1.4)
                } else {
                    map.camera.ease(to: CameraOptions(pitch: is3D ? 60 : 0), duration: 0.6)
                }
            }
            let key = routes.map { "\($0.id):\($0.coordinates.count)" }.joined(separator: ",") + "|\(heat)"
            if key != routeKey {
                routeKey = key
                self.routes = routes
                self.heat = heat
                fitted = false
                installRouteLayer()
                fitIfNeeded()
            }
            let pKey = photos.map(\.id).joined(separator: ",")
            if pKey != photoKey {
                photoKey = pKey
                self.photos = photos
                placePins()
            }
        }

        // MARK: Routes

        private func installRouteLayer() {
            guard let map, styleReady else { return }
            let style: MapboxMap = map.mapboxMap
            let collection = FeatureCollection(features: heat ? densityFeatures() : plainFeatures())

            if style.sourceExists(withId: sourceId) {
                style.updateGeoJSONSource(withId: sourceId, geoJSON: .featureCollection(collection))
                return
            }
            var source = GeoJSONSource(id: sourceId)
            source.data = .featureCollection(collection)
            try? style.addSource(source)

            var line = LineLayer(id: layerId, source: sourceId)
            line.lineCap = .constant(.round)
            line.lineJoin = .constant(.round)
            line.lineColor = .expression(Exp(.match) {
                Exp(.get) { "level" }
                0; Self.heatColors[0]
                1; Self.heatColors[1]
                2; Self.heatColors[2]
                Self.ink
            })
            line.lineWidth = .expression(Exp(.match) {
                Exp(.get) { "level" }
                1; 3.25
                2; 4
                heat ? 2.5 : 3.5
            })
            line.lineOpacity = .constant(0.9)
            line.lineSortKey = .expression(Exp(.get) { "level" })
            if style.layerExists(withId: clipLayerId) {
                try? style.addLayer(line, layerPosition: .below(clipLayerId))
            } else {
                try? style.addLayer(line)
            }
        }

        private func plainFeatures() -> [Feature] {
            routes.filter { $0.coordinates.count >= 2 }.map { route in
                var f = Feature(geometry: .lineString(LineString(route.coordinates)))
                f.properties = ["id": .string(route.id), "level": .number(-1)]
                return f
            }
        }

        /// Splits each route into runs by how many routes pass through the
        /// same ~100 m cell: 1 route, 2–3, or 4+.
        private func densityFeatures() -> [Feature] {
            struct Cell: Hashable { let x: Int; let y: Int }
            func cell(_ c: CLLocationCoordinate2D) -> Cell {
                Cell(x: Int((c.longitude * 1000).rounded(.down)), y: Int((c.latitude * 1000).rounded(.down)))
            }
            var counts: [Cell: Int] = [:]
            for route in routes {
                for cell in Set(route.coordinates.map(cell)) { counts[cell, default: 0] += 1 }
            }
            func level(_ c: CLLocationCoordinate2D) -> Int {
                switch counts[cell(c)] ?? 1 {
                case ...1: return 0
                case 2...3: return 1
                default: return 2
                }
            }

            var features: [Feature] = []
            for route in routes where route.coordinates.count >= 2 {
                var run = [route.coordinates[0]]
                var runLevel = level(route.coordinates[0])
                func flush() {
                    guard run.count >= 2 else { return }
                    var f = Feature(geometry: .lineString(LineString(run)))
                    f.properties = ["id": .string(route.id), "level": .number(Double(runLevel))]
                    features.append(f)
                }
                for coord in route.coordinates.dropFirst() {
                    let l = level(coord)
                    run.append(coord)
                    if l != runLevel {
                        flush()
                        run = [coord]
                        runLevel = l
                    }
                }
                flush()
            }
            return features
        }

        private func fitIfNeeded() {
            guard let map, !fitted, map.bounds.width > 0 else { return }
            let coords = routes.flatMap(\.coordinates)
            guard coords.count >= 2 else { return }
            let padding = UIEdgeInsets(top: 100, left: 40 + leadingInset, bottom: 60 + bottomInset, right: 40 + trailingInset)
            if let camera = try? map.mapboxMap.camera(
                for: coords, camera: CameraOptions(pitch: is3D ? 60 : 0),
                coordinatesPadding: padding, maxZoom: 15, offset: nil
            ) {
                map.mapboxMap.setCamera(to: camera)
                fitted = true
            }
        }

        // MARK: Topo

        /// Hillshade plus contour lines from Mapbox Terrain, labeled in feet
        /// on every index contour, under the routes.
        private func installTopoLayers() {
            guard let map, layer == .topo else { return }
            let style: MapboxMap = map.mapboxMap
            ensureDemSource()

            var shade = HillshadeLayer(id: "topo-hillshade", source: demId)
            shade.hillshadeExaggeration = .constant(0.35)
            shade.hillshadeShadowColor = .constant(StyleColor(UIColor(red: 0.35, green: 0.3, blue: 0.25, alpha: 1)))
            try? style.addLayer(shade)

            var contours = VectorSource(id: "topo-terrain")
            contours.url = "mapbox://mapbox.mapbox-terrain-v2"
            try? style.addSource(contours)

            // `index` marks every 5th / 10th line; those are drawn heavier and labeled.
            let isIndex = Exp(.match) { Exp(.get) { "index" }; [5, 10]; true; false }
            let brown = UIColor(red: 0.62, green: 0.45, blue: 0.3, alpha: 1)

            var lines = LineLayer(id: "topo-contours", source: "topo-terrain")
            lines.sourceLayer = "contour"
            lines.lineColor = .constant(StyleColor(brown))
            lines.lineOpacity = .constant(0.7)
            lines.lineWidth = .expression(Exp(.switchCase) { isIndex; 1.3; 0.6 })
            try? style.addLayer(lines)

            var labels = SymbolLayer(id: "topo-contour-labels", source: "topo-terrain")
            labels.sourceLayer = "contour"
            labels.filter = isIndex
            labels.symbolPlacement = .constant(.line)
            labels.textField = .expression(Exp(.concat) {
                Exp(.toString) { Exp(.round) { Exp(.product) { Exp(.get) { "ele" }; 3.28084 } } }
                " ft"
            })
            labels.textSize = .constant(10)
            labels.textColor = .constant(StyleColor(brown))
            labels.textHaloColor = .constant(StyleColor(.white))
            labels.textHaloWidth = .constant(1.2)
            try? style.addLayer(labels)
        }

        private func ensureDemSource() {
            guard let map else { return }
            let style: MapboxMap = map.mapboxMap
            guard !style.sourceExists(withId: demId) else { return }
            var dem = RasterDemSource(id: demId)
            dem.url = "mapbox://mapbox.mapbox-terrain-dem-v1"
            dem.tileSize = 512
            dem.maxzoom = 14
            try? style.addSource(dem)
        }

        // MARK: 3D terrain

        private func applyTerrain() {
            guard let map, styleReady else { return }
            let style: MapboxMap = map.mapboxMap
            if is3D {
                ensureDemSource()
                var terrain = Terrain(sourceId: demId)
                terrain.exaggeration = .constant(1)  // true scale, as on the web
                try? style.setTerrain(terrain)
            } else {
                style.removeTerrain()
            }
        }

        // MARK: Location

        /// Shows the puck (asking for permission if needed) and moves the
        /// camera to the first fix. Without permission the map stays on the routes.
        func centerOnFirstLocation() {
            guard let map else { return }
            map.location.options.puckType = .puck2D(.makeDefault(showBearing: true))
            map.location.onLocationChange.observeNext { [weak self, weak map] locations in
                guard let map, let location = locations.last else { return }
                self?.fitted = true  // the routes fit shouldn't move it afterwards
                map.camera.ease(to: CameraOptions(center: location.coordinate, zoom: 13), duration: 0.8)
            }.store(in: &cancelables)
        }

        func followUser() {
            guard let map else { return }
            // Location turned off for the app: nothing to follow, and iOS
            // won't ask again, so send them to the app's Settings page.
            switch CLLocationManager().authorizationStatus {
            case .denied, .restricted:
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
                return
            default:
                break
            }
            map.location.options.puckType = .puck2D(.makeDefault(showBearing: true))
            // Pitch is left alone so following the puck doesn't fight the 3D toggle.
            let state = map.viewport.makeFollowPuckViewportState(options: FollowPuckViewportStateOptions(
                zoom: 14, bearing: nil, pitch: nil
            ))
            map.viewport.transition(to: state)
        }

        // MARK: Photo pins

        private func placePins() {
            guard let map else { return }
            pins.forEach { $0.remove() }
            pins = photos.compactMap { photo in
                guard let coordinate = photo.coordinate else { return nil }
                let view = PhotoPinView(photo: photo) { [weak self] in self?.parent?.onSelectPhoto?(photo) }
                if let cached = thumbnails[photo.id] {
                    view.image = cached
                } else if let url = photo.imageURL {
                    Task { @MainActor [weak self, weak view] in
                        guard let (data, _) = try? await URLSession.shared.data(from: url),
                              let image = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 96, height: 96))
                        else { return }
                        self?.thumbnails[photo.id] = image
                        view?.image = image
                    }
                }
                let pin = ViewAnnotation(coordinate: coordinate, view: view)
                pin.allowOverlap = true
                map.viewAnnotations.add(pin)
                return pin
            }
        }

        // MARK: Video playhead

        func movePlayhead(to coordinate: CLLocationCoordinate2D?) {
            guard let map else { return }
            guard let coordinate else {
                playheadPin?.remove()
                playheadPin = nil
                return
            }
            if let pin = playheadPin {
                pin.annotatedFeature = .geometry(Point(coordinate))
            } else {
                let pin = ViewAnnotation(coordinate: coordinate, view: PlayheadView())
                pin.allowOverlap = true
                map.viewAnnotations.add(pin)
                playheadPin = pin
            }
        }

        // MARK: Follow-cam

        /// The selected clip's stretch, zoom-in on play, and following the pin.
        func followVideo(resumeRequest: Int) {
            guard let map, let video else { return }
            let key = video.segments.map { "\($0.count)" }.joined(separator: ",")
            if key != clipKey {
                clipKey = key
                installClipSegment()
            }
            if video.focusRequest != focusRequest {
                focusRequest = video.focusRequest
                focus(duration: 1.4)
                return
            }
            if resumeRequest != self.resumeRequest {
                self.resumeRequest = resumeRequest
                focus(duration: 1.0)
                return
            }
            guard video.isPlaying, following, !userGesture, Date() > focusAnimatingUntil,
                  let pin = playhead else { return }
            var camera = CameraOptions(center: pin, padding: followPadding)
            if is3D, autoBearing, let target = followBearing() {
                // Turn a little each tick, the short way, so switchbacks swing
                // the camera round smoothly instead of snapping it.
                let current = map.mapboxMap.cameraState.bearing
                let diff = (target - current + 540).truncatingRemainder(dividingBy: 360) - 180
                camera.bearing = current + diff * 0.35
            }
            // The pin moves every quarter second; easing across each step keeps it smooth.
            map.camera.ease(to: camera, duration: 0.25, curve: .linear)
        }

        /// Zoom in on the pin and start following it: in 3D, the calibrated
        /// angle or close behind the pin facing the way the ride goes; in 2D,
        /// zoomed in and north-up.
        private func focus(duration: TimeInterval) {
            guard let map, let video, let center = playhead ?? video.segment.first else { return }
            setFollowing(true)
            autoBearing = true
            var camera = CameraOptions(center: center, padding: followPadding)
            if is3D {
                camera.zoom = video.angle?.zoom ?? 16.5
                camera.pitch = video.angle?.pitch ?? 65
                if let bearing = followBearing() { camera.bearing = bearing }
            } else {
                camera.zoom = 16
                camera.pitch = 0
                camera.bearing = 0
            }
            map.camera.cancelAnimations()
            focusAnimatingUntil = Date().addingTimeInterval(duration)
            map.camera.ease(to: camera, duration: duration)
        }

        private func followBearing() -> Double? {
            guard let travel = video?.bearing else { return nil }
            return travel + (video?.angle?.bearingOffset ?? 0)
        }

        private var followPadding: UIEdgeInsets {
            UIEdgeInsets(top: 0, left: leadingInset, bottom: bottomInset, right: trailingInset)
        }

        private func setFollowing(_ value: Bool) {
            guard following != value else { return }
            following = value
            let report = parent?.onFollowPausedChange
            DispatchQueue.main.async { report?(!value) }
        }

        // The Big Miles logo yellow (#FAD82D), for the stretches of route with video.
        private static let clipColor = UIColor(red: 250/255, green: 216/255, blue: 45/255, alpha: 1)

        private func installClipSegment() {
            guard let map, styleReady else { return }
            let style: MapboxMap = map.mapboxMap
            let lines = (video?.segments ?? []).filter { $0.count >= 2 }
            let data: GeoJSONSourceData = .featureCollection(FeatureCollection(
                features: lines.map { Feature(geometry: .lineString(LineString($0))) }
            ))
            if style.sourceExists(withId: clipSourceId) {
                style.updateGeoJSONSource(withId: clipSourceId, data: data)
            } else {
                var source = GeoJSONSource(id: clipSourceId)
                source.data = data
                try? style.addSource(source)
            }
            if !style.layerExists(withId: clipLayerId) {
                var line = LineLayer(id: clipLayerId, source: clipSourceId)
                line.lineCap = .constant(.round)
                line.lineJoin = .constant(.round)
                line.lineColor = .constant(StyleColor(Self.clipColor))
                line.lineWidth = .constant(6)
                // Over the trip line, so the video stretches show on top of it.
                try? style.addLayer(line, layerPosition: style.layerExists(withId: layerId) ? .above(layerId) : nil)
            }
        }

        // Only the user's own gestures come through here. Panning hands the
        // camera to the user; the follow-cam waits for any gesture to finish.
        func gestureManager(_ gestureManager: GestureManager, didBegin gestureType: GestureType) {
            switch gestureType {
            case .singleTap: return
            case .pan: setFollowing(false)
            case .rotation: autoBearing = false
            default: break
            }
            userGesture = true
        }

        func gestureManager(_ gestureManager: GestureManager, didEnd gestureType: GestureType, willAnimate: Bool) {
            if !willAnimate { userGesture = false }
        }

        func gestureManager(_ gestureManager: GestureManager, didEndAnimatingFor gestureType: GestureType) {
            userGesture = false
        }

        // MARK: Route taps

        private func tapped(at point: CGPoint) {
            guard let map, let onSelect = parent?.onSelectRoutes else { return }
            let box = CGRect(x: point.x - 22, y: point.y - 22, width: 44, height: 44)
            _ = map.mapboxMap.queryRenderedFeatures(
                with: box, options: RenderedQueryOptions(layerIds: [layerId], filter: nil)
            ) { result in
                guard case .success(let hits) = result else { return }
                var ids: [String] = []
                for hit in hits {
                    if case .string(let id)? = hit.queriedFeature.feature.properties?["id"], !ids.contains(id) {
                        ids.append(id)
                    }
                }
                if !ids.isEmpty { onSelect(ids) }
            }
        }
    }
}

/// The video's spot on the route: a dot with a white ring, like the web pin.
private final class PlayheadView: UIView {
    init() {
        super.init(frame: CGRect(x: 0, y: 0, width: 18, height: 18))
        backgroundColor = UIColor(red: 220/255, green: 38/255, blue: 38/255, alpha: 1)
        layer.cornerRadius = 9
        layer.borderWidth = 3
        layer.borderColor = UIColor.white.cgColor
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.3
        layer.shadowRadius = 3
        layer.shadowOffset = CGSize(width: 0, height: 1)
        isUserInteractionEnabled = false
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }
}

/// A round photo thumbnail pinned to the map.
private final class PhotoPinView: UIImageView {
    private let onTap: () -> Void

    init(photo: Photo, onTap: @escaping () -> Void) {
        self.onTap = onTap
        super.init(frame: CGRect(x: 0, y: 0, width: 36, height: 36))
        contentMode = .scaleAspectFill
        backgroundColor = UIColor(red: 232/255, green: 226/255, blue: 214/255, alpha: 1)
        layer.cornerRadius = 18
        layer.borderWidth = 2
        layer.borderColor = UIColor.white.cgColor
        clipsToBounds = true
        isUserInteractionEnabled = true
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // Mapbox sizes a view annotation from its fitting size, which for an image
    // view is the image's: zero before the thumbnail loads (so the pin never
    // shows if it fails) and 96pt after. Keep it a 36pt circle either way.
    override var intrinsicContentSize: CGSize { CGSize(width: 36, height: 36) }

    @objc private func tapped() { onTap() }
}

#endif
