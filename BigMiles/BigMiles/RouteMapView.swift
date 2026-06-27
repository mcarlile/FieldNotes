import SwiftUI
import MapKit

struct RouteMapView: UIViewRepresentable {
    let coordinates: [CLLocationCoordinate2D]

    func makeUIView(context: Context) -> MKMapView {
        let map = MKMapView()
        map.delegate = context.coordinator
        map.isScrollEnabled = false
        map.isZoomEnabled = false
        map.isRotateEnabled = false
        map.isPitchEnabled = false
        return map
    }

    func updateUIView(_ map: MKMapView, context: Context) {
        map.removeOverlays(map.overlays)
        guard !coordinates.isEmpty else { return }

        let polyline = MKPolyline(coordinates: coordinates, count: coordinates.count)
        map.addOverlay(polyline)

        let padding = UIEdgeInsets(top: 40, left: 40, bottom: 40, right: 40)
        map.setVisibleMapRect(polyline.boundingMapRect, edgePadding: padding, animated: false)
    }

    func makeCoordinator() -> Coordinator { Coordinator() }

    class Coordinator: NSObject, MKMapViewDelegate {
        func mapView(_ mapView: MKMapView, rendererFor overlay: MKOverlay) -> MKOverlayRenderer {
            guard let polyline = overlay as? MKPolyline else { return MKOverlayRenderer() }
            let r = MKPolylineRenderer(polyline: polyline)
            r.strokeColor = UIColor.label
            r.lineWidth = 3
            return r
        }
    }
}
