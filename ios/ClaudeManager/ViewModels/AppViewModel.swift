import Foundation
import SwiftUI

@MainActor
final class AppViewModel: ObservableObject {
    @Published var isLoggedIn = false
    @Published var sessions: [String: Session] = [:]
    @Published var wsConnected = false
    @Published var autoApproveSessions: Set<String> = []
    @Published var serverAddress: String = ""

    let authService = AuthService()
    let apiService = APIService()
    let webSocketService = WebSocketService()
    private var delegateAdapter: WebSocketDelegateAdapter?

    var sortedSessions: [Session] {
        sessions.values.sorted { a, b in
            let aTs = a.statusTimestamp ?? 0
            let bTs = b.statusTimestamp ?? 0
            return aTs > bTs
        }
    }

    init() {
        let adapter = WebSocketDelegateAdapter(viewModel: self)
        self.delegateAdapter = adapter
        webSocketService.delegate = adapter
        restoreSession()
    }

    private func restoreSession() {
        let creds = authService.loadCredentials()
        if let server = creds.server, let token = creds.token {
            serverAddress = server
            apiService.baseURL = server
            apiService.token = token
            isLoggedIn = true
            connectWebSocket()
            Task { await refreshSessions() }
        }
    }

    func login(server: String, password: String, remember: Bool) async throws {
        let normalizedServer = server.hasSuffix("/") ? String(server.dropLast()) : server
        let token = try await authService.login(server: normalizedServer, password: password)
        authService.saveCredentials(server: normalizedServer, token: token, password: password, remember: remember)

        serverAddress = normalizedServer
        apiService.baseURL = normalizedServer
        apiService.token = token
        isLoggedIn = true
        connectWebSocket()
        await refreshSessions()
    }

    func logout() {
        webSocketService.disconnect()
        authService.clearCredentials()
        sessions.removeAll()
        autoApproveSessions.removeAll()
        wsConnected = false
        isLoggedIn = false
    }

    func connectWebSocket() {
        webSocketService.connect(server: serverAddress, token: apiService.token)
    }

    func reconnect(server: String) {
        webSocketService.disconnect()
        serverAddress = server
        let scheme = server.hasPrefix("https") ? "https" : "http"
        let host = server.replacingOccurrences(of: "https://", with: "").replacingOccurrences(of: "http://", with: "")
        apiService.baseURL = "\(scheme)://\(host)"
        UserDefaults.standard.set(server, forKey: "cm_server_address")
        webSocketService.connect(server: host, token: apiService.token)
    }

    func refreshSessions() async {
        do {
            let fetched = try await apiService.fetchSessions()
            var map: [String: Session] = [:]
            for s in fetched {
                map[s.id] = s
                if s.autoApprove == true {
                    autoApproveSessions.insert(s.id)
                }
            }
            sessions = map
        } catch {
            print("Failed to fetch sessions: \(error)")
        }
    }

    func createSession(cwd: String) async throws -> String {
        let id = try await apiService.createSession(cwd: cwd, resume: true)
        await refreshSessions()
        return id
    }

    func deleteSession(id: String) async throws {
        try await apiService.deleteSession(id: id)
        sessions.removeValue(forKey: id)
    }

    func toggleAutoApprove(sessionId: String) {
        let current = autoApproveSessions.contains(sessionId)
        let newValue = !current
        if newValue {
            autoApproveSessions.insert(sessionId)
        } else {
            autoApproveSessions.remove(sessionId)
        }
        webSocketService.setAutoApprove(sessionId: sessionId, enabled: newValue)
    }
}

// MARK: - WebSocket Delegate Adapter

final class WebSocketDelegateAdapter: WebSocketServiceDelegate {
    private weak var viewModel: AppViewModel?

    init(viewModel: AppViewModel) {
        self.viewModel = viewModel
    }

    func webSocketDidConnect() {
        Task { @MainActor in
            viewModel?.wsConnected = true
        }
    }

    func webSocketDidDisconnect() {
        Task { @MainActor in
            viewModel?.wsConnected = false
        }
    }

    func webSocketDidReceiveSessionSync(sessions: [[String: Any]]) {
        Task { @MainActor in
            guard let vm = viewModel else { return }
            var map: [String: Session] = [:]
            for dict in sessions {
                if let session = Self.parseSession(dict) {
                    map[session.id] = session
                    if session.autoApprove == true {
                        vm.autoApproveSessions.insert(session.id)
                    }
                }
            }
            vm.sessions = map
        }
    }

    func webSocketDidReceiveSessionStatus(sessionId: String, status: String, subStatus: String?) {
        Task { @MainActor in
            guard let vm = viewModel else { return }
            if var session = vm.sessions[sessionId] {
                session.status = SessionStatus(rawValue: status) ?? .idle
                session.idleSubStatus = subStatus.flatMap { IdleSubStatus(rawValue: $0) }
                session.statusTimestamp = Date().timeIntervalSince1970 * 1000
                vm.sessions[sessionId] = session
            }
        }
    }

    func webSocketDidReceiveSessionCreated(session: [String: Any]) {
        Task { @MainActor in
            guard let vm = viewModel else { return }
            if let parsed = Self.parseSession(session) {
                vm.sessions[parsed.id] = parsed
            }
        }
    }

    func webSocketDidReceiveAutoApproveChanged(sessionId: String, enabled: Bool) {
        Task { @MainActor in
            guard let vm = viewModel else { return }
            if enabled {
                vm.autoApproveSessions.insert(sessionId)
            } else {
                vm.autoApproveSessions.remove(sessionId)
            }
            if var session = vm.sessions[sessionId] {
                session.autoApprove = enabled
                vm.sessions[sessionId] = session
            }
        }
    }

    static func parseSession(_ dict: [String: Any]) -> Session? {
        guard let id = dict["id"] as? String,
              let name = dict["name"] as? String,
              let cwd = dict["cwd"] as? String,
              let statusStr = dict["status"] as? String else { return nil }

        let status = SessionStatus(rawValue: statusStr) ?? .idle
        let subStatusStr = dict["idleSubStatus"] as? String
        let subStatus = subStatusStr.flatMap { IdleSubStatus(rawValue: $0) }
        let ts = dict["statusTimestamp"] as? Double
        let autoApprove = dict["autoApprove"] as? Bool

        return Session(
            id: id,
            name: name,
            cwd: cwd,
            status: status,
            idleSubStatus: subStatus,
            statusTimestamp: ts,
            autoApprove: autoApprove
        )
    }
}
