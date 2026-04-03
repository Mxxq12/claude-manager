import SwiftUI

enum SessionStatus: String, Codable {
    case idle
    case busy
    case error
    case closed

    var color: Color {
        switch self {
        case .idle: return .green
        case .busy: return Color(hex: "#58a6ff")
        case .error: return .red
        case .closed: return .gray
        }
    }

    var displayText: String {
        switch self {
        case .idle: return "空闲"
        case .busy: return "忙碌"
        case .error: return "错误"
        case .closed: return "已关闭"
        }
    }
}

enum IdleSubStatus: String, Codable {
    case input
    case approval
}

struct Session: Identifiable, Codable {
    let id: String
    var name: String
    var cwd: String
    var status: SessionStatus
    var idleSubStatus: IdleSubStatus?
    var statusTimestamp: Double?
    var autoApprove: Bool?

    var isApproval: Bool {
        status == .idle && idleSubStatus == .approval
    }

    var statusColor: Color {
        if isApproval {
            return .orange
        }
        return status.color
    }

    var displayStatus: String {
        if isApproval {
            return "待审批"
        }
        return status.displayText
    }

    var statusTimeAgo: String? {
        guard let ts = statusTimestamp else { return nil }
        let date = Date(timeIntervalSince1970: ts / 1000)
        let interval = Date().timeIntervalSince(date)
        if interval < 60 { return "刚刚" }
        if interval < 3600 { return "\(Int(interval / 60))分钟前" }
        if interval < 86400 { return "\(Int(interval / 3600))小时前" }
        return "\(Int(interval / 86400))天前"
    }
}

struct Project: Codable, Identifiable {
    var id: String { path }
    let path: String
    let name: String
    let mtime: Double?
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b: UInt64
        (r, g, b) = ((int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: 1
        )
    }

    static let bgPrimary = Color(hex: "#0d1117")
    static let bgCard = Color(hex: "#161b22")
    static let cmAccent = Color(hex: "#58a6ff")
    static let border = Color(hex: "#30363d")
    static let textSecondary = Color(hex: "#8b949e")
}
