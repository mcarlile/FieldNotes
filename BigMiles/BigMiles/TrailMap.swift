import SwiftUI
import MapKit
import CoreLocation

// MARK: - Mapbox base layers

/// The web app's "Map layer" choices that Mapbox serves as raster tiles.
/// (Winter is a Mapbox Standard style, which has no raster tiles.)
enum MapLayer: String, CaseIterable, Identifiable {
    case standard = "outdoors-v12"
    case satellite = "satellite-streets-v12"

    var id: String { rawValue }
    var name: String { self == .standard ? "Default" : "Satellite" }

    static var accessToken: String {
        Bundle.main.object(forInfoDictionaryKey: "MapboxAccessToken") as? String ?? ""
    }

    fileprivate var tileTemplate: String {
        "https://api.mapbox.com/styles/v1/mapbox/\(rawValue)/tiles/512/{z}/{x}/{y}@2x?access_token=\(Self.accessToken)"
    }
}

/// The map layer dropdown, as on the web route map.
struct MapLayerMenu: View {
    @Binding var layer: MapLayer

    var body: some View {
        Menu {
            Picker("Map layer", selection: $layer) {
                ForEach(MapLayer.allCases) { Text($0.name).tag($0) }
            }
        } label: {
            Image(systemName: "square.3.layers.3d")
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.black)
                .frame(width: 36, height: 36)
                .background(.regularMaterial, in: Circle())
        }
        .accessibilityLabel("Map layer")
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

/// Mapbox tiles under MapKit, with routes and photo pins on top.
/// In heat mode routes are colored by how many trips overlap, like the web heat map.
struct TrailMap: View {
    var routes: [TrailRoute]
    var photos: [Photo] = []
    var heat = false
    var layer: MapLayer = .standard
    var onSelectRoutes: (([String]) -> Void)? = nil
    var onSelectPhoto: ((Photo) -> Void)? = nil

    @State private var is3D = false
    @State private var locateRequest = 0

    var body: some View {
        #if os(iOS)
        TrailMapView(routes: routes, photos: photos, heat: heat, layer: layer, is3D: is3D,
                     locateRequest: locateRequest,
                     onSelectRoutes: onSelectRoutes, onSelectPhoto: onSelectPhoto)
            .overlay(alignment: .bottomTrailing) {
                VStack(spacing: 8) {
                    MapControlButton(systemImage: "location", label: "Show my location") {
                        locateRequest += 1
                    }
                    MapControlButton(text: is3D ? "2D" : "3D", label: is3D ? "Flat map" : "3D map") {
                        is3D.toggle()
                    }
                }
                .padding(12)
                .padding(.bottom, 16)
            }
            .overlay(alignment: .bottomLeading) {
                Text("© Mapbox © OpenStreetMap")
                    .font(.system(size: 9))
                    .foregroundColor(.black.opacity(0.6))
                    .padding(.horizontal, 4)
                    .background(Color.white.opacity(0.6))
                    .padding(6)
                    .allowsHitTesting(false)
            }
        #else
        RouteMapView(coordinates: routes.first?.coordinates ?? [])
        #endif
    }
}

#if os(iOS)

private final class DensityPolyline: MKPolyline {
    var level = 0
}

private final class PhotoPin: NSObject, MKAnnotation {
    let photo: Photo
    let coordinate: CLLocationCoordinate2D
    init(photo: Photo, coordinate: CLLocationCoordinate2D) {
        self.photo = photo
        self.coordinate = coordinate
    }
}

private struct TrailMapView: UIViewRepresentable {
    var routes: [TrailRoute]
    var photos: [Photo]
    var heat: Bool
    var layer: MapLayer
    var is3D: Bool
    var locateRequest: Int
    var onSelectRoutes: (([String]) -> Void)?
    var onSelectPhoto: ((Photo) -> Void)?

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.showsCompass = true
        map.pointOfInterestFilter = .excludingAll
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(Coordinator.tapped(_:)))
        tap.delegate = context.coordinator
        map.addGestureRecognizer(tap)
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        let c = context.coordinator
        c.parent = self

        // Mapbox raster tiles are flat, so 3D swaps them for Apple's own map
        // with real terrain (satellite stays satellite) and tilts the camera.
        if c.layer != layer || c.is3D != is3D {
            let modeChanged = c.is3D != nil && c.is3D != is3D
            c.layer = layer
            c.is3D = is3D
            map.overlays.compactMap { $0 as? MKTileOverlay }.forEach(map.removeOverlay)
            if is3D {
                map.preferredConfiguration = layer == .satellite
                    ? MKHybridMapConfiguration(elevationStyle: .realistic)
                    : MKStandardMapConfiguration(elevationStyle: .realistic, emphasisStyle: .muted)
            } else {
                map.preferredConfiguration = MKStandardMapConfiguration()
                let tiles = MKTileOverlay(urlTemplate: layer.tileTemplate)
                tiles.tileSize = CGSize(width: 512, height: 512)
                tiles.canReplaceMapContent = true
                map.insertOverlay(tiles, at: 0, level: .aboveLabels)
            }
            if modeChanged {
                let camera = map.camera.copy() as! MKMapCamera
                camera.pitch = is3D ? 60 : 0
                map.setCamera(camera, animated: true)
            }
        }

        if c.locateRequest != locateRequest {
            c.locateRequest = locateRequest
            c.showUserLocation(on: map)
        }

        let routeKey = routes.map { "\($0.id):\($0.coordinates.count)" }.joined(separator: ",") + "|\(heat)"
        if c.routeKey != routeKey {
            c.routeKey = routeKey
            map.removeOverlays(map.overlays.filter { $0 is MKPolyline })
            c.lines = heat ? Self.densityLines(routes) : Self.plainLines(routes)
            for (_, line) in c.lines { map.addOverlay(line, level: .aboveLabels) }

            let rect = c.lines.map(\.1.boundingMapRect).reduce(MKMapRect.null) { $0.union($1) }
            if !rect.isNull {
                let pad = UIEdgeInsets(top: 40, left: 30, bottom: 40, right: 30)
                map.setVisibleMapRect(rect, edgePadding: pad, animated: false)
            }
        }

        let photoKey = photos.map(\.id).joined(separator: ",")
        if c.photoKey != photoKey {
            c.photoKey = photoKey
            map.removeAnnotations(map.annotations)
            map.addAnnotations(photos.compactMap { p in p.coordinate.map { PhotoPin(photo: p, coordinate: $0) } })
        }
    }

    // MARK: Lines

    private static func plainLines(_ routes: [TrailRoute]) -> [(String, MKPolyline)] {
        routes.filter { $0.coordinates.count >= 2 }.map { route in
            (route.id, MKPolyline(coordinates: route.coordinates, count: route.coordinates.count))
        }
    }

    /// Splits each route into runs by how many routes pass through the same
    /// ~100 m cell: 1 route, 2–3, or 4+ (the web heat map's blue/orange/red).
    private static func densityLines(_ routes: [TrailRoute]) -> [(String, MKPolyline)] {
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

        var lines: [(String, MKPolyline)] = []
        for route in routes where route.coordinates.count >= 2 {
            var run: [CLLocationCoordinate2D] = [route.coordinates[0]]
            var runLevel = level(route.coordinates[0])
            func flush() {
                guard run.count >= 2 else { return }
                let line = DensityPolyline(coordinates: run, count: run.count)
                line.level = runLevel
                lines.append((route.id, line))
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
        // Busier runs draw on top.
        return lines.sorted { ($0.1 as? DensityPolyline)?.level ?? 0 < ($1.1 as? DensityPolyline)?.level ?? 0 }
    }

    // MARK: Coordinator

    final class Coordinator: NSObject, MKMapViewDelegate, UIGestureRecognizerDelegate, CLLocationManagerDelegate {
        var parent: TrailMapView?
        var layer: MapLayer?
        var is3D: Bool?
        var locateRequest = 0
        private let locationManager = CLLocationManager()
        private weak var locatingMap: MKMapView?
        var routeKey = ""
        var photoKey = "-"
        var lines: [(String, MKPolyline)] = []
        private var thumbnails: [String: UIImage] = [:]

        private static let heatColors: [UIColor] = [
            UIColor(red: 59/255, green: 130/255, blue: 246/255, alpha: 1),  // #3b82f6
            UIColor(red: 245/255, green: 158/255, blue: 11/255, alpha: 1),  // #f59e0b
            UIColor(red: 220/255, green: 38/255, blue: 38/255, alpha: 1),   // #dc2626
        ]
        private static let ink = UIColor(red: 26/255, green: 24/255, blue: 21/255, alpha: 1)

        // MARK: Location

        func showUserLocation(on map: MKMapView) {
            switch locationManager.authorizationStatus {
            case .notDetermined:
                locatingMap = map
                locationManager.delegate = self
                locationManager.requestWhenInUseAuthorization()
            case .authorizedWhenInUse, .authorizedAlways:
                map.showsUserLocation = true
                map.setUserTrackingMode(.follow, animated: true)
            default:
                // Denied in Settings; nothing to show.
                break
            }
        }

        func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
            guard let map = locatingMap, manager.authorizationStatus != .notDetermined else { return }
            locatingMap = nil
            showUserLocation(on: map)
        }

        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            if let tiles = overlay as? MKTileOverlay {
                return MKTileOverlayRenderer(tileOverlay: tiles)
            }
            guard let line = overlay as? MKPolyline else { return MKOverlayRenderer(overlay: overlay) }
            let r = MKPolylineRenderer(polyline: line)
            r.lineCap = .round
            r.lineJoin = .round
            if let dense = line as? DensityPolyline {
                r.strokeColor = Self.heatColors[dense.level].withAlphaComponent(0.9)
                r.lineWidth = 2.5 + CGFloat(dense.level) * 0.75
            } else {
                r.strokeColor = Self.ink
                r.lineWidth = 3.5
            }
            return r
        }

        func mapView(_ mapView: MKMapView, viewFor annotation: MKAnnotation) -> MKAnnotationView? {
            guard let pin = annotation as? PhotoPin else { return nil }
            let id = "photo"
            let view = mapView.dequeueReusableAnnotationView(withIdentifier: id) ?? MKAnnotationView(annotation: pin, reuseIdentifier: id)
            view.annotation = pin
            view.frame = CGRect(x: 0, y: 0, width: 36, height: 36)
            view.layer.cornerRadius = 18
            view.layer.borderWidth = 2
            view.layer.borderColor = UIColor.white.cgColor
            view.layer.masksToBounds = true
            view.backgroundColor = UIColor(red: 232/255, green: 226/255, blue: 214/255, alpha: 1)
            view.image = nil
            let imageView: UIImageView
            if let existing = view.subviews.first as? UIImageView {
                imageView = existing
            } else {
                imageView = UIImageView(frame: view.bounds)
                imageView.contentMode = .scaleAspectFill
                view.addSubview(imageView)
            }
            imageView.image = thumbnails[pin.photo.id]
            if imageView.image == nil, let url = pin.photo.imageURL {
                let photoId = pin.photo.id
                Task { @MainActor in
                    guard let (data, _) = try? await URLSession.shared.data(from: url),
                          let image = UIImage(data: data)?.preparingThumbnail(of: CGSize(width: 96, height: 96))
                    else { return }
                    self.thumbnails[photoId] = image
                    if (view.annotation as? PhotoPin)?.photo.id == photoId { imageView.image = image }
                }
            }
            return view
        }

        func mapView(_ mapView: MKMapView, didSelect annotation: MKAnnotation) {
            if let pin = annotation as? PhotoPin { parent?.onSelectPhoto?(pin.photo) }
            mapView.deselectAnnotation(annotation, animated: false)
        }

        @objc func tapped(_ gesture: UITapGestureRecognizer) {
            guard let map = gesture.view as? MKMapView, let onSelect = parent?.onSelectRoutes else { return }
            let point = MKMapPoint(map.convert(gesture.location(in: map), toCoordinateFrom: map))
            // 22 pt of finger slop, in map points at the current zoom.
            let tolerance = 22 * map.visibleMapRect.size.width / Double(max(map.bounds.width, 1))

            var hits: [String] = []
            for (id, line) in lines where !hits.contains(id) {
                guard line.boundingMapRect.insetBy(dx: -tolerance, dy: -tolerance).contains(point) else { continue }
                let pts = line.points()
                for i in 1..<line.pointCount where Self.distance(point, pts[i - 1], pts[i]) <= tolerance {
                    hits.append(id)
                    break
                }
            }
            if !hits.isEmpty { onSelect(hits) }
        }

        private static func distance(_ p: MKMapPoint, _ a: MKMapPoint, _ b: MKMapPoint) -> Double {
            let dx = b.x - a.x, dy = b.y - a.y
            let len = dx * dx + dy * dy
            let t = len == 0 ? 0 : max(0, min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
            return hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
        }

        // Let pin taps through to MapKit instead of the route tap.
        func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
            !(touch.view is MKAnnotationView) && !(touch.view?.superview is MKAnnotationView)
        }
        func gestureRecognizer(_ g: UIGestureRecognizer,
                               shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }
    }
}

#endif
