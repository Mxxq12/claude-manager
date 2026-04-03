import Foundation

struct WSMessage {
    let type: String
    let payload: [String: Any]
    let payloadArray: [[String: Any]]?

    init?(data: Data) {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return nil
        }
        self.type = type
        // Backend sends { type: "xxx", payload: {...} } or { type: "xxx", payload: [...] }
        if let dict = json["payload"] as? [String: Any] {
            self.payload = dict
            self.payloadArray = nil
        } else if let arr = json["payload"] as? [[String: Any]] {
            self.payload = [:]
            self.payloadArray = arr
        } else {
            self.payload = [:]
            self.payloadArray = nil
        }
    }

    static func encode(type: String, payload: [String: Any] = [:]) -> Data? {
        let msg: [String: Any] = ["type": type, "payload": payload]
        return try? JSONSerialization.data(withJSONObject: msg)
    }
}
