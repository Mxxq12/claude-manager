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
            Color.dsBackground.ignoresSafeArea()
            RadialGradient.dsBackgroundRadial.ignoresSafeArea()

            if viewModel.sortedSessions.isEmpty {
                emptyState
            } else {
                sessionList
            }
        }
        .navigationTitle("会话")
        .navigationBarTitleDisplayMode(.large)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarLeading) {
                Button {
                    Haptics.light()
                    newServerAddress = viewModel.serverAddress
                    showServerSettings = true
                } label: {
                    DSStatusPill(connected: viewModel.wsConnected)
                }
                .buttonStyle(.plain)
            }

            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 14) {
                    Button {
                        Haptics.light()
                        showNewSession = true
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(LinearGradient.dsAccentGradient)
                    }

                    Menu {
                        Button(role: .destructive) {
                            viewModel.logout()
                        } label: {
                            Label("登出", systemImage: "rectangle.portrait.and.arrow.right")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundColor(.dsTextSecondary)
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
                    Task { try? await viewModel.deleteSession(id: session.id) }
                }
            }
        } message: {
            if let session = sessionToDelete {
                Text("确定要删除会话 \"\(session.name)\" 吗？")
            }
        }
        .sheet(isPresented: $showServerSettings) {
            serverSettingsSheet
        }
    }

    // MARK: - Server Settings Sheet

    @FocusState private var serverFieldFocused: Bool

    private var serverSettingsSheet: some View {
        NavigationView {
            ZStack {
                Color.dsBackground.ignoresSafeArea()
                VStack(spacing: 20) {
                    Text("当前: \(viewModel.serverAddress)")
                        .font(.system(size: 13))
                        .foregroundColor(.dsTextSecondary)
                        .padding(.top, 8)

                    HStack(spacing: 10) {
                        TextField("http://192.168.1.x:3200", text: $newServerAddress)
                            .textFieldStyle(.plain)
                            .keyboardType(.URL)
                            .autocapitalization(.none)
                            .autocorrectionDisabled()
                            .foregroundColor(.dsTextPrimary)
                            .focused($serverFieldFocused)

                        if !newServerAddress.isEmpty {
                            Button {
                                newServerAddress = ""
                                Haptics.light()
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .font(.system(size: 18))
                                    .foregroundColor(.dsTextTertiary)
                            }
                        }
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 48)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.dsCardHover)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(serverFieldFocused ? Color.dsAccentBlue : Color.dsBorder, lineWidth: serverFieldFocused ? 1.5 : 1)
                    )
                    .padding(.horizontal, 20)

                    Button {
                        if !newServerAddress.isEmpty {
                            viewModel.reconnect(server: newServerAddress)
                            showServerSettings = false
                        }
                    } label: {
                        Text("重新连接")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(newServerAddress.isEmpty ? AnyShapeStyle(Color.gray) : AnyShapeStyle(LinearGradient.dsAccentGradient))
                            )
                    }
                    .disabled(newServerAddress.isEmpty)
                    .padding(.horizontal, 20)

                    Spacer()
                }
            }
            .navigationTitle("服务器地址")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { showServerSettings = false }
                }
            }
            .onAppear { serverFieldFocused = true }
        }
        .presentationDetents([.height(280)])
        .preferredColorScheme(.dark)
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 20) {
            Spacer()

            ZStack {
                Circle()
                    .fill(LinearGradient.dsAccentGradient.opacity(0.15))
                    .frame(width: 140, height: 140)
                    .blur(radius: 20)

                Image(systemName: "rectangle.stack.badge.plus.fill")
                    .font(.system(size: 64, weight: .light))
                    .foregroundStyle(LinearGradient.dsAccentGradient)
            }

            VStack(spacing: 8) {
                Text("暂无活跃会话")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(.dsTextPrimary)

                Text("创建一个会话来开始你的工作")
                    .font(.system(size: 14))
                    .foregroundColor(.dsTextSecondary)
            }

            Button {
                Haptics.medium()
                showNewSession = true
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: "plus.circle.fill")
                    Text("创建第一个会话")
                }
            }
            .buttonStyle(DSPrimaryButtonStyle())
            .frame(maxWidth: 280)
            .padding(.top, 8)

            Spacer()
            Spacer()
        }
        .padding(.horizontal, 32)
    }

    // MARK: - Session List

    private var sessionList: some View {
        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(viewModel.sortedSessions) { session in
                    NavigationLink {
                        SessionView(sessionId: session.id)
                    } label: {
                        SessionCard(
                            session: session,
                            isAutoApprove: viewModel.autoApproveSessions.contains(session.id)
                        )
                    }
                    .buttonStyle(DSPressableStyle(scale: 0.98))
                    .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                        Button(role: .destructive) {
                            sessionToDelete = session
                            showDeleteConfirm = true
                        } label: {
                            Label("删除", systemImage: "trash")
                        }
                    }
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = session.cwd
                            Haptics.success()
                        } label: {
                            Label("复制路径", systemImage: "doc.on.doc")
                        }
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
            .padding(.top, 4)
            .padding(.bottom, 24)
        }
        .refreshable {
            await viewModel.refreshSessions()
        }
    }
}
