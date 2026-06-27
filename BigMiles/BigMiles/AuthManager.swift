import Foundation
import AuthenticationServices
import Security
import UIKit

@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()
    private static let tokenKey = "com.bigmiles.authToken"

    @Published var isAuthenticated = false
    @Published var currentUser: User?

    private var _session: ASWebAuthenticationSession?

    private init() {
        isAuthenticated = storedToken != nil
    }

    // nonisolated so Network.swift can read it without hopping to main actor
    nonisolated var storedToken: String? {
        Keychain.read(AuthManager.tokenKey)
    }

    func login() async {
        guard let url = URL(string: "https://bigmiles.app/api/login?redirectTo=mobile") else { return }

        let token: String? = await withCheckedContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "bigmiles") { callbackURL, _ in
                let components = callbackURL.flatMap { URLComponents(url: $0, resolvingAgainstBaseURL: false) }
                continuation.resume(returning: components?.queryItems?.first(where: { $0.name == "token" })?.value)
            }
            session.presentationContextProvider = WindowProvider.shared
            session.prefersEphemeralWebBrowserSession = false
            _session = session
            session.start()
        }
        _session = nil

        guard let token else { return }
        Keychain.save(AuthManager.tokenKey, value: token)
        do {
            currentUser = try await API.get("/api/me")
            isAuthenticated = true
        } catch {
            Keychain.delete(AuthManager.tokenKey)
        }
    }

    func logout() {
        Keychain.delete(AuthManager.tokenKey)
        currentUser = nil
        isAuthenticated = false
    }
}

// MARK: - Window provider for OAuth sheet presentation

final class WindowProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WindowProvider()
    private override init() {}

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow } ?? UIWindow()
    }
}

// MARK: - Keychain helpers

enum Keychain {
    static func read(_ key: String) -> String? {
        let q: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecReturnData:  true,
            kSecMatchLimit:  kSecMatchLimitOne,
        ]
        var item: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ key: String, value: String) {
        delete(key)
        let attrs: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecValueData:   Data(value.utf8),
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    static func delete(_ key: String) {
        let q: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrAccount: key]
        SecItemDelete(q as CFDictionary)
    }
}
