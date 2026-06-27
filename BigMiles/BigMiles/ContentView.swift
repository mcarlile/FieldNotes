import SwiftUI

struct ContentView: View {
    @EnvironmentObject var auth: AuthManager

    var body: some View {
        if auth.isAuthenticated {
            NotesListView()
        } else {
            LoginView()
        }
    }
}

#Preview {
    ContentView().environmentObject(AuthManager.shared)
}
