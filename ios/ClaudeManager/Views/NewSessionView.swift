import SwiftUI

struct NewSessionView: View {
    @EnvironmentObject var viewModel: AppViewModel
    @Environment(\.dismiss) var dismiss

    enum Tab: String, CaseIterable {
        case openProject = "打开项目"
        case newProject = "新建项目"
    }

    @State private var selectedTab: Tab = .openProject
    @State private var projects: [Project] = []
    @State private var isLoadingProjects = true
    @State private var newProjectDir = ""
    @State private var newProjectName = ""
    @State private var isCreating = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                Color.bgPrimary.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Tab picker
                    Picker("", selection: $selectedTab) {
                        ForEach(Tab.allCases, id: \.self) { tab in
                            Text(tab.rawValue).tag(tab)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 16)
                    .padding(.top, 8)

                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .padding(.horizontal, 16)
                            .padding(.top, 8)
                    }

                    switch selectedTab {
                    case .openProject:
                        openProjectView
                    case .newProject:
                        newProjectView
                    }
                }
            }
            .navigationTitle("新建会话")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("取消") { dismiss() }
                        .foregroundColor(.cmAccent)
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            await loadProjects()
        }
    }

    // MARK: - Open Project

    private var openProjectView: some View {
        Group {
            if isLoadingProjects {
                VStack {
                    Spacer()
                    ProgressView()
                        .tint(.cmAccent)
                    Text("加载项目列表...")
                        .font(.subheadline)
                        .foregroundColor(.textSecondary)
                        .padding(.top, 8)
                    Spacer()
                }
            } else if projects.isEmpty {
                VStack(spacing: 12) {
                    Spacer()
                    Image(systemName: "folder.badge.questionmark")
                        .font(.system(size: 40))
                        .foregroundColor(.textSecondary)
                    Text("没有找到项目")
                        .foregroundColor(.textSecondary)
                    Spacer()
                }
            } else {
                ScrollView {
                    LazyVStack(spacing: 6) {
                        ForEach(projects) { project in
                            Button {
                                createSession(cwd: project.path)
                            } label: {
                                HStack {
                                    Image(systemName: "folder.fill")
                                        .foregroundColor(.cmAccent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(project.name)
                                            .font(.subheadline)
                                            .foregroundColor(.white)
                                        Text(project.path)
                                            .font(.caption)
                                            .foregroundColor(.textSecondary)
                                            .lineLimit(1)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundColor(.textSecondary)
                                }
                                .padding(12)
                                .background(Color.bgCard)
                                .cornerRadius(8)
                            }
                            .disabled(isCreating)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)
                }
            }
        }
    }

    // MARK: - New Project

    private var newProjectView: some View {
        VStack(spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text("项目目录")
                    .font(.caption)
                    .foregroundColor(.textSecondary)

                TextField("/path/to/project", text: $newProjectDir)
                    .textFieldStyle(.plain)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Color.bgCard)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.border, lineWidth: 1)
                    )
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("项目名称（可选）")
                    .font(.caption)
                    .foregroundColor(.textSecondary)

                TextField("my-project", text: $newProjectName)
                    .textFieldStyle(.plain)
                    .autocapitalization(.none)
                    .autocorrectionDisabled()
                    .padding(12)
                    .background(Color.bgCard)
                    .cornerRadius(8)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.border, lineWidth: 1)
                    )
                    .foregroundColor(.white)
            }

            Button(action: { createSession(cwd: newProjectDir) }) {
                HStack {
                    if isCreating {
                        ProgressView()
                            .tint(.white)
                    }
                    Text("创建会话")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(14)
                .background(newProjectDir.isEmpty ? Color.cmAccent.opacity(0.3) : Color.cmAccent)
                .foregroundColor(.white)
                .cornerRadius(8)
            }
            .disabled(newProjectDir.isEmpty || isCreating)

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }

    // MARK: - Actions

    private func loadProjects() async {
        do {
            projects = try await viewModel.apiService.fetchProjects()
        } catch {
            errorMessage = "加载项目失败: \(error.localizedDescription)"
        }
        isLoadingProjects = false
    }

    private func createSession(cwd: String) {
        isCreating = true
        errorMessage = nil

        Task {
            do {
                _ = try await viewModel.createSession(cwd: cwd)
                dismiss()
            } catch {
                errorMessage = "创建失败: \(error.localizedDescription)"
            }
            isCreating = false
        }
    }
}
