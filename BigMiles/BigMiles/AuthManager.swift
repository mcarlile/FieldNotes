import Foundation
import Combine
import AuthenticationServices
import Security
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif

@MainActor
class AuthManager: ObservableObject {
    static let shared = AuthManager()
    nonisolated private static let tokenKey = "com.bigmiles.authToken"

    @Published var isAuthenticated = false
    @Published var currentUser: User?

    private init() {
        isAuthenticated = storedToken != nil
    }

    // nonisolated so Network.swift can read it without hopping to main actor
    nonisolated var storedToken: String? {
        Keychain.read(AuthManager.tokenKey)
    }

    func login() async {
        guard let url = URL(string: "https://bigmiles.app/api/login?redirectTo=mobile") else { return }

        guard let token = await WebAuth.start(url)?.queryValue("token") else { return }
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

// MARK: - Browser sheet for sign-in and connecting services

enum WebAuth {
    private static var session: ASWebAuthenticationSession?

    /// Opens `url` in the system browser sheet and returns the bigmiles:// URL
    /// the server finally redirects to, or nil if the user closed the sheet.
    static func start(_ url: URL) async -> URL? {
        let result: URL? = await withCheckedContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: "bigmiles") { callbackURL, _ in
                continuation.resume(returning: callbackURL)
            }
            session.presentationContextProvider = WindowProvider.shared
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            session.start()
        }
        session = nil
        return result
    }
}

extension URL {
    func queryValue(_ name: String) -> String? {
        URLComponents(url: self, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == name }?.value
    }
}

// MARK: - Window provider for OAuth sheet presentation

final class WindowProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = WindowProvider()
    private override init() {}

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        #if canImport(UIKit)
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let key = scenes.flatMap(\.windows).first(where: \.isKeyWindow) {
            return key
        }
        // The sign-in button lives in a window, so a scene always exists here.
        guard let scene = scenes.first else { fatalError("Sign-in started without a window scene") }
        return UIWindow(windowScene: scene)
        #elseif canImport(AppKit)
        return NSApplication.shared.keyWindow ?? NSApplication.shared.windows.first ?? NSWindow()
        #else
        return ASPresentationAnchor()
        #endif
    }
}

// MARK: - Keychain helpers

enum Keychain {
    nonisolated static func read(_ key: String) -> String? {
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

    nonisolated static func save(_ key: String, value: String) {
        delete(key)
        let attrs: [CFString: Any] = [
            kSecClass:       kSecClassGenericPassword,
            kSecAttrAccount: key,
            kSecValueData:   Data(value.utf8),
        ]
        SecItemAdd(attrs as CFDictionary, nil)
    }

    nonisolated static func delete(_ key: String) {
        let q: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrAccount: key]
        SecItemDelete(q as CFDictionary)
    }
}
