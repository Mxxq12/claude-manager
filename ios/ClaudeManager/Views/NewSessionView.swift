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
    @State private var newProjectDir = UserDefaults.standard.string(forKey: "lastProjectDir") ?? "/Users/jabi/Documents/claude"
    @State private var newProjectName = ""
    @State private var isCreating = false
    @State private var errorMessage: String?
    @State private var searchText = ""
    @FocusState private var focusedField: NewField?

    enum NewField { case dir, name, search }

    var filteredProjects: [Project] {
        if searchText.isEmpty { return projects }
        return projects.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            $0.path.localizedCaseInsensitiveContains(searchText)
        }
    }

    var fullPathPreview: String {
        let dir = newProjectDir.hasSuffix("/") ? String(newProjectDir.dropLast()) : newProjectDir
        if newProjectName.isEmpty { return dir }
        return "\(dir)/\(newProjectName)"
    }

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Grabber + header
                VStack(spacing: 14) {
                    Capsule()
                        .fill(Color.dsBorder)
                        .frame(width: 36, height: 5)
                        .padding(.top, 8)

                    HStack {
                        Text("新建会话")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.dsTextPrimary)
                        Spacer()
                        Button {
                            Haptics.light()
                            dismiss()
                        } label: {
                            Image(systemName: "xmark")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.dsTextSecondary)
                                .frame(width: 30, height: 30)
                                .background(Circle().fill(Color.dsCardHover))
                        }
                    }
                    .padding(.horizontal, 20)

                    // Custom segmented picker
                    customSegmented
                        .padding(.horizontal, 20)
                }

                if let error = errorMessage {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .foregroundColor(.dsError)
                        Text(error)
                            .font(.system(size: 12))
                            .foregroundColor(.dsTextPrimary)
                        Spacer(minLength: 0)
                    }
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.dsError.opacity(0.12))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .stroke(Color.dsError.opacity(0.3), lineWidth: 1)
                    )
                    .padding(.horizontal, 20)
                    .padding(.top, 10)
                }

                Group {
                    switch selectedTab {
                    case .openProject:
                        openProjectView
                    case .newProject:
                        newProjectView
                    }
                }
                .padding(.top, 16)
            }
        }
        .preferredColorScheme(.dark)
        .presentationDetents([.large])
        .presentationDragIndicator(.hidden)
        .task { await loadProjects() }
    }

    // MARK: - Custom Segmented

    private var customSegmented: some View {
        HStack(spacing: 4) {
            ForEach(Tab.allCases, id: \.self) { tab in
                Button {
                    Haptics.light()
                    withAnimation(DSAnim.spring) { selectedTab = tab }
                } label: {
                    Text(tab.rawValue)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(selectedTab == tab ? .white : .dsTextSecondary)
                        .frame(maxWidth: .infinity)
                        .frame(height: 36)
                        .background(
                            ZStack {
                                if selectedTab == tab {
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .fill(LinearGradient.dsAccentGradient)
                                }
                            }
                        )
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.dsCardHover)
        )
    }

    // MARK: - Open Project

    private var openProjectView: some View {
        VStack(spacing: 12) {
            // Search
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 13))
                    .foregroundColor(.dsTextTertiary)
                TextField("", text: $searchText, prompt: Text("搜索项目")
                    .foregroundColor(.dsTextTertiary))
                    .textFieldStyle(.plain)
                    .foregroundColor(.dsTextPrimary)
                    .font(.system(size: 14))
                    .focused($focusedField, equals: .search)
                if !searchText.isEmpty {
                    Button { searchText = "" } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 14))
                            .foregroundColor(.dsTextTertiary)
                    }
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 42)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.dsCardHover)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(focusedField == .search ? Color.dsAccentBlue : Color.dsBorder, lineWidth: 1)
            )
            .padding(.horizontal, 20)

            if isLoadingProjects {
                Spacer()
                ProgressView()
                    .progressViewStyle(CircularProgressViewStyle(tint: .dsAccentBlue))
                Text("加载项目列表...")
                    .font(.system(size: 13))
                    .foregroundColor(.dsTextSecondary)
                    .padding(.top, 8)
                Spacer()
            } else if filteredProjects.isEmpty {
                Spacer()
                VStack(spacing: 12) {
                    Image(systemName: "folder.badge.questionmark")
                        .font(.system(size: 40))
                        .foregroundColor(.dsTextTertiary)
                    Text(searchText.isEmpty ? "没有找到项目" : "无匹配项目")
                        .font(.system(size: 14))
                        .foregroundColor(.dsTextSecondary)
                }
                Spacer()
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        ForEach(filteredProjects) { project in
                            Button {
                                Haptics.light()
                                createSession(cwd: project.path)
                            } label: {
                                projectRow(project)
                            }
                            .buttonStyle(DSPressableStyle(scale: 0.98))
                            .disabled(isCreating)
                        }
                    }
                    .padding(.horizontal, 20)
                    .padding(.bottom, 20)
                }
            }
        }
    }

    private func projectRow(_ project: Project) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(LinearGradient.dsAccentGradient.opacity(0.15))
                    .frame(width: 40, height: 40)
                Image(systemName: "folder.fill")
                    .font(.system(size: 16))
                    .foregroundStyle(LinearGradient.dsAccentGradient)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.dsTextPrimary)
                    .lineLimit(1)
                Text(project.path)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(.dsTextSecondary)
                    .lineLimit(1)
                    .truncationMode(.head)
            }

            Spacer(minLength: 6)

            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.dsTextTertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.dsCard)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.dsBorder, lineWidth: 1)
        )
    }

    // MARK: - New Project

    private var newProjectView: some View {
        ScrollView {
            VStack(spacing: 18) {
                fieldGroup(
                    label: "父目录",
                    description: "新项目将在该目录下创建",
                    icon: "folder.fill",
                    isFocused: focusedField == .dir
                ) {
                    TextField("", text: $newProjectDir, prompt: Text("/Users/you/projects")
                        .foregroundColor(.dsTextTertiary))
                        .textFieldStyle(.plain)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .foregroundColor(.dsTextPrimary)
                        .font(.system(size: 14))
                        .focused($focusedField, equals: .dir)
                }

                fieldGroup(
                    label: "项目名称",
                    description: "可选，留空则直接使用父目录",
                    icon: "doc.text.fill",
                    isFocused: focusedField == .name
                ) {
                    TextField("", text: $newProjectName, prompt: Text("my-project")
                        .foregroundColor(.dsTextTertiary))
                        .textFieldStyle(.plain)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .foregroundColor(.dsTextPrimary)
                        .font(.system(size: 14))
                        .focused($focusedField, equals: .name)
                }

                // Path preview
                VStack(alignment: .leading, spacing: 6) {
                    Text("完整路径")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.dsTextSecondary)
                        .textCase(.uppercase)
                        .tracking(0.5)
                    HStack(spacing: 8) {
                        Image(systemName: "arrow.turn.down.right")
                            .font(.system(size: 11))
                            .foregroundColor(.dsAccentPurple)
                        Text(fullPathPreview)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(.dsTextPrimary)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                    }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(Color.dsAccentPurple.opacity(0.08))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(Color.dsAccentPurple.opacity(0.25), lineWidth: 1)
                    )
                }

                Spacer().frame(height: 8)

                Button {
                    Haptics.medium()
                    createSession(cwd: fullPathPreview)
                } label: {
                    HStack(spacing: 8) {
                        if isCreating {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                .scaleEffect(0.85)
                        } else {
                            Image(systemName: "plus.circle.fill")
                        }
                        Text(isCreating ? "创建中..." : "创建会话")
                    }
                }
                .buttonStyle(DSPrimaryButtonStyle(disabled: newProjectDir.isEmpty || isCreating))
                .disabled(newProjectDir.isEmpty || isCreating)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(
        label: String,
        description: String,
        icon: String,
        isFocused: Bool,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.dsTextPrimary)
                Text(description)
                    .font(.system(size: 11))
                    .foregroundColor(.dsTextTertiary)
            }
            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 13))
                    .foregroundColor(isFocused ? .dsAccentBlue : .dsTextTertiary)
                    .frame(width: 18)
                content()
            }
            .padding(.horizontal, 14)
            .frame(height: 46)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.dsCardHover)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(isFocused ? Color.dsAccentBlue : Color.dsBorder, lineWidth: isFocused ? 1.5 : 1)
            )
            .animation(DSAnim.quickSpring, value: isFocused)
        }
    }

    // MARK: - Helper for fieldGroup signature with trailing isFocused

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
                let parentDir = (cwd as NSString).deletingLastPathComponent
                UserDefaults.standard.set(parentDir.isEmpty ? cwd : parentDir, forKey: "lastProjectDir")
                Haptics.success()
                dismiss()
            } catch {
                errorMessage = "创建失败: \(error.localizedDescription)"
            }
            isCreating = false
        }
    }
}
