import SwiftUI

struct SessionCard: View {
    let session: Session
    let isAutoApprove: Bool

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            Circle()
                .fill(session.statusColor)
                .frame(width: 10, height: 10)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(session.name)
                        .font(.headline)
                        .foregroundColor(.white)
                        .lineLimit(1)

                    if isAutoApprove {
                        Text("自动")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.cmAccent)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.cmAccent.opacity(0.15))
                            .cornerRadius(4)
                    }

                    if session.isApproval {
                        Text("待审批")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.orange)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(Color.orange.opacity(0.15))
                            .cornerRadius(4)
                    }
                }

                Text(session.cwd)
                    .font(.caption)
                    .foregroundColor(.textSecondary)
                    .lineLimit(1)
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 4) {
                Text(session.displayStatus)
                    .font(.caption)
                    .foregroundColor(session.statusColor)

                if let timeAgo = session.statusTimeAgo {
                    Text(timeAgo)
                        .font(.caption2)
                        .foregroundColor(.textSecondary)
                }
            }
        }
        .padding(12)
        .background(Color.bgCard)
        .cornerRadius(10)
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .stroke(Color.border, lineWidth: 1)
        )
    }
}
