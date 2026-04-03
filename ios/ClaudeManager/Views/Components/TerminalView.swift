import SwiftUI
import SwiftTerm

struct TerminalUIView: UIViewRepresentable {
    typealias UIViewType = SwiftTerm.TerminalView

    let sessionId: String
    @EnvironmentObject var viewModel: AppViewModel

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeUIView(context: Context) -> SwiftTerm.TerminalView {
        let termView = SwiftTerm.TerminalView(frame: CGRect(x: 0, y: 0, width: 800, height: 600))

        // Dark theme
        termView.nativeBackgroundColor = UIColor(red: 1/255, green: 4/255, blue: 9/255, alpha: 1)
        termView.nativeForegroundColor = UIColor(red: 230/255, green: 237/255, blue: 243/255, alpha: 1)

        // Font
        if let monoFont = UIFont(name: "Menlo", size: 9) {
            termView.font = monoFont
        }

        // Allow scrolling but no keyboard
        termView.isUserInteractionEnabled = true

        context.coordinator.terminalView = termView
        context.coordinator.sessionId = sessionId

        // Register output listener
        NSLog("[Terminal] Registering output listener for %@", sessionId)
        viewModel.webSocketService.addOutputListener(sessionId: sessionId) { [weak termView] data in
            DispatchQueue.main.async {
                guard let tv = termView else { return }
                let bytes = [UInt8](data)
                tv.feed(byteArray: ArraySlice(bytes))
            }
        }

        // Request existing buffer
        NSLog("[Terminal] Requesting buffer for %@", sessionId)
        viewModel.webSocketService.requestBuffer(sessionId: sessionId)

        // Resize PTY to match terminal size after layout
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak termView] in
            guard let tv = termView else { return }
            let terminal = tv.getTerminal()
            let cols = terminal.cols
            let rows = terminal.rows
            NSLog("[Terminal] Sending resize: cols=%d rows=%d", cols, rows)
            viewModel.webSocketService.sendResize(sessionId: sessionId, cols: cols, rows: rows)
        }

        return termView
    }

    func updateUIView(_ uiView: SwiftTerm.TerminalView, context: Context) {
    }

    static func dismantleUIView(_ uiView: SwiftTerm.TerminalView, coordinator: Coordinator) {
    }

    class Coordinator: NSObject {
        var terminalView: SwiftTerm.TerminalView?
        var sessionId: String = ""
    }
}
