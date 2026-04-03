import SwiftUI

@main
struct ClaudeManagerApp: App {
    @StateObject private var viewModel = AppViewModel()

    var body: some Scene {
        WindowGroup {
            Group {
                if viewModel.isLoggedIn {
                    NavigationStack {
                        SessionListView()
                    }
                } else {
                    LoginView()
                }
            }
            .environmentObject(viewModel)
            .preferredColorScheme(.dark)
        }
    }
}
