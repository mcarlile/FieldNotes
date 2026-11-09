import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case stravaNotConnected
    case httpError(Int, message: String?, body: Data)
    case badURL

    var errorDescription: String? {
        switch self {
        case .unauthorized:       return "Session expired – please sign in again."
        case .stravaNotConnected: return "Strava isn't connected. Connect it from the Inbox at bigmiles.app."
        case .httpError(let c, let msg, let body):
            if let msg { return msg }
            // No JSON message means something in front of the app answered
            // (a proxy or load balancer): show what it said.
            let text = String(decoding: body.prefix(200), as: UTF8.self)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            return text.isEmpty ? "Server error \(c)." : "Server error \(c): \(text)"
        case .badURL:             return "Invalid URL."
        }
    }
}

enum API {
    static let base = "https://bigmiles.app"

    static func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "GET", body: nil)
    }

    static func post<T: Decodable>(_ path: String, body: [String: Any] = [:]) async throws -> T {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await request(path: path, method: "POST", body: data)
    }

    static func put<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await request(path: path, method: "PUT", body: data)
    }

    static func delete(_ path: String) async throws {
        let _: VoidResponse = try await request(path: path, method: "DELETE", body: nil)
    }

    private static func request<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        // Only label a body that is there: DELETE and GET send none.
        if body != nil { req.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token = AuthManager.shared.storedToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)

        if let http = response as? HTTPURLResponse {
            // Strava endpoints answer 401 when Strava (not BigMiles) isn't linked,
            // so that must not sign the user out.
            if http.statusCode == 401 && path.hasPrefix("/api/strava") {
                throw APIError.stravaNotConnected
            }
            if http.statusCode == 401 {
                AuthManager.shared.logout()
                throw APIError.unauthorized
            }
            if http.statusCode >= 400 {
                let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw APIError.httpError(http.statusCode, message: json?["message"] as? String, body: data)
            }
        }

        if T.self == VoidResponse.self { return VoidResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct VoidResponse: Decodable {}
