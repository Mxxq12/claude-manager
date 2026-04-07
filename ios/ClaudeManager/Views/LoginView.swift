import SwiftUI

struct LoginView: View {
    @EnvironmentObject var viewModel: AppViewModel

    @State private var server = ""
    @State private var password = ""
    @State private var rememberPassword = true
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showError = false

    @FocusState private var focusedField: Field?

    enum Field { case server, password }

    var body: some View {
        ZStack {
            // Radial gradient background
            Color.dsBackground.ignoresSafeArea()
            RadialGradient.dsBackgroundRadial.ignoresSafeArea()

            // Subtle floating glow
            Circle()
                .fill(Color.dsAccentBlue.opacity(0.15))
                .frame(width: 320, height: 320)
                .blur(radius: 90)
                .offset(x: -80, y: -260)

            Circle()
                .fill(Color.dsAccentPurple.opacity(0.12))
                .frame(width: 280, height: 280)
                .blur(radius: 90)
                .offset(x: 120, y: 240)

            ScrollView(showsIndicators: false) {
                VStack(spacing: 28) {
                    Spacer().frame(height: 60)

                    // Logo
                    logoHeader

                    // Form card
                    formCard

                    // Error toast
                    if showError, let error = errorMessage {
                        errorToast(error)
                            .transition(.move(edge: .top).combined(with: .opacity))
                    }

                    Spacer().frame(height: 40)
                }
                .padding(.horizontal, 24)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            let creds = viewModel.authService.loadCredentials()
            if let savedServer = creds.server { server = savedServer }
            if let savedPassword = creds.password { password = savedPassword }
            rememberPassword = creds.remember
        }
    }

    // MARK: - Logo Header

    private var logoHeader: some View {
        VStack(spacing: 16) {
            ZStack {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(LinearGradient.dsAccentGradient)
                    .frame(width: 80, height: 80)
                    .shadow(color: Color.dsAccentBlue.opacity(0.45), radius: 22, x: 0, y: 12)

                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.18), lineWidth: 1)
                    .frame(width: 80, height: 80)

                Image(systemName: "terminal.fill")
                    .font(.system(size: 36, weight: .semibold))
                    .foregroundColor(.white)
            }

            VStack(spacing: 4) {
                Text("Claude Manager")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(.dsTextPrimary)

                Text("远程控制台")
                    .font(.system(size: 14, weight: .regular))
                    .foregroundColor(.dsTextSecondary)
            }
        }
    }

    // MARK: - Form Card

    private var formCard: some View {
        VStack(spacing: 18) {
            // Server field
            fieldGroup(
                label: "服务器地址",
                icon: "globe",
                content: {
                    TextField("", text: $server, prompt: Text("http://192.168.1.x:3200")
                        .foregroundColor(.dsTextTertiary))
                        .textFieldStyle(.plain)
                        .keyboardType(.URL)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                        .foregroundColor(.dsTextPrimary)
                        .focused($focusedField, equals: .server)
                },
                isFocused: focusedField == .server
            )

            // Password field
            fieldGroup(
                label: "密码",
                icon: "lock.fill",
                content: {
                    SecureField("", text: $password, prompt: Text("输入密码")
                        .foregroundColor(.dsTextTertiary))
                        .textFieldStyle(.plain)
                        .foregroundColor(.dsTextPrimary)
                        .focused($focusedField, equals: .password)
                },
                isFocused: focusedField == .password
            )

            Divider()
                .background(Color.dsBorder)
                .padding(.top, 2)

            Toggle(isOn: $rememberPassword) {
                Text("记住密码")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.dsTextSecondary)
            }
            .tint(.dsAccentBlue)

            Button(action: login) {
                HStack(spacing: 10) {
                    if isLoading {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            .scaleEffect(0.9)
                    }
                    Text(isLoading ? "登录中..." : "登 录")
                }
            }
            .buttonStyle(DSPrimaryButtonStyle(disabled: isLoading || server.isEmpty || password.isEmpty))
            .disabled(isLoading || server.isEmpty || password.isEmpty)
            .padding(.top, 4)
        }
        .padding(22)
        .dsCard(cornerRadius: 20)
        .shadow(color: Color.black.opacity(0.35), radius: 30, x: 0, y: 18)
    }

    @ViewBuilder
    private func fieldGroup<Content: View>(
        label: String,
        icon: String,
        @ViewBuilder content: () -> Content,
        isFocused: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(.dsTextSecondary)
                .textCase(.uppercase)
                .tracking(0.5)

            HStack(spacing: 10) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(isFocused ? .dsAccentBlue : .dsTextTertiary)
                    .frame(width: 18)
                content()
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
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

    private func errorToast(_ message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundColor(.dsError)
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundColor(.dsTextPrimary)
                .lineLimit(3)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.dsError.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.dsError.opacity(0.4), lineWidth: 1)
        )
    }

    // MARK: - Actions

    private func login() {
        Haptics.light()
        isLoading = true
        withAnimation(DSAnim.spring) { showError = false }
        errorMessage = nil

        Task {
            do {
                try await viewModel.login(server: server, password: password, remember: rememberPassword)
                Haptics.success()
            } catch {
                errorMessage = error.localizedDescription
                withAnimation(DSAnim.spring) { showError = true }
            }
            isLoading = false
        }
    }
}
