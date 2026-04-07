import SwiftUI
import Speech
import AVFoundation

// Reference type holder so input tap closure can always access the current recognition request
final class SpeechHolder {
    var request: SFSpeechAudioBufferRecognitionRequest?
}

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
    @State private var liveTranscript = ""
    @State private var accumulatedTranscript = ""  // Finalized parts (across task restarts)
    @State private var recordingDuration: TimeInterval = 0
    @State private var recordingTimer: Timer?
    @State private var audioLevel: CGFloat = 0
    @State private var dragOffsetY: CGFloat = 0
    @State private var willCancel = false
    @State private var lastRecognitionUpdate = Date()
    @State private var speechHolder = SpeechHolder()

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

                    // Live transcript preview
                    if !liveTranscript.isEmpty {
                        ScrollView {
                            Text(liveTranscript)
                                .font(.system(size: 14))
                                .foregroundColor(.white.opacity(0.9))
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 24)
                        }
                        .frame(maxHeight: 120)
                    } else {
                        Text("正在聆听...")
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.6))
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

        // Reset state
        liveTranscript = ""
        accumulatedTranscript = ""
        recordingDuration = 0
        audioLevel = 0
        lastRecognitionUpdate = Date()

        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .defaultToSpeaker])
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("Audio session setup failed: \(error)")
            return
        }

        // Reset audio engine
        if audioEngine.isRunning {
            audioEngine.stop()
            audioEngine.inputNode.removeTap(onBus: 0)
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        guard recordingFormat.sampleRate > 0 && recordingFormat.channelCount > 0 else {
            print("Invalid audio format: \(recordingFormat)")
            return
        }

        // IMPORTANT: tap closure references speechHolder (reference type),
        // so it always appends to the current request, even after task restarts
        let holder = speechHolder
        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { buffer, _ in
            holder.request?.append(buffer)
            // Compute audio level for visualization
            guard let channelData = buffer.floatChannelData?[0] else { return }
            let frameLength = Int(buffer.frameLength)
            var sum: Float = 0
            for i in 0..<frameLength {
                sum += abs(channelData[i])
            }
            let avg = sum / Float(frameLength)
            DispatchQueue.main.async {
                audioLevel = CGFloat(min(1.0, avg * 20))
            }
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
            isRecording = true
            startRecordingTimer()
        } catch {
            print("Audio engine failed to start: \(error)")
            return
        }

        // Start the first recognition task
        startNewRecognitionTask()
    }

    private func startNewRecognitionTask() {
        guard let speechRecognizer = speechRecognizer else { return }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        if speechRecognizer.supportsOnDeviceRecognition {
            request.requiresOnDeviceRecognition = true
        }
        if #available(iOS 16.0, *) {
            request.addsPunctuation = true
        }
        recognitionRequest = request
        speechHolder.request = request

        recognitionTask = speechRecognizer.recognitionTask(with: request) { result, error in
            if let result = result {
                let text = result.bestTranscription.formattedString
                DispatchQueue.main.async {
                    // Live transcript = accumulated + current partial
                    if accumulatedTranscript.isEmpty {
                        liveTranscript = text
                    } else {
                        liveTranscript = accumulatedTranscript + (text.isEmpty ? "" : " " + text)
                    }
                    lastRecognitionUpdate = Date()

                    if result.isFinal {
                        // Accumulate this segment and start a new task
                        if !text.isEmpty {
                            if accumulatedTranscript.isEmpty {
                                accumulatedTranscript = text
                            } else {
                                accumulatedTranscript += " " + text
                            }
                            liveTranscript = accumulatedTranscript
                        }
                        // Restart task to keep listening
                        if isRecording {
                            startNewRecognitionTask()
                        }
                    }
                }
            }
            if let error = error as NSError? {
                let code = error.code
                // 1110 = no speech, 1101 = unavailable — these are fatal
                // 203 = retry, others are recoverable, restart task
                if code == 1101 {
                    DispatchQueue.main.async { stopRecording() }
                } else if code != 0 {
                    // Recoverable error — restart task if still recording
                    DispatchQueue.main.async {
                        if isRecording {
                            startNewRecognitionTask()
                        }
                    }
                }
            }
        }
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
        // Capture current transcript before stopping (use liveTranscript which includes accumulated + current partial)
        let finalText = liveTranscript
        stopRecording()
        if cancelled { return }
        // Show preview with the captured text
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
            voicePreviewText = finalText
            liveTranscript = ""
            accumulatedTranscript = ""
            if !voicePreviewText.isEmpty {
                showVoicePreview = true
            }
        }
    }

    private func stopRecording() {
        guard isRecording else { return }
        // Set isRecording=false FIRST to prevent task auto-restart in callback
        isRecording = false
        recordingTimer?.invalidate()
        recordingTimer = nil
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        speechHolder.request = nil
        recognitionRequest?.endAudio()
        // IMPORTANT: use finish() instead of cancel() — cancel discards results!
        recognitionTask?.finish()
        recognitionRequest = nil
        recognitionTask = nil
        audioLevel = 0
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
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
