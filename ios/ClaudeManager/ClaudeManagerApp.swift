import SwiftUI

@main
struct ClaudeManagerApp: App {
    @StateObject private var viewModel = AppViewModel()
    @Environment(\.scenePhase) private var scenePhase

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
            .onChange(of: scenePhase) { newPhase in
                if newPhase == .active && viewModel.isLoggedIn {
                    // Reconnect WebSocket and refresh sessions when app becomes active
                    if !viewModel.wsConnected {
                        viewModel.connectWebSocket()
                    }
                    Task {
                        await viewModel.refreshSessions()
                    }
                }
            }
        }
    }
}
