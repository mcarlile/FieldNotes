import SwiftUI

struct LoginView: View {
    @EnvironmentObject var auth: AuthManager
    @State private var isLoading = false

    // Design tokens matching the existing app palette
    private let ink  = Color(red: 26/255,  green: 24/255,  blue: 21/255)   // #1a1815
    private let sand = Color(red: 245/255, green: 240/255, blue: 232/255)  // #F5F0E8
    private let muted = Color(red: 107/255, green: 101/255, blue: 96/255)  // #6B6560

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer()

            VStack(alignment: .leading, spacing: 8) {
                Text("Big Miles")
                    .font(.system(size: 48, weight: .bold, design: .serif))
                    .kerning(-1.5)
                    .foregroundColor(ink)

                Text("Your outdoor field journal")
                    .font(.system(size: 16))
                    .foregroundColor(muted)
            }

            Spacer()

            VStack(alignment: .leading, spacing: 16) {
                Button {
                    Task {
                        isLoading = true
                        await auth.login()
                        isLoading = false
                    }
                } label: {
                    HStack(spacing: 10) {
                        if isLoading { ProgressView().tint(sand) }
                        Text(isLoading ? "Signing in…" : "Sign in →")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(sand)
                    }
                    .padding(.horizontal, 28)
                    .padding(.vertical, 14)
                    .background(ink)
                    .cornerRadius(8)
                }
                .disabled(isLoading)

                Text("Uses your existing Big Miles account.\nA browser will open briefly.")
                    .font(.system(size: 13))
                    .foregroundColor(muted)
                    .lineSpacing(4)
            }
        }
        .padding(.horizontal, 32)
        .padding(.vertical, 60)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(sand.ignoresSafeArea())
    }
}

#Preview {
    LoginView().environmentObject(AuthManager.shared)
}
