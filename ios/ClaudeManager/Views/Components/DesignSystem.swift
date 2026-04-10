import SwiftUI
import UIKit

// MARK: - Design Tokens

extension Color {
    // Backgrounds
    static let dsBackground = Color(hex: "#0A0E1A")
    static let dsCard = Color(hex: "#161B2E")
    static let dsCardHover = Color(hex: "#1F2538")
    static let dsCardHighlight = Color(hex: "#2A3148")
    static let dsBorder = Color(hex: "#232938")

    // Text
    static let dsTextPrimary = Color(hex: "#F0F4FF")
    static let dsTextSecondary = Color(hex: "#8B95B5")
    static let dsTextTertiary = Color(hex: "#5A6580")

    // Accents
    static let dsAccentBlue = Color(hex: "#5E9DFF")
    static let dsAccentPurple = Color(hex: "#A78BFA")

    // Status
    static let dsIdle = Color(hex: "#30D158")
    static let dsBusy = Color(hex: "#5E9DFF")
    static let dsApproval = Color(hex: "#FFD60A")
    static let dsError = Color(hex: "#FF453A")
    static let dsClosed = Color(hex: "#5A6580")

    // Aliases for status semantics
    static let dsSuccess = Color(hex: "#30D158")
    static let dsWarning = Color(hex: "#FFD60A")
    static let dsDanger = Color(hex: "#FF453A")
}

extension LinearGradient {
    static let dsAccentGradient = LinearGradient(
        colors: [Color(hex: "#5E9DFF"), Color(hex: "#A78BFA")],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let dsAccentGradientSoft = LinearGradient(
        colors: [Color(hex: "#5E9DFF").opacity(0.8), Color(hex: "#A78BFA").opacity(0.8)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )
}

extension RadialGradient {
    static let dsBackgroundRadial = RadialGradient(
        colors: [
            Color(hex: "#1A2545").opacity(0.6),
            Color(hex: "#0A0E1A")
        ],
        center: .center,
        startRadius: 0,
        endRadius: 500
    )
}

// MARK: - Status helpers (avoid touching Models)

extension Session {
    var dsStatusColor: Color {
        if isApproval { return .dsApproval }
        switch status {
        case .idle: return .dsIdle
        case .busy: return .dsBusy
        case .error: return .dsError
        case .closed: return .dsClosed
        }
    }

    var dsStatusIcon: String {
        if isApproval { return "exclamationmark.triangle.fill" }
        switch status {
        case .idle: return "checkmark.circle.fill"
        case .busy: return "circle.dotted"
        case .error: return "xmark.octagon.fill"
        case .closed: return "moon.zzz.fill"
        }
    }
}

// MARK: - Haptics

enum Haptics {
    static func light() {
        let g = UIImpactFeedbackGenerator(style: .light)
        g.impactOccurred()
    }
    static func medium() {
        let g = UIImpactFeedbackGenerator(style: .medium)
        g.impactOccurred()
    }
    static func soft() {
        let g = UIImpactFeedbackGenerator(style: .soft)
        g.impactOccurred()
    }
    static func success() {
        let g = UINotificationFeedbackGenerator()
        g.notificationOccurred(.success)
    }
}

// MARK: - Animations

enum DSAnim {
    static let spring = Animation.spring(response: 0.4, dampingFraction: 0.7)
    static let quickSpring = Animation.spring(response: 0.28, dampingFraction: 0.75)
    static let breath = Animation.easeInOut(duration: 1.6).repeatForever(autoreverses: true)
}

// MARK: - Button Styles

struct DSPressableStyle: ButtonStyle {
    var scale: CGFloat = 0.97
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1.0)
            .animation(DSAnim.quickSpring, value: configuration.isPressed)
    }
}

struct DSPrimaryButtonStyle: ButtonStyle {
    var disabled: Bool = false
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundColor(.white)
            .frame(maxWidth: .infinity)
            .frame(height: 52)
            .background(
                Group {
                    if disabled {
                        Color.dsCardHighlight
                    } else {
                        LinearGradient.dsAccentGradient
                    }
                }
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
            )
            .shadow(color: disabled ? .clear : Color.dsAccentBlue.opacity(0.25), radius: 16, x: 0, y: 8)
            .scaleEffect(configuration.isPressed ? 0.98 : 1.0)
            .animation(DSAnim.quickSpring, value: configuration.isPressed)
    }
}

// MARK: - View Modifiers

struct DSCardBackground: ViewModifier {
    var cornerRadius: CGFloat = 16
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(Color.dsCard)
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.dsBorder, lineWidth: 1)
            )
    }
}

extension View {
    func dsCard(cornerRadius: CGFloat = 16) -> some View {
        modifier(DSCardBackground(cornerRadius: cornerRadius))
    }
}

// MARK: - Status Pill

struct DSStatusPill: View {
    let connected: Bool

    var body: some View {
        HStack(spacing: 6) {
            Circle()
                .fill(connected ? Color.dsIdle : Color.dsError)
                .frame(width: 7, height: 7)

            Text(connected ? "已连接" : "断开")
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(.dsTextPrimary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            Capsule().fill(.ultraThinMaterial)
        )
        .overlay(
            Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }
}
