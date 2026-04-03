import SwiftUI

struct SessionListView: View {
    @EnvironmentObject var viewModel: AppViewModel
    @State private var showNewSession = false
    @State private var sessionToDelete: Session?
    @State private var showDeleteConfirm = false
    @State private var showServerSettings = false
    @State private var newServerAddress = ""

    var body: some View {
        ZStack {
            Color.bgPrimary.ignoresSafeArea()

            if viewModel.sortedSessions.isEmpty {
                VStack(spacing: 16) {
                    Image(systemName: "rectangle.stack.badge.plus")
                        .font(.system(size: 48))
                        .foregroundColor(.textSecondary)
                    Text("暂无会话")
                        .font(.title3)
                        .foregroundColor(.textSecondary)
                    Text("点击右上角 + 创建新会话")
                        .font(.subheadline)
                        .foregroundColor(.textSecondary.opacity(0.7))
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(viewModel.sortedSessions) { session in
                            NavigationLink(destination: SessionView(sessionId: session.id)) {
                                SessionCard(
                                    session: session,
                                    isAutoApprove: viewModel.autoApproveSessions.contains(session.id)
                                )
                            }
                            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                                Button(role: .destructive) {
                                    sessionToDelete = session
                                    showDeleteConfirm = true
                                } label: {
                                    Label("删除", systemImage: "trash")
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                }
                .refreshable {
                    await viewModel.refreshSessions()
                }
            }
        }
        .navigationTitle("会话列表")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    newServerAddress = viewModel.serverAddress
                    showServerSettings = true
                } label: {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(viewModel.wsConnected ? Color.green : Color.red)
                            .frame(width: 8, height: 8)
                        Text(viewModel.wsConnected ? "已连接" : "断开")
                            .font(.caption)
                            .foregroundColor(.textSecondary)
                    }
                }
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    Button {
                        showNewSession = true
                    } label: {
                        Image(systemName: "plus")
                            .foregroundColor(.cmAccent)
                    }

                    Button {
                        viewModel.logout()
                    } label: {
                        Image(systemName: "rectangle.portrait.and.arrow.right")
                            .foregroundColor(.textSecondary)
                    }
                }
            }
        }
        .sheet(isPresented: $showNewSession) {
            NewSessionView()
        }
        .alert("确认删除", isPresented: $showDeleteConfirm) {
            Button("取消", role: .cancel) {}
            Button("删除", role: .destructive) {
                if let session = sessionToDelete {
                    Task {
                        try? await viewModel.deleteSession(id: session.id)
                    }
                }
            }
        } message: {
            if let session = sessionToDelete {
                Text("确定要删除会话 \"\(session.name)\" 吗？")
            }
        }
        .alert("服务器地址", isPresented: $showServerSettings) {
            TextField("地址", text: $newServerAddress)
                .autocapitalization(.none)
                .autocorrectionDisabled()
            Button("取消", role: .cancel) {}
            Button("重新连接") {
                if !newServerAddress.isEmpty {
                    viewModel.reconnect(server: newServerAddress)
                }
            }
        } message: {
            Text("当前: \(viewModel.serverAddress)")
        }
    }
}
