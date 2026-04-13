import SwiftUI
import Speech
import AVFoundation

// Reference holder so the audio tap closure (real-time audio thread) can
// always access the current recognition request after restarts
final class StreamingHolder {
    var request: SFSpeechAudioBufferRecognitionRequest?
    var hadFatalError: Bool = false
}

struct SessionView: View {
    let sessionId: String
    @EnvironmentObject var viewModel: AppViewModel

    @State private var inputText = ""
    @State private var inputMode: InputMode = {
        UserDefaults.standard.string(forKey: "lastInputMode") == "voice" ? .voice : .keyboard
    }()
    @State private var voicePreviewText = ""
    @State private var voicePreviewFocused: Bool = false
    @State private var isRecording = false
    @State private var showQuickKeys = true
    @FocusState private var inputFocused: Bool

    // Speech / Recording (hybrid: live streaming + file backup)
    @State private var speechRecognizer: SFSpeechRecognizer?
    @State private var audioEngine: AVAudioEngine?
    @State private var audioFile: AVAudioFile?
    @State private var recognitionTask: SFSpeechRecognitionTask?
    @State private var streamingHolder = StreamingHolder()
    @State private var accumulatedText: String = ""    // 已经"定稿"的部分（跨多个识别 task 累加）
    @State private var partialText: String = ""        // 当前识别 task 的中间结果
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

            // Voice preview overlay (居中气泡 + 轻遮罩)
            if !voicePreviewText.isEmpty {
                // 轻遮罩 — 让终端退到后面，气泡突出
                Color.black.opacity(0.25)
                    .ignoresSafeArea()
                    .onTapGesture { voicePreviewFocused = false }
                    .zIndex(98)

                voicePreviewPane
                    .transition(.scale(scale: 0.95).combined(with: .opacity))
                    .zIndex(99)
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
        .onAppear {
            // 进入会话后禁用自动锁屏，避免看 Claude 输出时屏幕息屏
            UIApplication.shared.isIdleTimerDisabled = true
        }
        .onDisappear {
            viewModel.webSocketService.removeOutputListeners(sessionId: sessionId)
            stopRecording()
            // 离开会话恢复系统默认息屏行为，省电
            UIApplication.shared.isIdleTimerDisabled = false
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

                    // Live transcription
                    let liveText = (accumulatedText + (accumulatedText.isEmpty ? "" : " ") + partialText)
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                    if liveText.isEmpty {
                        Text("正在录音...")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.6))
                    } else {
                        ScrollView {
                            Text(liveText)
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .lineSpacing(4)
                                .multilineTextAlignment(.center)
                                .frame(maxWidth: .infinity)
                        }
                        .frame(maxHeight: 120)
                    }

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

    // MARK: - Floating Quick Keys (single row)

    private var floatingQuickKeys: some View {
        HStack(spacing: 6) {
            quickKey(symbol: "arrow.up") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[A")
            }
            quickKey(symbol: "arrow.down") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}[B")
            }
            quickKey(symbol: "escape") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\u{1b}")
            }
            quickKey(symbol: "return") {
                viewModel.webSocketService.sendRawInput(sessionId: sessionId, data: "\r")
            }
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.black.opacity(0.25))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(Color.white.opacity(0.06), lineWidth: 0.5)
        )
    }

    private func quickKey(symbol: String, action: @escaping () -> Void) -> some View {
        Button {
            Haptics.medium()
            action()
        } label: {
            Image(systemName: symbol)
                .font(.system(size: 15, weight: .medium))
                .foregroundColor(.dsTextPrimary.opacity(0.7))
                .frame(width: 38, height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.dsCardHover.opacity(0.35))
                )
        }
        .buttonStyle(DSPressableStyle(scale: 0.9))
    }

    // MARK: - Voice Preview Pane (微信风格：气泡 + 底部大按钮)

    private var voicePreviewPane: some View {
        ZStack {
            // 半透明遮罩
            Color.black.opacity(0.4)
                .ignoresSafeArea()
                .onTapGesture { voicePreviewFocused = false }

            ZStack {
                // 气泡居中
                VStack(spacing: 0) {
                    VStack(spacing: 0) {
                        TextEditorWithFocus(
                            text: $voicePreviewText,
                            isFocused: $voicePreviewFocused
                        )
                        .padding(.horizontal, 18)
                        .padding(.vertical, 16)
                    }
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(Color(red: 0.22, green: 0.28, blue: 0.50))
                    )
                    .padding(.horizontal, 32)

                    // 气泡尾巴
                    Triangle()
                        .fill(Color(red: 0.22, green: 0.28, blue: 0.50))
                        .frame(width: 14, height: 7)
                }

                // 底部大按钮（固定在底部）
                VStack {
                    Spacer()
                    HStack(spacing: 0) {
                    // 取消
                    Button {
                        Haptics.light()
                        voicePreviewText = ""
                        voicePreviewFocused = false
                    } label: {
                        VStack(spacing: 6) {
                            Image(systemName: "xmark")
                                .font(.system(size: 22, weight: .medium))
                                .foregroundColor(.white)
                                .frame(width: 56, height: 56)
                                .background(Circle().fill(Color.white.opacity(0.15)))
                            Text("取消")
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.6))
                        }
                    }
                    .buttonStyle(DSPressableStyle())

                    Spacer()

                    // 发送
                    Button {
                        Haptics.medium()
                        let text = voicePreviewText.trimmingCharacters(in: .whitespacesAndNewlines)
                        guard !text.isEmpty else { return }
                        viewModel.webSocketService.sendInput(sessionId: sessionId, text: text)
                        voicePreviewText = ""; voicePreviewFocused = false
                    } label: {
                        VStack(spacing: 6) {
                            Text("发送")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(width: 100, height: 56)
                                .background(
                                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                                        .fill(
                                            voicePreviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                            ? AnyShapeStyle(Color.white.opacity(0.15))
                                            : AnyShapeStyle(LinearGradient.dsAccentGradient)
                                        )
                                )
                            Text("\(voicePreviewText.count) 字")
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.4))
                        }
                    }
                    .buttonStyle(DSPressableStyle())
                    .disabled(voicePreviewText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
                .padding(.horizontal, 50)
                .padding(.bottom, 40)
                }
            }
        }
    }

    // MARK: - Input Bar

    private var inputBar: some View {
        HStack(spacing: 10) {
            // Mode toggle
            Button {
                Haptics.light()
                inputMode = inputMode == .keyboard ? .voice : .keyboard
                UserDefaults.standard.set(inputMode == .voice ? "voice" : "keyboard", forKey: "lastInputMode")
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

    // MARK: - Speech Recognition (混合方案：流式实时识别 + 文件兜底)

    private func startRecording() {
        guard !isRecording else { return }
        SFSpeechRecognizer.requestAuthorization { _ in }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
            guard granted else { return }
            DispatchQueue.main.async { self.performRecording() }
        }
    }

    private func performRecording() {
        // Reset state
        accumulatedText = ""
        partialText = ""
        recordingDuration = 0
        audioLevel = 0
        streamingHolder = StreamingHolder()

        // Audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session failed: \(error)")
            return
        }

        // Speech recognizer
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))

        // Create file (CAF — supports any AVAudioEngine native format without re-encode)
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice-\(UUID().uuidString).caf")
        recordingURL = url

        // Audio engine
        let engine = AVAudioEngine()
        let inputNode = engine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        // File for backup recording — share format with engine
        do {
            audioFile = try AVAudioFile(forWriting: url, settings: format.settings)
        } catch {
            print("AVAudioFile failed: \(error)")
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            return
        }

        // Install tap — single audio source, two consumers
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) { buffer, _ in
            // Consumer 1: streaming recognizer (whatever request is current)
            self.streamingHolder.request?.append(buffer)
            // Consumer 2: write to file (backup)
            try? self.audioFile?.write(from: buffer)
            // Audio level for UI
            let level = Self.bufferLevel(buffer)
            DispatchQueue.main.async { self.audioLevel = level }
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            print("Engine start failed: \(error)")
            inputNode.removeTap(onBus: 0)
            audioFile = nil
            try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            return
        }
        audioEngine = engine

        // Kick off first recognition task
        startRecognitionTask()

        isRecording = true
        startRecordingTimer()
    }

    private func startRecognitionTask() {
        guard let recognizer = speechRecognizer, recognizer.isAvailable else {
            streamingHolder.hadFatalError = true
            return
        }

        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if #available(iOS 16.0, *) {
            req.addsPunctuation = true
        }
        // Atomically swap — tap will start writing to this from now on
        streamingHolder.request = req

        recognitionTask = recognizer.recognitionTask(with: req) { result, error in
            if let result = result {
                let text = result.bestTranscription.formattedString
                DispatchQueue.main.async {
                    self.partialText = text
                }
                if result.isFinal {
                    // Task ended (60s timeout, endAudio, or session interrupt) → fold partial
                    // into accumulated and start a fresh task so audio keeps flowing
                    DispatchQueue.main.async {
                        if !text.isEmpty {
                            if self.accumulatedText.isEmpty {
                                self.accumulatedText = text
                            } else {
                                self.accumulatedText += " " + text
                            }
                        }
                        self.partialText = ""
                        if self.isRecording {
                            self.startRecognitionTask()
                        }
                    }
                }
            } else if let err = error as NSError? {
                // 1110 = no speech detected → not fatal, just restart
                // Other errors → mark fatal so we fall back to file recognition
                let isNoSpeech = err.code == 1110 || err.code == 203
                DispatchQueue.main.async {
                    let savedPartial = self.partialText
                    if !savedPartial.isEmpty {
                        if self.accumulatedText.isEmpty {
                            self.accumulatedText = savedPartial
                        } else {
                            self.accumulatedText += " " + savedPartial
                        }
                    }
                    self.partialText = ""
                    if isNoSpeech && self.isRecording {
                        self.startRecognitionTask()
                    } else if !isNoSpeech {
                        self.streamingHolder.hadFatalError = true
                    }
                }
            }
        }
    }

    private static func bufferLevel(_ buffer: AVAudioPCMBuffer) -> CGFloat {
        guard let channelData = buffer.floatChannelData else { return 0 }
        let frameLength = Int(buffer.frameLength)
        guard frameLength > 0 else { return 0 }
        let samples = channelData.pointee
        var sum: Float = 0
        for i in 0..<frameLength {
            sum += samples[i] * samples[i]
        }
        let rms = sqrt(sum / Float(frameLength))
        let db = 20 * log10(max(rms, 0.000001))
        let normalized = max(0, (db + 50) / 50)  // map -50..0 to 0..1
        return CGFloat(min(1.0, normalized))
    }

    private func startRecordingTimer() {
        recordingTimer?.invalidate()
        recordingTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { _ in
            DispatchQueue.main.async {
                recordingDuration += 0.1
            }
        }
    }

    private func stopRecordingAndSend() {
        let cancelled = willCancel
        guard isRecording else { return }

        // Tear down audio engine + tap
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        // End the streaming request so the recognition task delivers its final result
        streamingHolder.request?.endAudio()
        streamingHolder.request = nil
        // Close file
        audioFile = nil

        recordingTimer?.invalidate()
        recordingTimer = nil

        let url = recordingURL
        let duration = recordingDuration
        let hadFatal = streamingHolder.hadFatalError

        isRecording = false
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)

        if cancelled {
            recognitionTask?.cancel()
            recognitionTask = nil
            if let url = url { try? FileManager.default.removeItem(at: url) }
            accumulatedText = ""
            partialText = ""
            return
        }

        if duration < 0.5 {
            recognitionTask?.cancel()
            recognitionTask = nil
            if let url = url { try? FileManager.default.removeItem(at: url) }
            accumulatedText = ""
            partialText = ""
            return
        }

        // Wait briefly for the streaming task to deliver its final isFinal result
        // (triggered by endAudio above), then decide whether to use streaming or file
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            recognitionTask = nil
            let streamed = (accumulatedText + (accumulatedText.isEmpty ? "" : " ") + partialText)
                .trimmingCharacters(in: .whitespacesAndNewlines)

            if !hadFatal && !streamed.isEmpty {
                // 流式识别成功 → 直接用，秒出预览
                voicePreviewText = streamed
                accumulatedText = ""
                partialText = ""
                if let url = url { try? FileManager.default.removeItem(at: url) }
            } else if let url = url {
                // 流式失败或没结果 → 用录到的文件再识别一次
                accumulatedText = ""
                partialText = ""
                transcribeFile(url: url)
            } else {
                accumulatedText = ""
                partialText = ""
            }
        }
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
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        streamingHolder.request?.endAudio()
        streamingHolder.request = nil
        audioFile = nil
        recognitionTask?.cancel()
        recognitionTask = nil
        recordingTimer?.invalidate()
        recordingTimer = nil
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        accumulatedText = ""
        partialText = ""
        isRecording = false
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Triangle shape (气泡尾巴)

struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        Path { p in
            p.move(to: CGPoint(x: rect.midX - rect.width / 2, y: 0))
            p.addLine(to: CGPoint(x: rect.midX, y: rect.height))
            p.addLine(to: CGPoint(x: rect.midX + rect.width / 2, y: 0))
            p.closeSubpath()
        }
    }
}

// MARK: - TextEditor with externally observable focus

struct TextEditorWithFocus: View {
    @Binding var text: String
    @Binding var isFocused: Bool
    @FocusState private var focused: Bool

    var body: some View {
        TextField("", text: $text, axis: .vertical)
            .focused($focused)
            .font(.system(size: 19))
            .lineSpacing(6)
            .foregroundColor(.white)
            .tint(.white)
            .autocorrectionDisabled(false)
            .textInputAutocapitalization(.sentences)
            .lineLimit(1...12)
            .onChange(of: focused) { newValue in
                if isFocused != newValue { isFocused = newValue }
            }
            .onChange(of: isFocused) { newValue in
                if focused != newValue { focused = newValue }
            }
    }
}
