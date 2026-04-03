import SwiftUI
import Speech
import AVFoundation

struct SessionView: View {
    let sessionId: String
    @EnvironmentObject var viewModel: AppViewModel

    @State private var inputText = ""
    @State private var inputMode: InputMode = .keyboard
    @State private var isRecording = false
    @State private var showQuickKeys = true

    // Speech
    @State private var speechRecognizer: SFSpeechRecognizer?
    @State private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    @State private var recognitionTask: SFSpeechRecognitionTask?
    @State private var audioEngine = AVAudioEngine()

    enum InputMode {
        case keyboard, voice
    }

    var session: Session? {
        viewModel.sessions[sessionId]
    }

    var body: some View {
        ZStack {
            Color.bgPrimary.ignoresSafeArea()

            VStack(spacing: 0) {
                // Terminal area
                TerminalUIView(sessionId: sessionId)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Approval banner
                if session?.isApproval == true {
                    approvalBanner
                }

                // Quick action keys
                if showQuickKeys {
                    quickKeysBar
                }

                // Input bar
                inputBar
            }
        }
        .navigationTitle(session?.name ?? "会话")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 12) {
                    // Status
                    if let s = session {
                        Circle()
                            .fill(s.statusColor)
                            .frame(width: 8, height: 8)
                    }

                    // Auto-approve toggle
                    Button {
                        viewModel.toggleAutoApprove(sessionId: sessionId)
                    } label: {
                        Image(systemName: viewModel.autoApproveSessions.contains(sessionId) ? "bolt.fill" : "bolt.slash")
                            .foregroundColor(viewModel.autoApproveSessions.contains(sessionId) ? .cmAccent : .textSecondary)
                    }

                    // Kill button
                    Button {
                        viewModel.webSocketService.sendKill(sessionId: sessionId)
                    } label: {
                        Image(systemName: "stop.circle")
                            .foregroundColor(.red)
                    }
                }
            }
        }
        .onDisappear {
            viewModel.webSocketService.removeOutputListeners(sessionId: sessionId)
            stopRecording()
        }
    }

    // MARK: - Approval Banner

    private var approvalBanner: some View {
        HStack {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text("需要审批操作")
                .font(.subheadline)
                .foregroundColor(.white)
            Spacer()
            Button("批准") {
                viewModel.webSocketService.sendApprove(sessionId: sessionId)
            }
            .font(.subheadline.bold())
            .padding(.horizontal, 16)
            .padding(.vertical, 6)
            .background(Color.orange)
            .foregroundColor(.white)
            .cornerRadius(6)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.orange.opacity(0.15))
    }

    // MARK: - Quick Keys

    private var quickKeysBar: some View {
        HStack(spacing: 0) {
            quickKey(symbol: "arrow.up", label: "Up") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[A")
            }
            quickKey(symbol: "arrow.down", label: "Down") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[B")
            }
            quickKey(symbol: "return", label: "Enter") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\r")
            }
            quickKey(symbol: "xmark.circle", label: "Ctrl+C") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{03}")
            }
            quickKey(symbol: "character.cursor.ibeam", label: "Tab") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\t")
            }

            Spacer()

            Button {
                showQuickKeys = false
            } label: {
                Image(systemName: "chevron.down")
                    .font(.caption)
                    .foregroundColor(.textSecondary)
                    .padding(8)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.bgCard)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(Color.border),
            alignment: .top
        )
    }

    private func quickKey(symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 2) {
                Image(systemName: symbol)
                    .font(.system(size: 14))
                Text(label)
                    .font(.system(size: 8))
            }
            .foregroundColor(.cmAccent)
            .frame(width: 50, height: 36)
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 8) {
            // Mode toggle
            Button {
                inputMode = inputMode == .keyboard ? .voice : .keyboard
                if inputMode == .keyboard {
                    stopRecording()
                }
            } label: {
                Image(systemName: inputMode == .keyboard ? "mic" : "keyboard")
                    .font(.system(size: 18))
                    .foregroundColor(.cmAccent)
                    .frame(width: 36, height: 36)
            }

            if !showQuickKeys {
                Button {
                    showQuickKeys = true
                } label: {
                    Image(systemName: "chevron.up")
                        .font(.system(size: 14))
                        .foregroundColor(.textSecondary)
                        .frame(width: 28, height: 36)
                }
            }

            if inputMode == .keyboard {
                // Text input
                TextField("输入消息...", text: $inputText)
                    .textFieldStyle(.plain)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.bgCard)
                    .cornerRadius(18)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18)
                            .stroke(Color.border, lineWidth: 1)
                    )
                    .foregroundColor(.white)
                    .submitLabel(.send)
                    .onSubmit {
                        sendMessage()
                    }

                // Send button
                Button(action: sendMessage) {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 28))
                        .foregroundColor(inputText.isEmpty ? .textSecondary : .cmAccent)
                }
                .disabled(inputText.isEmpty)
            } else {
                // Voice input - hold to speak
                Button(action: {}) {
                    Text(isRecording ? "松开发送" : "按住说话")
                        .font(.subheadline)
                        .foregroundColor(isRecording ? .white : .textSecondary)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 10)
                        .background(isRecording ? Color.cmAccent.opacity(0.3) : Color.bgCard)
                        .cornerRadius(18)
                        .overlay(
                            RoundedRectangle(cornerRadius: 18)
                                .stroke(isRecording ? Color.cmAccent : Color.border, lineWidth: 1)
                        )
                }
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.1)
                        .onEnded { _ in
                            startRecording()
                        }
                        .sequenced(before: DragGesture(minimumDistance: 0)
                            .onEnded { _ in
                                stopRecordingAndSend()
                            })
                )
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Color.bgPrimary)
        .overlay(
            Rectangle()
                .frame(height: 1)
                .foregroundColor(Color.border),
            alignment: .top
        )
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        viewModel.webSocketService.sendInput(sessionId: sessionId, text: text)
        inputText = ""
    }

    // MARK: - Speech Recognition

    private func startRecording() {
        guard !isRecording else { return }

        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else { return }
        }

        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else { return }

            DispatchQueue.main.async {
                self.performRecording()
            }
        }
    }

    private func performRecording() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else { return }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }
        recognitionRequest.shouldReportPartialResults = true

        // Configure audio session before accessing inputNode
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session setup failed: \(error)")
            return
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        guard recordingFormat.sampleRate > 0 && recordingFormat.channelCount > 0 else {
            print("Invalid audio format: \(recordingFormat)")
            return
        }

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isRecording = true
        } catch {
            print("Audio engine failed to start: \(error)")
            return
        }

        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { result, error in
            if let result = result {
                inputText = result.bestTranscription.formattedString
            }
            if error != nil {
                stopRecording()
            }
        }
    }

    private func stopRecordingAndSend() {
        stopRecording()
        // Small delay to ensure final transcription is received
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            if !inputText.isEmpty {
                sendMessage()
            }
        }
    }

    private func stopRecording() {
        guard isRecording else { return }
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()
        recognitionRequest = nil
        recognitionTask = nil
        isRecording = false
    }
}
