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

    // Speech / Recording
    @State private var speechRecognizer: SFSpeechRecognizer?
    @State private var audioRecorder: AVAudioRecorder?
    @State private var recordingURL: URL?
    @State private var recordingDuration: TimeInterval = 0
    @State private var recordingTimer: Timer?
    @State private var audioLevel: CGFloat = 0
    @State private var dragOffsetY: CGFloat = 0
    @State private var willCancel = false
    @State private var isTranscribing = false

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

            // Voice recording overlay (WeChat style)
            if isRecording {
                voiceRecordingOverlay
                    .transition(.opacity)
                    .zIndex(100)
            }

            // Transcribing loading overlay
            if isTranscribing {
                ZStack {
                    Color.black.opacity(0.5).ignoresSafeArea()
                    VStack(spacing: 16) {
                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .dsAccentBlue))
                            .scaleEffect(1.5)
                        Text("识别中...")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white)
                    }
                    .padding(32)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color(red: 0.06, green: 0.08, blue: 0.14))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
                }
                .transition(.opacity)
                .zIndex(101)
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
            .presentationDetents([.large])
            .presentationDragIndicator(.hidden)
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

    // MARK: - Voice Recording Overlay (WeChat style)

    private var voiceRecordingOverlay: some View {
        ZStack {
            // Dim background
            Color.black.opacity(0.6)
                .ignoresSafeArea()
                .allowsHitTesting(false)

            VStack {
                Spacer()

                VStack(spacing: 20) {
                    // Mic icon with audio level pulse
                    ZStack {
                        // Outer pulse circles based on audio level
                        Circle()
                            .stroke(willCancel ? Color.dsError.opacity(0.3) : Color.dsAccentBlue.opacity(0.3), lineWidth: 2)
                            .frame(width: 100 + audioLevel * 60, height: 100 + audioLevel * 60)
                            .animation(.easeOut(duration: 0.15), value: audioLevel)
                        Circle()
                            .stroke(willCancel ? Color.dsError.opacity(0.5) : Color.dsAccentBlue.opacity(0.5), lineWidth: 2)
                            .frame(width: 80 + audioLevel * 30, height: 80 + audioLevel * 30)
                            .animation(.easeOut(duration: 0.15), value: audioLevel)

                        Circle()
                            .fill(willCancel
                                  ? AnyShapeStyle(Color.dsError)
                                  : AnyShapeStyle(LinearGradient.dsAccentGradient))
                            .frame(width: 80, height: 80)

                        Image(systemName: willCancel ? "xmark" : "mic.fill")
                            .font(.system(size: 32, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    // Duration
                    Text(formatDuration(recordingDuration))
                        .font(.system(size: 28, weight: .bold, design: .monospaced))
                        .foregroundColor(.white)

                    Text("正在录音...")
                        .font(.system(size: 14))
                        .foregroundColor(.white.opacity(0.6))

                    // Hint
                    Text(willCancel ? "松开手指，取消发送" : "上滑取消")
                        .font(.system(size: 12))
                        .foregroundColor(willCancel ? .dsError : .white.opacity(0.5))
                        .padding(.top, 8)
                }
                .padding(.vertical, 32)
                .padding(.horizontal, 32)
                .frame(maxWidth: .infinity)
                .background(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .fill(Color(red: 0.06, green: 0.08, blue: 0.14))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 24, style: .continuous)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
                .padding(.horizontal, 24)

                Spacer()
                Spacer()
            }
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds)
        let m = total / 60
        let s = total % 60
        let ms = Int((seconds - Double(total)) * 10)
        return String(format: "%02d:%02d.%d", m, s, ms)
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
                // Voice input — WeChat style hold-to-talk
                HStack(spacing: 8) {
                    Image(systemName: isRecording ? "waveform" : "mic.fill")
                        .font(.system(size: 13))
                    Text(isRecording ? (willCancel ? "松开取消" : "松开发送") : "按住说话")
                        .font(.system(size: 14, weight: .medium))
                }
                .foregroundColor(isRecording ? .white : .dsTextSecondary)
                .frame(maxWidth: .infinity)
                .frame(height: 36)
                .background(
                    Capsule().fill(isRecording
                                   ? (willCancel ? AnyShapeStyle(Color.dsError) : AnyShapeStyle(LinearGradient.dsAccentGradient))
                                   : AnyShapeStyle(Color.dsCardHover))
                )
                .overlay(
                    Capsule().stroke(isRecording ? Color.clear : Color.dsBorder, lineWidth: 1)
                )
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { value in
                            if !isRecording {
                                Haptics.medium()
                                startRecording()
                            }
                            // Slide up to cancel (50pt threshold)
                            let shouldCancel = value.translation.height < -50
                            if shouldCancel != willCancel {
                                Haptics.light()
                                willCancel = shouldCancel
                            }
                            dragOffsetY = value.translation.height
                        }
                        .onEnded { _ in
                            stopRecordingAndSend()
                            willCancel = false
                            dragOffsetY = 0
                        }
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

        SFSpeechRecognizer.requestAuthorization { _ in }

        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else { return }
            DispatchQueue.main.async { self.performRecording() }
        }
    }

    // MARK: - Recording (record-then-transcribe mode, like WeChat)

    private func performRecording() {
        // Reset state
        recordingDuration = 0
        audioLevel = 0

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.duckOthers, .defaultToSpeaker])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session failed: \(error)")
            return
        }

        // Create recording file
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).m4a")
        recordingURL = url

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue,
        ]

        do {
            let recorder = try AVAudioRecorder(url: url, settings: settings)
            recorder.isMeteringEnabled = true
            recorder.prepareToRecord()
            recorder.record()
            audioRecorder = recorder
            isRecording = true
            startRecordingTimer()
        } catch {
            print("AVAudioRecorder failed: \(error)")
        }
    }

    private func startRecordingTimer() {
        recordingTimer?.invalidate()
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            DispatchQueue.main.async {
                recordingDuration += 0.1
                // Update audio level
                audioRecorder?.updateMeters()
                if let power = audioRecorder?.averagePower(forChannel: 0) {
                    // power is in dB, range -160 to 0
                    let normalized = max(0, (power + 50) / 50)  // map -50..0 to 0..1
                    audioLevel = CGFloat(min(1.0, normalized))
                }
            }
        }
    }

    private func stopRecordingAndSend() {
        let cancelled = willCancel
        guard isRecording else { return }

        // Stop recording
        recordingTimer?.invalidate()
        recordingTimer = nil
        audioRecorder?.stop()
        let url = recordingURL
        let duration = recordingDuration
        audioRecorder = nil
        isRecording = false
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        if cancelled {
            // Delete file if cancelled
            if let url = url { try? FileManager.default.removeItem(at: url) }
            return
        }

        // Too short
        if duration < 0.5 {
            if let url = url { try? FileManager.default.removeItem(at: url) }
            return
        }

        // Transcribe the recorded file (no time limit, no interruptions)
        guard let url = url else { return }
        transcribeFile(url: url)
    }

    private func transcribeFile(url: URL) {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            try? FileManager.default.removeItem(at: url)
            return
        }

        isTranscribing = true

        let request = SFSpeechURLRecognitionRequest(url: url)
        request.shouldReportPartialResults = false
        if #available(iOS 16.0, *) {
            request.addsPunctuation = true
        }

        recognizer.recognitionTask(with: request) { result, error in
            if let result = result, result.isFinal {
                let text = result.bestTranscription.formattedString
                DispatchQueue.main.async {
                    isTranscribing = false
                    voicePreviewText = text
                    if !text.isEmpty {
                        showVoicePreview = true
                    }
                    try? FileManager.default.removeItem(at: url)
                }
            } else if error != nil {
                DispatchQueue.main.async {
                    isTranscribing = false
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
    }

    private func stopRecording() {
        guard isRecording else { return }
        recordingTimer?.invalidate()
        recordingTimer = nil
        audioRecorder?.stop()
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        audioRecorder = nil
        isRecording = false
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Voice Preview Sheet

struct VoicePreviewSheet: View {
    @Binding var text: String
    let onConfirm: () -> Void
    let onCancel: () -> Void

    @FocusState private var isFocused: Bool
    @State private var characterCount = 0

    var body: some View {
        ZStack {
            Color.dsBackground.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header
                HStack {
                    Button(action: { Haptics.light(); onCancel() }) {
                        Text("取消")
                            .font(.system(size: 16))
                            .foregroundColor(.dsTextSecondary)
                    }
                    Spacer()
                    HStack(spacing: 6) {
                        Image(systemName: "waveform")
                            .font(.system(size: 13))
                            .foregroundStyle(LinearGradient.dsAccentGradient)
                        Text("识别结果")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.dsTextPrimary)
                    }
                    Spacer()
                    Button(action: { Haptics.medium(); onConfirm() }) {
                        Text("发送")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .dsTextTertiary : .dsAccentBlue)
                    }
                    .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 16)
                .background(
                    Color.dsBackground
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(Color.dsBorder).frame(height: 0.5)
                        }
                )

                // Text editor — large, native, with autocorrect
                TextEditor(text: $text)
                    .focused($isFocused)
                    .font(.system(size: 19))
                    .lineSpacing(6)
                    .foregroundColor(.dsTextPrimary)
                    .scrollContentBackground(.hidden)
                    .background(Color.dsBackground)
                    .padding(.horizontal, 20)
                    .padding(.top, 16)
                    .autocorrectionDisabled(false)
                    .textInputAutocapitalization(.sentences)
                    .onChange(of: text) { newValue in
                        characterCount = newValue.count
                    }

                // Bottom toolbar
                HStack(spacing: 16) {
                    // Character count
                    Text("\(characterCount) 字")
                        .font(.system(size: 12))
                        .foregroundColor(.dsTextTertiary)

                    Spacer()

                    // Clear all
                    if !text.isEmpty {
                        Button(action: {
                            Haptics.light()
                            text = ""
                        }) {
                            HStack(spacing: 4) {
                                Image(systemName: "trash")
                                    .font(.system(size: 12))
                                Text("清空")
                                    .font(.system(size: 13))
                            }
                            .foregroundColor(.dsTextSecondary)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(Color.dsCardHover))
                        }
                    }
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(
                    Color.dsBackground
                        .overlay(alignment: .top) {
                            Rectangle().fill(Color.dsBorder).frame(height: 0.5)
                        }
                )
            }
        }
        .preferredColorScheme(.dark)
        .onAppear {
            characterCount = text.count
            // Auto-focus and place cursor at end
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                isFocused = true
            }
        }
    }
}
