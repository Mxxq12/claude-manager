import Foundation

protocol WebSocketServiceDelegate: AnyObject {
    func webSocketDidConnect()
    func webSocketDidDisconnect()
    func webSocketDidReceiveSessionSync(sessions: [[String: Any]])
    func webSocketDidReceiveSessionStatus(sessionId: String, status: String, subStatus: String?)
    func webSocketDidReceiveSessionCreated(session: [String: Any])
    func webSocketDidReceiveAutoApproveChanged(sessionId: String, enabled: Bool)
}

final class WebSocketService: NSObject {
    weak var delegate: WebSocketServiceDelegate?

    private var webSocketTask: URLSessionWebSocketTask?
    private var urlSession: URLSession?
    private var server: String = ""
    private var token: String = ""
    private var isConnected = false
    private var isIntentionalDisconnect = false
    private var reconnectAttempts = 0
    private let maxReconnectDelay: TimeInterval = 30
    private var heartbeatTimer: Timer?

    // Output listeners: sessionId -> array of callbacks
    private var outputListeners: [String: [(Data) -> Void]] = [:]
    private let listenerQueue = DispatchQueue(label: "ws.listener.queue")

    func connect(server: String, token: String) {
        self.server = server
        self.token = token
        self.isIntentionalDisconnect = false
        self.reconnectAttempts = 0
        establishConnection()
    }

    func disconnect() {
        isIntentionalDisconnect = true
        stopHeartbeat()
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        isConnected = false
        delegate?.webSocketDidDisconnect()
    }

    private func establishConnection() {
        let wsScheme = server.hasPrefix("https") ? "wss" : "ws"
        let host = server
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        let urlString = "\(wsScheme)://\(host)/ws?token=\(token)"

        guard let url = URL(string: urlString) else { return }

        let config = URLSessionConfiguration.default
        urlSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        webSocketTask = urlSession?.webSocketTask(with: url)
        webSocketTask?.maximumMessageSize = 16 * 1024 * 1024  // 16MB
        webSocketTask?.resume()
        receiveMessage()
    }

    private func receiveMessage() {
        webSocketTask?.receive { [weak self] result in
            guard let self = self else { return }

            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    if let data = text.data(using: .utf8) {
                        self.handleMessage(data: data)
                    }
                case .data(let data):
                    self.handleMessage(data: data)
                @unknown default:
                    break
                }
                self.receiveMessage()

            case .failure:
                if !self.isIntentionalDisconnect {
                    self.handleDisconnect()
                }
            }
        }
    }

    private func handleMessage(data: Data) {
        guard let msg = WSMessage(data: data) else {
            print("[WS] Failed to parse message")
            return
        }
        print("[WS] Received: \(msg.type)")

        switch msg.type {
        case "session.sync":
            if let sessions = msg.payloadArray {
                delegate?.webSocketDidReceiveSessionSync(sessions: sessions)
            }

        case "session.output":
            if let sessionId = msg.payload["sessionId"] as? String,
               let base64Str = msg.payload["data"] as? String,
               let outputData = Data(base64Encoded: base64Str) {
                listenerQueue.sync {
                    outputListeners[sessionId]?.forEach { $0(outputData) }
                }
            }

        case "session.status":
            if let sessionId = msg.payload["sessionId"] as? String,
               let status = msg.payload["status"] as? String {
                let subStatus = msg.payload["idleSubStatus"] as? String
                delegate?.webSocketDidReceiveSessionStatus(sessionId: sessionId, status: status, subStatus: subStatus)
            }

        case "session.created":
            delegate?.webSocketDidReceiveSessionCreated(session: msg.payload)

        case "session.buffer":
            if let sessionId = msg.payload["sessionId"] as? String,
               let chunks = msg.payload["data"] as? [String] {
                for base64Str in chunks {
                    if let outputData = Data(base64Encoded: base64Str) {
                        listenerQueue.sync {
                            outputListeners[sessionId]?.forEach { $0(outputData) }
                        }
                    }
                }
            }

        case "session.autoApprove":
            if let sessionId = msg.payload["sessionId"] as? String,
               let enabled = msg.payload["enabled"] as? Bool {
                delegate?.webSocketDidReceiveAutoApproveChanged(sessionId: sessionId, enabled: enabled)
            }

        case "pong":
            break

        default:
            break
        }
    }

    private func handleDisconnect() {
        isConnected = false
        stopHeartbeat()
        delegate?.webSocketDidDisconnect()

        guard !isIntentionalDisconnect else { return }

        let delay = min(pow(2.0, Double(reconnectAttempts)), maxReconnectDelay)
        reconnectAttempts += 1

        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            guard let self = self, !self.isIntentionalDisconnect else { return }
            self.establishConnection()
        }
    }

    private func startHeartbeat() {
        stopHeartbeat()
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            self?.sendPing()
        }
    }

    private func stopHeartbeat() {
        heartbeatTimer?.invalidate()
        heartbeatTimer = nil
    }

    private func sendPing() {
        send(type: "ping")
    }

    // MARK: - Output Listeners

    func addOutputListener(sessionId: String, listener: @escaping (Data) -> Void) {
        listenerQueue.sync {
            if outputListeners[sessionId] == nil {
                outputListeners[sessionId] = []
            }
            outputListeners[sessionId]?.append(listener)
        }
    }

    func removeOutputListeners(sessionId: String) {
        _ = listenerQueue.sync {
            outputListeners.removeValue(forKey: sessionId)
        }
    }

    // MARK: - Send Commands

    func send(type: String, payload: [String: Any] = [:]) {
        guard let data = WSMessage.encode(type: type, payload: payload) else { return }
        let message = URLSessionWebSocketTask.Message.string(String(data: data, encoding: .utf8) ?? "")
        webSocketTask?.send(message) { _ in }
    }

    func sendInput(sessionId: String, text: String) {
        send(type: "session.input", payload: ["sessionId": sessionId, "text": text])
    }

    func sendRawInput(sessionId: String, data: String) {
        send(type: "session.rawInput", payload: ["sessionId": sessionId, "data": data])
    }

    func sendApprove(sessionId: String) {
        send(type: "session.approve", payload: ["sessionId": sessionId])
    }

    func sendKill(sessionId: String) {
        send(type: "session.kill", payload: ["sessionId": sessionId])
    }

    func sendResize(sessionId: String, cols: Int, rows: Int) {
        send(type: "session.resize", payload: ["sessionId": sessionId, "cols": cols, "rows": rows])
    }

    func requestBuffer(sessionId: String) {
        send(type: "session.buffer", payload: ["sessionId": sessionId])
    }

    func setAutoApprove(sessionId: String, enabled: Bool) {
        send(type: "session.autoApprove", payload: ["sessionId": sessionId, "enabled": enabled])
    }
}

// MARK: - URLSessionWebSocketDelegate

extension WebSocketService: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        isConnected = true
        reconnectAttempts = 0
        startHeartbeat()
        delegate?.webSocketDidConnect()
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        if !isIntentionalDisconnect {
            handleDisconnect()
        }
    }
}
