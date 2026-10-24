import SwiftUI
import MapKit

struct RouteMapView: View {
    let coordinates: [CLLocationCoordinate2D]

    var body: some View {
        Map(initialPosition: position, interactionModes: []) {
            if coordinates.count >= 2 {
                MapPolyline(coordinates: coordinates)
                    .stroke(.primary, lineWidth: 3)
            }
        }
    }

    private var position: MapCameraPosition {
        guard coordinates.count >= 2 else { return .automatic }
        let polyline = MKPolyline(coordinates: coordinates, count: coordinates.count)
        let rect = polyline.boundingMapRect
        let padX = max(rect.size.width * 0.15, 1)
        let padY = max(rect.size.height * 0.15, 1)
        let padded = MKMapRect(
            x: rect.origin.x - padX,
            y: rect.origin.y - padY,
            width: rect.size.width + padX * 2,
            height: rect.size.height + padY * 2
        )
        return .rect(padded)
    }
}
