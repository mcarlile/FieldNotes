import Foundation

enum APIError: LocalizedError {
    case unauthorized
    case httpError(Int)
    case badURL

    var errorDescription: String? {
        switch self {
        case .unauthorized:       return "Session expired – please sign in again."
        case .httpError(let c):   return "Server error \(c)."
        case .badURL:             return "Invalid URL."
        }
    }
}

enum API {
    static let base = "https://bigmiles.app"

    static func get<T: Decodable>(_ path: String) async throws -> T {
        try await request(path: path, method: "GET", body: nil)
    }

    static func post<T: Decodable>(_ path: String, body: [String: Any]) async throws -> T {
        let data = try JSONSerialization.data(withJSONObject: body)
        return try await request(path: path, method: "POST", body: data)
    }

    static func delete(_ path: String) async throws {
        let _: VoidResponse = try await request(path: path, method: "DELETE", body: nil)
    }

    private static func request<T: Decodable>(path: String, method: String, body: Data?) async throws -> T {
        guard let url = URL(string: base + path) else { throw APIError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = AuthManager.shared.storedToken {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        req.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: req)

        if let http = response as? HTTPURLResponse {
            if http.statusCode == 401 {
                await AuthManager.shared.logout()
                throw APIError.unauthorized
            }
            if http.statusCode >= 400 {
                throw APIError.httpError(http.statusCode)
            }
        }

        if T.self == VoidResponse.self { return VoidResponse() as! T }
        return try JSONDecoder().decode(T.self, from: data)
    }
}

private struct VoidResponse: Decodable {}
