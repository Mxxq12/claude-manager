import SwiftUI

struct LoginView: View {
    @EnvironmentObject var viewModel: AppViewModel

    @State private var server = ""
    @State private var password = ""
    @State private var rememberPassword = true
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        ZStack {
            Color.bgPrimary.ignoresSafeArea()

            VStack(spacing: 32) {
                Spacer()

                // Logo
                VStack(spacing: 12) {
                    Image(systemName: "terminal.fill")
                        .font(.system(size: 56))
                        .foregroundColor(.cmAccent)

                    Text("Claude Manager")
                        .font(.title)
                        .fontWeight(.bold)
                        .foregroundColor(.white)

                    Text("远程控制台")
                        .font(.subheadline)
                        .foregroundColor(.textSecondary)
                }

                // Form
                VStack(spacing: 16) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("服务器地址")
                            .font(.caption)
                            .foregroundColor(.textSecondary)

                        TextField("http://192.168.1.x:3200", text: $server)
                            .textFieldStyle(.plain)
                            .keyboardType(.URL)
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
                        Text("密码")
                            .font(.caption)
                            .foregroundColor(.textSecondary)

                        SecureField("输入密码", text: $password)
                            .textFieldStyle(.plain)
                            .padding(12)
                            .background(Color.bgCard)
                            .cornerRadius(8)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(Color.border, lineWidth: 1)
                            )
                            .foregroundColor(.white)
                    }

                    Toggle(isOn: $rememberPassword) {
                        Text("记住密码")
                            .font(.subheadline)
                            .foregroundColor(.textSecondary)
                    }
                    .tint(.cmAccent)

                    if let error = errorMessage {
                        Text(error)
                            .font(.caption)
                            .foregroundColor(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button(action: login) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .tint(.white)
                            }
                            Text("登录")
                                .fontWeight(.semibold)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(14)
                        .background(isLoading ? Color.cmAccent.opacity(0.5) : Color.cmAccent)
                        .foregroundColor(.white)
                        .cornerRadius(8)
                    }
                    .disabled(isLoading || server.isEmpty || password.isEmpty)
                }
                .padding(24)
                .background(Color.bgCard)
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.border, lineWidth: 1)
                )

                Spacer()
                Spacer()
            }
            .padding(.horizontal, 24)
        }
        .onAppear {
            let creds = viewModel.authService.loadCredentials()
            if let savedServer = creds.server {
                server = savedServer
            }
            if let savedPassword = creds.password {
                password = savedPassword
            }
            rememberPassword = creds.remember
        }
    }

    private func login() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await viewModel.login(server: server, password: password, remember: rememberPassword)
            } catch {
                errorMessage = error.localizedDescription
            }
            isLoading = false
        }
    }
}
