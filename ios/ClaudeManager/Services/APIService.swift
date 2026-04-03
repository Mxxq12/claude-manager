import Foundation

final class APIService {
    var baseURL: String = ""
    var token: String = ""

    private func makeRequest(path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        let url = URL(string: "\(baseURL)\(path)")!
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15

        if let body = body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        if httpResponse.statusCode == 401 {
            throw APIError.unauthorized
        }

        guard (200...299).contains(httpResponse.statusCode) else {
            throw APIError.serverError(httpResponse.statusCode)
        }

        return data
    }

    func fetchSessions() async throws -> [Session] {
        let data = try await makeRequest(path: "/api/sessions")
        let decoder = JSONDecoder()
        do {
            return try decoder.decode([Session].self, from: data)
        } catch {
            print("[API] fetchSessions decode error: \(error)")
            print("[API] response: \(String(data: data, encoding: .utf8) ?? "nil")")
            throw error
        }
    }

    func createSession(cwd: String, resume: Bool? = nil, model: String? = nil) async throws -> String {
        var body: [String: Any] = ["cwd": cwd]
        if let resume = resume { body["resume"] = resume }
        if let model = model { body["model"] = model }

        let data = try await makeRequest(path: "/api/sessions", method: "POST", body: body)

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = json["id"] as? String else {
            throw APIError.invalidResponse
        }
        return id
    }

    func deleteSession(id: String) async throws {
        _ = try await makeRequest(path: "/api/sessions/\(id)", method: "DELETE")
    }

    func fetchProjects() async throws -> [Project] {
        let data = try await makeRequest(path: "/api/projects")
        do {
            return try JSONDecoder().decode([Project].self, from: data)
        } catch {
            print("[API] fetchProjects decode error: \(error)")
            print("[API] response: \(String(data: data, encoding: .utf8)?.prefix(500) ?? "nil")")
            throw error
        }
    }
}

enum APIError: LocalizedError {
    case invalidResponse
    case unauthorized
    case serverError(Int)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: return "无效的响应"
        case .unauthorized: return "认证已过期，请重新登录"
        case .serverError(let code): return "服务器错误 (\(code))"
        }
    }
}
