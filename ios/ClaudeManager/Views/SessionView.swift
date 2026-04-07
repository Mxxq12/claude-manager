import SwiftUI
import Speech
import AVFoundation

struct SessionView: View {
    let sessionId: String
    @EnvironmentObject var viewModel: AppViewModel

    @State private var inputText = ""
    @State private var inputMode: InputMode = .keyboard
    @State private var showVoicePreview = false
    @State private var voicePreviewText = ""
    @State private var isRecording = false
    @State private var showQuickKeys = true
    @FocusState private var inputFocused: Bool

    // Speech
    @State private var speechRecognizer: SFSpeechRecognizer?
    @State private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    @State private var recognitionTask: SFSpeechRecognitionTask?
    @State private var audioEngine = AVAudioEngine()

    enum InputMode { case keyboard, voice }

    var session: Session? { viewModel.sessions[sessionId] }

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Subheader (cwd)
                if let s = session {
                    HStack(spacing: 6) {
                        Image(systemName: "folder.fill")
                            .font(.system(size: 10))
                            .foregroundColor(.dsTextTertiary)
                        Text(s.cwd)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(.dsTextSecondary)
                            .lineLimit(1)
                            .truncationMode(.head)
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 6)
                }

                // Terminal area with fade masks
                ZStack(alignment: .bottomTrailing) {
                    TerminalUIView(sessionId: sessionId)
                        .padding(8)
                        .background(Color.dsBackground)
                        .overlay(alignment: .top) {
                            LinearGradient(
                                colors: [Color.dsBackground, Color.dsBackground.opacity(0)],
                                startPoint: .top, endPoint: .bottom
                            )
                            .frame(height: 12)
                            .allowsHitTesting(false)
                        }
                        .overlay(alignment: .bottom) {
                            LinearGradient(
                                colors: [Color.dsBackground.opacity(0), Color.dsBackground],
                                startPoint: .top, endPoint: .bottom
                            )
                            .frame(height: 12)
                            .allowsHitTesting(false)
                        }

                    // Floating quick-keys panel (2x2)
                    if showQuickKeys {
                        floatingQuickKeys
                            .padding(.trailing, 14)
                            .padding(.bottom, 14)
                            .transition(.scale.combined(with: .opacity))
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                // Approval banner
                if session?.isApproval == true {
                    approvalBanner
                        .transition(.move(edge: .bottom).combined(with: .opacity))
                }

                // Input bar
                inputBar
            }
        }
        .preferredColorScheme(.dark)
        .navigationTitle(session?.name ?? "会话")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.dsBackground, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                VStack(spacing: 1) {
                    Text(session?.name ?? "会话")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundColor(.dsTextPrimary)
                }
            }
            ToolbarItem(placement: .navigationBarTrailing) {
                HStack(spacing: 10) {
                    if let s = session {
                        statusCapsule(for: s)
                    }
                    Menu {
                        Button {
                            Haptics.light()
                            viewModel.toggleAutoApprove(sessionId: sessionId)
                        } label: {
                            Label(
                                viewModel.autoApproveSessions.contains(sessionId) ? "关闭自动审批" : "开启自动审批",
                                systemImage: viewModel.autoApproveSessions.contains(sessionId) ? "bolt.slash" : "bolt.fill"
                            )
                        }
                        Button {
                            withAnimation(DSAnim.spring) { showQuickKeys.toggle() }
                        } label: {
                            Label(showQuickKeys ? "隐藏快捷键" : "显示快捷键",
                                  systemImage: showQuickKeys ? "keyboard.chevron.compact.down" : "keyboard")
                        }
                        Divider()
                        Button(role: .destructive) {
                            viewModel.webSocketService.sendKill(sessionId: sessionId)
                        } label: {
                            Label("终止会话", systemImage: "stop.circle")
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                            .font(.system(size: 17, weight: .medium))
                            .foregroundColor(.dsTextSecondary)
                    }
                }
            }
        }
        .onDisappear {
            viewModel.webSocketService.removeOutputListeners(sessionId: sessionId)
            stopRecording()
        }
        .sheet(isPresented: $showVoicePreview) {
            VoicePreviewSheet(
                text: $voicePreviewText,
                onConfirm: {
                    if !voicePreviewText.isEmpty {
                        viewModel.webSocketService.sendInput(sessionId: sessionId, text: voicePreviewText)
                    }
                    showVoicePreview = false
                    voicePreviewText = ""
                },
                onCancel: {
                    showVoicePreview = false
                    voicePreviewText = ""
                }
            )
            .presentationDetents([.medium])
        }
    }

    // MARK: - Status Capsule

    private func statusCapsule(for s: Session) -> some View {
        HStack(spacing: 5) {
            Circle()
                .fill(s.dsStatusColor)
                .frame(width: 6, height: 6)
            Text(s.displayStatus)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.dsTextPrimary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Capsule().fill(.ultraThinMaterial))
        .overlay(Capsule().stroke(Color.white.opacity(0.08), lineWidth: 1))
    }

    // MARK: - Approval Banner

    private var approvalBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 16))
                .foregroundColor(.dsApproval)

            VStack(alignment: .leading, spacing: 1) {
                Text("需要审批")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(.dsTextPrimary)
                Text("Claude 正在等待你的确认")
                    .font(.system(size: 11))
                    .foregroundColor(.dsTextSecondary)
            }

            Spacer()

            Button {
                Haptics.medium()
                viewModel.webSocketService.sendApprove(sessionId: sessionId)
            } label: {
                Text("批准")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.black)
                    .padding(.horizontal, 18)
                    .padding(.vertical, 8)
                    .background(
                        Capsule().fill(Color.dsApproval)
                    )
            }
            .buttonStyle(DSPressableStyle())
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.dsApproval.opacity(0.12))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .stroke(Color.dsApproval.opacity(0.5), lineWidth: 1)
        )
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
    }

    // MARK: - Floating Quick Keys (2x2 grid)

    private var floatingQuickKeys: some View {
        VStack(spacing: 6) {
            HStack(spacing: 6) {
                quickKey(symbol: "arrow.up") {
                    viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[A")
                }
                quickKey(symbol: "arrow.down") {
                    viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[B")
                }
            }
            HStack(spacing: 6) {
                quickKey(symbol: "return") {
                    viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\r")
                }
                quickKey(symbol: "escape") {
                    viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}")
                }
            }
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.ultraThinMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.4), radius: 10, x: 0, y: 6)
    }

    private func quickKey(symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.light()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .medium))
                .foregroundColor(.dsTextPrimary)
                .frame(width: 40, height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.dsCardHover.opacity(0.6))
                )
        }
        .buttonStyle(DSPressableStyle(scale: 0.9))
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            // Mode toggle
            Button {
                Haptics.light()
                inputMode = inputMode == .keyboard ? .voice : .keyboard
                if inputMode == .keyboard { stopRecording() }
            } label: {
                Image(systemName: inputMode == .keyboard ? "mic.fill" : "keyboard.fill")
                    .font(.system(size: 15, weight: .medium))
                    .foregroundColor(.dsAccentBlue)
                    .frame(width: 36, height: 36)
                    .background(
                        Circle().fill(Color.dsCardHover)
                    )
            }
            .buttonStyle(DSPressableStyle())

            if inputMode == .keyboard {
                // Text input capsule
                HStack(spacing: 8) {
                    TextField("", text: $inputText, prompt: Text("输入消息...")
                        .foregroundColor(.dsTextTertiary))
                        .textFieldStyle(.plain)
                        .foregroundColor(.dsTextPrimary)
                        .font(.system(size: 14))
                        .focused($inputFocused)
                        .submitLabel(.send)
                        .onSubmit { sendMessage() }
                }
                .padding(.horizontal, 14)
                .frame(height: 36)
                .background(
                    Capsule().fill(Color.dsCardHover)
                )
                .overlay(
                    Capsule().stroke(inputFocused ? Color.dsAccentBlue : Color.dsBorder,
                                     lineWidth: inputFocused ? 1.5 : 1)
                )
                .animation(DSAnim.quickSpring, value: inputFocused)

                // Send button
                Button(action: sendMessage) {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                        .frame(width: 36, height: 36)
                        .background(
                            Circle().fill(
                                inputText.isEmpty
                                ? AnyShapeStyle(Color.dsCardHighlight)
                                : AnyShapeStyle(LinearGradient.dsAccentGradient)
                            )
                        )
                }
                .buttonStyle(DSPressableStyle())
                .disabled(inputText.isEmpty)
            } else {
                // Voice input
                Button(action: {}) {
                    HStack(spacing: 8) {
                        Image(systemName: isRecording ? "waveform" : "mic.fill")
                            .font(.system(size: 13))
                        Text(isRecording ? "松开结束" : "按住说话")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundColor(isRecording ? .white : .dsTextSecondary)
                    .frame(maxWidth: .infinity)
                    .frame(height: 36)
                    .background(
                        Capsule().fill(isRecording
                                       ? AnyShapeStyle(LinearGradient.dsAccentGradient)
                                       : AnyShapeStyle(Color.dsCardHover))
                    )
                    .overlay(
                        Capsule().stroke(isRecording ? Color.clear : Color.dsBorder, lineWidth: 1)
                    )
                }
                .simultaneousGesture(
                    LongPressGesture(minimumDuration: 0.1)
                        .onEnded { _ in
                            Haptics.medium()
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
        .frame(minHeight: 52)
        .background(.ultraThinMaterial)
        .overlay(
            Rectangle()
                .frame(height: 0.5)
                .foregroundColor(Color.dsBorder),
            alignment: .top
        )
    }

    // MARK: - Actions

    private func sendMessage() {
        let text = inputText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        Haptics.light()
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
            DispatchQueue.main.async { self.performRecording() }
        }
    }

    private func performRecording() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else { return }

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }
        recognitionRequest.shouldReportPartialResults = true

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
            if error != nil { stopRecording() }
        }
    }

    private func stopRecordingAndSend() {
        stopRecording()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) {
            voicePreviewText = inputText
            inputText = ""
            if !voicePreviewText.isEmpty {
                showVoicePreview = true
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

// MARK: - Voice Preview Sheet

struct VoicePreviewSheet: View {
    @Binding var text: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 18) {
                // Grabber
                Capsule()
                    .fill(Color.dsBorder)
                    .frame(width: 36, height: 5)
                    .padding(.top, 8)

                HStack(spacing: 8) {
                    Image(systemName: "waveform")
                        .foregroundStyle(LinearGradient.dsAccentGradient)
                    Text("语音识别结果")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundColor(.dsTextPrimary)
                }

                TextEditor(text: $text)
                    .font(.system(size: 15))
                    .foregroundColor(.dsTextPrimary)
                    .scrollContentBackground(.hidden)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.dsCard)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Color.dsBorder, lineWidth: 1)
                    )
                    .frame(minHeight: 120)
                    .padding(.horizontal, 16)

                HStack(spacing: 12) {
                    Button(action: { Haptics.light(); onCancel() }) {
                        Text("取消")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.dsTextPrimary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color.dsCardHover)
                            )
                    }
                    .buttonStyle(DSPressableStyle())

                    Button(action: { Haptics.medium(); onConfirm() }) {
                        Text("发送")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 48)
                            .background(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(LinearGradient.dsAccentGradient)
                            )
                    }
                    .buttonStyle(DSPressableStyle())
                }
                .padding(.horizontal, 16)
                .padding(.bottom, 16)

                Spacer(minLength: 0)
            }
        }
    }
}
