import Foundation

final class AuthService {
    private let serverKey = "cm_server_address"
    private let tokenKey = "cm_auth_token"
    private let passwordKey = "cm_saved_password"
    private let rememberKey = "cm_remember_password"

    struct LoginResponse: Codable {
        let token: String
    }

    func login(server: String, password: String) async throws -> String {
        let url = URL(string: "\(server)/api/login")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        let body = ["password": password]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw AuthError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw AuthError.invalidPassword
        }

        guard httpResponse.statusCode == 200 else {
            throw AuthError.serverError(httpResponse.statusCode)
        }

        let loginResponse = try JSONDecoder().decode(LoginResponse.self, from: data)
        return loginResponse.token
    }

    func saveCredentials(server: String, token: String, password: String?, remember: Bool) {
        let defaults = UserDefaults.standard
        defaults.set(server, forKey: serverKey)
        defaults.set(token, forKey: tokenKey)
        defaults.set(remember, forKey: rememberKey)
        if remember {
            defaults.set(password, forKey: passwordKey)
        } else {
            defaults.removeObject(forKey: passwordKey)
        }
    }

    func loadCredentials() -> (server: String?, token: String?, password: String?, remember: Bool) {
        let defaults = UserDefaults.standard
        return (
            server: defaults.string(forKey: serverKey),
            token: defaults.string(forKey: tokenKey),
            password: defaults.string(forKey: passwordKey),
            remember: defaults.bool(forKey: rememberKey)
        )
    }

    func clearCredentials() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: tokenKey)
        defaults.removeObject(forKey: passwordKey)
        defaults.removeObject(forKey: rememberKey)
    }
}

enum AuthError: LocalizedError {
    case invalidPassword
    case invalidResponse
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidPassword: return "密码错误"
        case .invalidResponse: return "服务器响应无效"
        case .serverError(let code): return "服务器错误 (\(code))"
        }
    }
}
