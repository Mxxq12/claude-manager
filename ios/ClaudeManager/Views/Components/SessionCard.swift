import SwiftUI

struct SessionCard: View {
    let session: Session
    let isAutoApprove: Bool

    @State private var glowPulse = false

    var body: some View {
        HStack(spacing: 0) {
            // Status color bar
            Rectangle()
                .fill(session.dsStatusColor)
                .frame(width: 4)

            HStack(spacing: 12) {
                // Content
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(session.name)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundColor(.dsTextPrimary)
                            .lineLimit(1)

                        if isAutoApprove {
                            badge(text: "自动", color: .dsAccentBlue)
                        }

                        if session.isApproval {
                            badge(text: "审批", color: .dsApproval)
                        }
                    }

                    Text(session.cwd)
                        .font(.system(size: 12, weight: .regular, design: .monospaced))
                        .foregroundColor(.dsTextSecondary)
                        .lineLimit(1)
                        .truncationMode(.head)

                    HStack(spacing: 6) {
                        Text(session.displayStatus)
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(session.dsStatusColor)

                        if let timeAgo = session.statusTimeAgo {
                            Circle()
                                .fill(Color.dsTextTertiary)
                                .frame(width: 2, height: 2)
                            Text(timeAgo)
                                .font(.system(size: 11))
                                .foregroundColor(.dsTextTertiary)
                        }
                    }
                }

                Spacer(minLength: 6)

                // Status icon on right
                statusIcon
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
        }
        .frame(height: 76)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.dsCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(session.isApproval ? Color.dsApproval.opacity(glowPulse ? 0.7 : 0.25) : Color.dsBorder,
                        lineWidth: session.isApproval ? 1.5 : 1)
        )
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .shadow(color: session.isApproval ? Color.dsApproval.opacity(glowPulse ? 0.35 : 0.1) : .clear,
                radius: 12, x: 0, y: 0)
        .onAppear {
            if session.isApproval {
                withAnimation(DSAnim.breath) { glowPulse = true }
            }
        }
        .onChange(of: session.isApproval) { isApproval in
            if isApproval {
                withAnimation(DSAnim.breath) { glowPulse = true }
            } else {
                glowPulse = false
            }
        }
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch session.status {
        case .busy:
            ProgressView()
                .progressViewStyle(CircularProgressViewStyle(tint: .dsBusy))
                .scaleEffect(0.85)
                .frame(width: 24, height: 24)
        default:
            Image(systemName: session.dsStatusIcon)
                .font(.system(size: 18, weight: .medium))
                .foregroundColor(session.dsStatusColor)
                .frame(width: 24, height: 24)
        }
    }

    private func badge(text: String, color: Color) -> some View {
        Text(text)
            .font(.system(size: 9, weight: .semibold))
            .foregroundColor(color)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(color.opacity(0.15))
            )
            .overlay(
                Capsule().stroke(color.opacity(0.3), lineWidth: 0.5)
            )
    }
}
