import SwiftUI
import UserNotifications
#if os(iOS)
import UIKit
#endif

@main
struct BigMilesApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @StateObject private var auth = AuthManager.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        HealthSync.shared.resume()
        VideoUploadManager.shared.resume()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(auth)
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await HealthSync.shared.sync() }
                // Picks up clips that couldn't be added while the phone was locked.
                VideoUploadManager.shared.resume()
            }
        }
    }
}

#if os(iOS)
/// Hands background upload events to VideoUploadManager, and shows the
/// "videos uploaded" notification even when the app is open.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        guard identifier == VideoUploadManager.sessionIdentifier else {
            completionHandler()
            return
        }
        VideoUploadManager.shared.backgroundCompletion = completionHandler
        VideoUploadManager.shared.resume()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter,
                                            willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }
}
#endif
