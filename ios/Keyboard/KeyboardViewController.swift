import Combine
import KeyboardKit
import PastaCore
import SwiftUI
import UIKit

@MainActor
final class KeyboardViewController: KeyboardInputViewController {
    private var clips: [PastaKeyboardClip] = []
    private var secrets: [PastaKeyboardSecret] = []
    private var secretPrompt: PastaSecretPrompt?
    private var secretPromptProxy: PastaSecretPromptProxy?
    private var textInputRoutingObserver: AnyCancellable?
    private var hasAutoRefreshedHistory = false
    private var isRunningLiveAction = false
    private var statusMessage: String?
    private var hasSetupPastaKeyboardView = false
    private let toolbarModel = PastaKeyboardToolbarModel()
    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store = try? PastaAppGroupStore()
    private let autocompleteService = PastaAutocompleteService()
    private var autocompleteTask: Task<Void, Never>?
    private var autocompleteGeneration = 0
    private var lastPastaAutocompleteText = ""

    deinit {
        autocompleteTask?.cancel()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        deferKeyboardSurfaceToHost()
        enableExperimentalKeyboardTypeChangeTracking()
        reloadClips()
        setup(for: .pasta) { [weak self] _ in
            guard let self else { return }
            services.autocompleteService = autocompleteService
            if state.autocompleteContext.suggestionsFromService.isEmpty {
                state.autocompleteContext.suggestionsFromService = PastaAutocompleteService.idleSuggestions
            }
            services.keyboardBehavior = PastaKeyboardBehavior(
                keyboardContext: state.keyboardContext,
                repeatGestureTimer: services.repeatGestureTimer
            )
            observeTextInputRouting()
            setupPastaKeyboardView()
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        deferKeyboardSurfaceToHost()
        reloadClips()
        refreshToolbarModel()
        if !hasSetupPastaKeyboardView {
            setupPastaKeyboardView()
        }
        autoRefreshHistoryIfPossible()
    }

    override func viewWillSetupKeyboardView() {
        setupPastaKeyboardView()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        deferKeyboardSurfaceToHost()
    }

    /// Keeps passkey characters out of autocomplete, learned words, and the
    /// suggestion band while the Pasta secret prompt owns text input.
    override var isAutocompleteEnabled: Bool {
        secretPrompt == nil && super.isAutocompleteEnabled
    }

    override func performAutocomplete() {
        guard isAutocompleteEnabled else {
            cancelPendingAutocomplete()
            return
        }

        autocompleteGeneration += 1
        let generation = autocompleteGeneration
        autocompleteTask?.cancel()
        autocompleteTask = Task { @MainActor [weak self] in
            let delay = PastaKeyboardAutocompletePolicy.standard.debounceMilliseconds
            do {
                try await Task.sleep(nanoseconds: UInt64(delay) * 1_000_000)
            } catch {
                return
            }

            guard let self else { return }
            guard !Task.isCancelled else { return }
            guard generation == self.autocompleteGeneration else { return }
            guard self.isAutocompleteEnabled else { return }

            let text = self.autocompleteText ?? ""
            guard text != self.lastPastaAutocompleteText else { return }
            self.lastPastaAutocompleteText = text
            self.services.autocompleteService.autocomplete(
                text,
                updating: self.state.autocompleteContext
            )
        }
    }

    override func resetAutocomplete() {
        cancelPendingAutocomplete()
        lastPastaAutocompleteText = ""
        super.resetAutocomplete()
    }

    private func deferKeyboardSurfaceToHost() {
        view.isOpaque = false
        view.backgroundColor = .clear
        inputView?.isOpaque = false
        inputView?.backgroundColor = .clear
        children.forEach { child in
            child.view.isOpaque = false
            child.view.backgroundColor = .clear
        }
    }

    private func cancelPendingAutocomplete() {
        autocompleteGeneration += 1
        autocompleteTask?.cancel()
        autocompleteTask = nil
    }

    private func reloadClips() {
        clips = store?.loadKeyboardClips() ?? []
        secrets = store?.loadKeyboardSecrets() ?? []
        refreshToolbarModel()
    }

    private func refreshToolbarModel() {
        toolbarModel.update(
            clips: clips,
            secrets: secrets,
            secretPrompt: secretPrompt,
            statusMessage: statusMessage,
            isRunningLiveAction: isRunningLiveAction
        )
    }

    private func setupPastaKeyboardView() {
        hasSetupPastaKeyboardView = true
        refreshToolbarModel()
        let model = toolbarModel
        setupKeyboardView { [weak self] controller in
            PastaKeyboardView(
                services: controller.services,
                state: controller.state,
                toolbarModel: model,
                insertClip: { [weak self] text in self?.insertIntoHostDocument(text) },
                publish: { [weak self] in self?.publishClipboardText() },
                unlockSecret: { [weak self] secret in self?.beginSecretPrompt(.unlock(clipId: secret.clipId, key: secret.key)) },
                setSecret: { [weak self] in self?.beginSecretPrompt(.setFromClipboard) },
                submitSecretPrompt: { [weak self] in self?.submitSecretPrompt() },
                cancelSecretPrompt: { [weak self] in self?.cancelSecretPrompt() }
            )
        }
        deferKeyboardSurfaceToHost()
    }

    private func autoRefreshHistoryIfPossible() {
        guard !hasAutoRefreshedHistory else { return }
        guard !isRunningLiveAction else { return }
        guard hasFullAccess else { return }
        guard store?.loadConfiguration() != nil else { return }
        hasAutoRefreshedHistory = true
        refreshHistoryFromNetwork(reportsStatus: false)
    }

    private func refreshHistoryFromNetwork(reportsStatus: Bool = true) {
        Task {
            await runLiveAction(
                started: reportsStatus ? "Refreshing Pasta history..." : nil,
                reportsStatus: reportsStatus
            ) {
                let live = try liveContext()
                let entries = try await client.historyEntries(
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                let refreshed = PastaHistoryEntry.keyboardClips(from: entries)
                let refreshedSecrets = PastaHistoryEntry.keyboardSecrets(from: entries)
                secrets = refreshedSecrets
                clips = refreshed
                try store?.saveKeyboardClips(refreshed)
                try store?.saveKeyboardSecrets(refreshedSecrets)
                if reportsStatus {
                    statusMessage = refreshed.isEmpty && secrets.isEmpty
                        ? "No Pasta history yet."
                        : "Synced \(refreshed.count) text and \(secrets.count) secret clips."
                }
                refreshToolbarModel()
            }
        }
    }

    private func publishClipboardText() {
        Task {
            await runLiveAction(started: "Publishing clipboard...") {
                let live = try liveContext()
                guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    statusMessage = "Clipboard has no text."
                    return
                }
                let clip = try await client.publishText(
                    text,
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                let cached = PastaKeyboardClip(
                    clipId: clip.clipId,
                    sequence: clip.seq,
                    title: text.singleLineTitle,
                    text: text,
                    createdAt: clip.createdAt
                )
                clips = [cached] + clips.filter { $0.clipId != clip.clipId }
                try store?.saveKeyboardClips(clips)
                statusMessage = "Published clipboard to Pasta."
                refreshToolbarModel()
            }
        }
    }

    /// Opens the in-keyboard prompt and routes the keys into it.
    ///
    /// Keyboard extensions may not present `UIAlertController` and may not draw
    /// outside their primary view, so the prompt lives in Pasta's toolbar band
    /// and reads the user's key presses through `textInputProxy`.
    private func beginSecretPrompt(_ intent: PastaSecretPromptIntent) {
        guard !isRunningLiveAction else { return }
        guard hasFullAccess else {
            statusMessage = "Allow Full Access to use Pasta secrets."
            refreshToolbarModel()
            return
        }
        guard store?.loadConfiguration() != nil else {
            statusMessage = "Pair this device in Pasta."
            refreshToolbarModel()
            return
        }
        secretPrompt = PastaSecretPrompt(intent: intent)
        statusMessage = nil
        routeTextInputToSecretPrompt()
        refreshToolbarModel()
    }

    private func routeTextInputToSecretPrompt() {
        let proxy = PastaSecretPromptProxy(
            insertText: { [weak self] text in self?.handleSecretPromptInsert(text) },
            deleteBackward: { [weak self] in self?.handleSecretPromptDeleteBackward() },
            hasText: { [weak self] in self?.promptOrHostHasText() ?? false }
        )
        secretPromptProxy = proxy
        state.keyboardContext.textInputProxy = proxy
        resetAutocomplete()
    }

    /// KeyboardKit's keyboard-switch button detaches `textInputProxy` while the
    /// switcher is open and reattaches it half a second later. Without this,
    /// key presses in that window would reach the host document while the prompt
    /// is still on screen, and a prompt cancelled during it would come back as a
    /// reattached proxy that swallows all typing.
    private func observeTextInputRouting() {
        textInputRoutingObserver = state.keyboardContext.$textInputProxy
            .receive(on: DispatchQueue.main)
            .sink { [weak self] proxy in
                self?.handleTextInputProxyChange(proxy)
            }
    }

    private func handleTextInputProxyChange(_ proxy: UITextDocumentProxy?) {
        guard proxy != nil else {
            cancelSecretPrompt()
            return
        }
        guard secretPrompt == nil, proxy === secretPromptProxy else { return }
        state.keyboardContext.textInputProxy = nil
        secretPromptProxy = nil
    }

    private func endSecretPrompt() {
        secretPrompt = nil
        secretPromptProxy = nil
        state.keyboardContext.textInputProxy = nil
        resetAutocomplete()
        refreshToolbarModel()
    }

    private func cancelSecretPrompt() {
        guard secretPrompt != nil else { return }
        statusMessage = nil
        endSecretPrompt()
    }

    private func handleSecretPromptInsert(_ text: String) {
        // A reattached proxy must never swallow key presses: with no prompt
        // collecting input, the host document owns them.
        guard var prompt = secretPrompt else {
            insertIntoHostDocument(text)
            return
        }
        let result = prompt.insert(text)
        secretPrompt = prompt
        refreshToolbarModel()
        if result == .submitRequested {
            submitSecretPrompt()
        }
    }

    private func handleSecretPromptDeleteBackward() {
        guard var prompt = secretPrompt else {
            state.keyboardContext.originalTextDocumentProxy.deleteBackward()
            return
        }
        prompt.deleteBackward()
        secretPrompt = prompt
        refreshToolbarModel()
    }

    private func promptOrHostHasText() -> Bool {
        if let secretPrompt {
            return !secretPrompt.isCurrentFieldEmpty
        }
        return state.keyboardContext.originalTextDocumentProxy.hasText
    }

    private func submitSecretPrompt() {
        guard var prompt = secretPrompt else { return }
        do {
            let advance = try prompt.advance()
            switch advance {
            case .awaitingPasskey:
                secretPrompt = prompt
                refreshToolbarModel()
            case .ready(let submission):
                endSecretPrompt()
                perform(submission)
            }
        } catch let error as PastaSecretPromptError {
            statusMessage = error.message
            refreshToolbarModel()
        } catch {
            statusMessage = "Secret prompt failed. Try again."
            refreshToolbarModel()
        }
    }

    private func perform(_ submission: PastaSecretPromptSubmission) {
        switch submission.intent {
        case .setFromClipboard:
            setSecretFromClipboard(key: submission.keyPath, passkey: submission.passkey)
        case .unlock(let clipId, let key):
            unlockSecret(clipId: clipId, key: key, passkey: submission.passkey)
        }
    }

    private func unlockSecret(clipId: String, key: String, passkey: String) {
        Task {
            await runLiveAction(started: "Unlocking secret...") {
                let live = try liveContext()
                let value = try await client.unlockSecret(
                    clipId: clipId,
                    passkey: passkey,
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                insertIntoHostDocument(value)
                statusMessage = "Inserted secret \(key)."
            }
        }
    }

    private func setSecretFromClipboard(key: String, passkey: String) {
        Task {
            await runLiveAction(started: "Publishing secret...") {
                let live = try liveContext()
                guard let text = UIPasteboard.general.string, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    statusMessage = "Clipboard has no text."
                    return
                }
                let clip = try await client.publishSecret(
                    key: key,
                    passkey: passkey,
                    value: text,
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                let cached = PastaKeyboardSecret(
                    clipId: clip.clipId,
                    sequence: clip.seq,
                    key: key,
                    createdAt: clip.createdAt
                )
                secrets = [cached] + secrets.filter { $0.key != cached.key }
                try? store?.saveKeyboardSecrets(secrets)
                statusMessage = "Published secret \(cached.key)."
                refreshToolbarModel()
            }
        }
    }

    /// Always targets the host document, never a live Pasta prompt proxy.
    private func insertIntoHostDocument(_ text: String) {
        state.keyboardContext.originalTextDocumentProxy.insertText(text)
    }

    private func runLiveAction(
        started: String?,
        reportsStatus: Bool = true,
        operation: () async throws -> Void
    ) async {
        guard !isRunningLiveAction else { return }
        isRunningLiveAction = true
        if let started {
            statusMessage = started
        }
        refreshToolbarModel()
        defer {
            isRunningLiveAction = false
            refreshToolbarModel()
        }
        do {
            try await operation()
        } catch PastaKeyboardError.fullAccessRequired {
            if reportsStatus { statusMessage = "Allow Full Access to sync Pasta history." }
            refreshToolbarModel()
        } catch PastaKeyboardError.notPaired {
            if reportsStatus { statusMessage = "Pair this device in Pasta." }
            refreshToolbarModel()
        } catch URLError.notConnectedToInternet {
            if reportsStatus { statusMessage = "Network unavailable. Cached clips still work." }
            refreshToolbarModel()
        } catch URLError.timedOut {
            if reportsStatus { statusMessage = "Pasta sync timed out. Try again." }
            refreshToolbarModel()
        } catch {
            if reportsStatus { statusMessage = "Pasta sync failed. Reopen Pasta if this persists." }
            refreshToolbarModel()
        }
    }

    private func liveContext() throws -> LivePastaContext {
        guard hasFullAccess else { throw PastaKeyboardError.fullAccessRequired }
        guard let configuration = store?.loadConfiguration() else { throw PastaKeyboardError.notPaired }
        return LivePastaContext(
            configuration: configuration,
            groupKey: try keychain.get(.groupKey),
            signingPrivateKey: try keychain.get(.signingPrivateKey)
        )
    }
}

/// Receives key presses while the Pasta secret prompt is open.
///
/// KeyboardKit resolves every insert and delete through
/// `KeyboardContext.textDocumentProxy`, which prefers `textInputProxy` when one
/// is set. Routing through a proxy keeps the native keys and gestures intact and
/// avoids a `UITextField` in the extension, which would break the responder
/// chain and invalidate the host text document proxy.
private final class PastaSecretPromptProxy: NSObject, UITextDocumentProxy {
    private let onInsertText: (String) -> Void
    private let onDeleteBackward: () -> Void
    private let hasTextProvider: () -> Bool
    private let identifier = UUID()

    init(
        insertText: @escaping (String) -> Void,
        deleteBackward: @escaping () -> Void,
        hasText: @escaping () -> Bool
    ) {
        onInsertText = insertText
        onDeleteBackward = deleteBackward
        hasTextProvider = hasText
        super.init()
    }

    var documentContextBeforeInput: String? { nil }
    var documentContextAfterInput: String? { nil }
    var selectedText: String? { nil }
    var documentInputMode: UITextInputMode? { nil }
    var documentIdentifier: UUID { identifier }

    var hasText: Bool { hasTextProvider() }

    var autocapitalizationType: UITextAutocapitalizationType = .none
    var autocorrectionType: UITextAutocorrectionType = .no
    var spellCheckingType: UITextSpellCheckingType = .no
    var keyboardType: UIKeyboardType = .asciiCapable
    var returnKeyType: UIReturnKeyType = .done
    var isSecureTextEntry = true

    func insertText(_ text: String) {
        onInsertText(text)
    }

    func deleteBackward() {
        onDeleteBackward()
    }

    func adjustTextPosition(byCharacterOffset offset: Int) {}
    func setMarkedText(_ markedText: String, selectedRange: NSRange) {}
    func unmarkText() {}
}

private struct PastaKeyboardView: View {
    let services: Keyboard.Services
    let state: Keyboard.State
    @ObservedObject var toolbarModel: PastaKeyboardToolbarModel
    let insertClip: (String) -> Void
    let publish: () -> Void
    let unlockSecret: (PastaKeyboardSecret) -> Void
    let setSecret: () -> Void
    let submitSecretPrompt: () -> Void
    let cancelSecretPrompt: () -> Void

    @EnvironmentObject private var keyboardContext: KeyboardContext
    @StateObject private var layoutCache = PastaKeyboardLayoutCache()
    @StateObject private var touchFeedbackCoordinator = PastaTouchFeedbackCoordinator()

    var body: some View {
        // Pasta is additive: KeyboardKit owns the keyboard, autocomplete band,
        // sizing, and input handling. Pasta only adds compact side actions around
        // KeyboardKit's standard autocomplete toolbar.
        KeyboardView(
            layout: pastaLayout,
            state: state,
            services: services,
            buttonContent: { $0.view },
            buttonView: { params in
                PastaImmediateKeyPressFeedback(
                    item: params.item,
                    coordinator: touchFeedbackCoordinator
                ) {
                    params.view
                }
            },
            collapsedView: { $0.view },
            emojiKeyboard: { $0.view },
            toolbar: { params in
                PastaKeyboardToolbar(
                    model: toolbarModel,
                    autocompleteToolbar: params.view,
                    insertClip: insertClip,
                    publish: publish,
                    unlockSecret: unlockSecret,
                    setSecret: setSecret,
                    submitSecretPrompt: submitSecretPrompt,
                    cancelSecretPrompt: cancelSecretPrompt
                )
            }
        )
        .autocompleteToolbarStyle(PastaToolbarAppearance.autocompleteToolbarStyle)
        .keyboardButtonStyle { params in
            var style = params.standardStyle(for: keyboardContext)
            guard params.action.isShiftAction else { return style }

            let tokens = PastaKeyboardShiftAppearance.styleTokens(
                isActive: keyboardContext.keyboardCase.isPastaUppercaseState,
                interfaceStyle: keyboardContext.hasDarkColorScheme ? .dark : .light
            )
            style.applyPastaKeyboardTokens(tokens)
            return style
        }
        .keyboardInputToolbarDisplayMode(.none)
        .id(keyboardLayoutIdentifier)
    }

    private var pastaLayout: KeyboardLayout {
        layoutCache.layout(for: keyboardContext, service: services.layoutService)
    }

    private var keyboardLayoutIdentifier: String {
        // Rebuild only on structural changes. `keyboardCase` is intentionally
        // excluded: KeyboardKit updates shift/case reactively, and keying `.id` on
        // it would tear down the whole keyboard on every auto-capitalization flip
        // mid-typing, cancelling in-flight gestures.
        [
            "\(keyboardContext.keyboardType)",
            "\(keyboardContext.interfaceOrientation)",
            "\(keyboardContext.screenSize.width)x\(keyboardContext.screenSize.height)",
            "\(keyboardContext.deviceTypeForKeyboard)",
            "\(keyboardContext.needsInputModeSwitchKey)",
            keyboardContext.locale.identifier
        ].joined(separator: "|")
    }
}

private struct PastaImmediateKeyPressFeedback<Content: View>: View {
    let item: KeyboardLayout.Item
    let coordinator: PastaTouchFeedbackCoordinator
    let content: Content

    @EnvironmentObject private var keyboardContext: KeyboardContext
    @State private var isTouchDown = false
    @State private var touchGeneration = 0
    @State private var touchDownUptimeNanoseconds: UInt64?

    private let policy = PastaKeyboardTouchFeedbackPolicy.standard

    init(
        item: KeyboardLayout.Item,
        coordinator: PastaTouchFeedbackCoordinator,
        @ViewBuilder content: () -> Content
    ) {
        self.item = item
        self.coordinator = coordinator
        self.content = content()
    }

    @ViewBuilder
    var body: some View {
        if item.action.isSpacer {
            content
        } else {
            content
                .overlay(feedbackOverlay.allowsHitTesting(false))
                .background(
                    PastaTouchFeedbackTarget(
                        coordinator: coordinator,
                        onTouchDownChange: handleTouchDownChange
                    )
                )
                .onDisappear(perform: resetFeedback)
                .transaction { $0.animation = nil }
        }
    }

    private var feedbackOverlay: some View {
        RoundedRectangle(cornerRadius: item.action.standardButtonCornerRadius(for: keyboardContext))
            .fill(feedbackColor)
            .padding(item.edgeInsets)
            .opacity(isTouchDown ? 1 : 0)
    }

    private var feedbackColor: Color {
        let opacity = keyboardContext.hasDarkColorScheme
            ? policy.visualFeedbackOpacityDark
            : policy.visualFeedbackOpacityLight
        let base = keyboardContext.hasDarkColorScheme ? Color.white : Color.black
        return base.opacity(opacity)
    }

    private func handleTouchDownChange(_ isPressed: Bool) {
        if isPressed {
            touchGeneration += 1
            touchDownUptimeNanoseconds = DispatchTime.now().uptimeNanoseconds
            isTouchDown = true
        } else {
            scheduleTouchUp()
        }
    }

    private func scheduleTouchUp() {
        guard isTouchDown else { return }
        let generation = touchGeneration
        let now = DispatchTime.now().uptimeNanoseconds
        let elapsed = touchDownUptimeNanoseconds.map { now >= $0 ? now - $0 : 0 } ?? 0
        let delay = policy.remainingVisibleNanoseconds(after: elapsed)
        guard delay > 0 else {
            resetFeedback(ifGeneration: generation)
            return
        }
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: delay)
            resetFeedback(ifGeneration: generation)
        }
    }

    private func resetFeedback(ifGeneration generation: Int) {
        guard generation == touchGeneration else { return }
        isTouchDown = false
        touchDownUptimeNanoseconds = nil
    }

    private func resetFeedback() {
        touchGeneration += 1
        isTouchDown = false
        touchDownUptimeNanoseconds = nil
    }
}

/// Registers each key's bounds with one passive recognizer for the keyboard.
/// KeyboardKit still owns key gestures, actions, callouts, and text insertion.
private struct PastaTouchFeedbackTarget: UIViewRepresentable {
    let coordinator: PastaTouchFeedbackCoordinator
    let onTouchDownChange: (Bool) -> Void

    func makeUIView(context: Context) -> PastaTouchFeedbackTargetView {
        let view = PastaTouchFeedbackTargetView()
        view.connect(to: coordinator, onTouchDownChange: onTouchDownChange)
        return view
    }

    func updateUIView(_ view: PastaTouchFeedbackTargetView, context: Context) {
        view.connect(to: coordinator, onTouchDownChange: onTouchDownChange)
    }

    static func dismantleUIView(_ view: PastaTouchFeedbackTargetView, coordinator: ()) {
        view.disconnect()
    }
}

private final class PastaTouchFeedbackTargetView: UIView {
    private weak var coordinator: PastaTouchFeedbackCoordinator?
    private var onTouchDownChange: ((Bool) -> Void)?
    private var isPressed = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = false
        isUserInteractionEnabled = false
        backgroundColor = .clear
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        if let window {
            coordinator?.register(self, in: window)
        } else {
            coordinator?.unregister(self)
        }
    }

    func connect(
        to coordinator: PastaTouchFeedbackCoordinator,
        onTouchDownChange: @escaping (Bool) -> Void
    ) {
        if self.coordinator !== coordinator {
            self.coordinator?.unregister(self)
            self.coordinator = coordinator
        }
        self.onTouchDownChange = onTouchDownChange
        if let window {
            coordinator.register(self, in: window)
        }
    }

    func disconnect() {
        setPressed(false)
        coordinator?.unregister(self)
        coordinator = nil
        onTouchDownChange = nil
    }

    func setPressed(_ value: Bool) {
        guard value != isPressed else { return }
        isPressed = value
        onTouchDownChange?(value)
    }
}

/// A single passive window recognizer fans touch-down state out to registered
/// key bounds. Keeping one recognizer avoids making every key inspect every
/// keyboard-host touch.
private final class PastaTouchFeedbackCoordinator: UIGestureRecognizer, ObservableObject, UIGestureRecognizerDelegate {
    private var targets: [ObjectIdentifier: PastaTouchFeedbackTargetView] = [:]
    private weak var activeTouch: UITouch?
    private weak var activeTarget: PastaTouchFeedbackTargetView?

    init() {
        super.init(target: nil, action: nil)
        cancelsTouchesInView = false
        delaysTouchesBegan = false
        delaysTouchesEnded = false
        delegate = self
    }

    func register(_ target: PastaTouchFeedbackTargetView, in window: UIWindow) {
        targets[ObjectIdentifier(target)] = target
        guard view !== window else { return }
        view?.removeGestureRecognizer(self)
        window.addGestureRecognizer(self)
    }

    func unregister(_ target: PastaTouchFeedbackTargetView) {
        targets[ObjectIdentifier(target)] = nil
        if activeTarget === target {
            target.setPressed(false)
            activeTarget = nil
            activeTouch = nil
            if state == .began || state == .changed {
                state = .cancelled
            }
        }
        if targets.isEmpty {
            view?.removeGestureRecognizer(self)
        }
    }

    override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent) {
        guard activeTouch == nil else { return }
        guard let touch = touches.first, let target = target(at: touch) else {
            state = .failed
            return
        }
        activeTouch = touch
        activeTarget = target
        target.setPressed(true)
        state = .began
    }

    override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent) {
        guard let activeTouch, let activeTarget, touches.contains(activeTouch) else { return }
        activeTarget.setPressed(contains(activeTouch, in: activeTarget))
        if state == .began || state == .changed {
            state = .changed
        }
    }

    override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent) {
        finishIfNeeded(for: touches, newState: .ended)
    }

    override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent) {
        finishIfNeeded(for: touches, newState: .cancelled)
    }

    override func reset() {
        activeTarget?.setPressed(false)
        activeTouch = nil
        activeTarget = nil
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldReceive touch: UITouch
    ) -> Bool {
        target(at: touch) != nil
    }

    func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer
    ) -> Bool {
        true
    }

    private func finishIfNeeded(
        for touches: Set<UITouch>,
        newState: UIGestureRecognizer.State
    ) {
        guard let activeTouch else { return }
        guard touches.contains(activeTouch) else { return }
        activeTarget?.setPressed(false)
        self.activeTouch = nil
        activeTarget = nil
        state = newState
    }

    private func target(at touch: UITouch) -> PastaTouchFeedbackTargetView? {
        targets.values.first { contains(touch, in: $0) }
    }

    private func contains(_ touch: UITouch, in target: PastaTouchFeedbackTargetView) -> Bool {
        guard target.window != nil else { return false }
        return target.bounds.contains(touch.location(in: target))
    }
}

@MainActor
private final class PastaKeyboardLayoutCache: ObservableObject {
    private static let maximumCachedLayouts = 24
    private var cachedLayouts: [PastaKeyboardLayoutKey: KeyboardLayout] = [:]
    private var cachedKeys: [PastaKeyboardLayoutKey] = []

    func layout(for keyboardContext: KeyboardContext, service: KeyboardLayoutService) -> KeyboardLayout {
        let key = PastaKeyboardLayoutKey(context: keyboardContext)
        if let cachedLayout = cachedLayouts[key] {
            return cachedLayout
        }

        let layout = service.keyboardLayout(for: keyboardContext)

        cachedLayouts[key] = layout
        cachedKeys.append(key)
        evictOldLayoutsIfNeeded()
        return layout
    }

    private func evictOldLayoutsIfNeeded() {
        while cachedKeys.count > Self.maximumCachedLayouts {
            let evicted = cachedKeys.removeFirst()
            cachedLayouts[evicted] = nil
        }
    }
}

private struct PastaKeyboardLayoutKey: Hashable {
    let signature: PastaKeyboardLayoutSignature

    init(context: KeyboardContext) {
        signature = PastaKeyboardLayoutSignature(
            keyboardType: "\(context.keyboardType)",
            keyboardCase: context.keyboardCase.pastaCaseMode,
            interfaceOrientation: "\(context.interfaceOrientation)",
            screenWidth: Int(context.screenSize.width.rounded()),
            screenHeight: Int(context.screenSize.height.rounded()),
            deviceType: "\(context.deviceTypeForKeyboard)",
            needsInputModeSwitchKey: context.needsInputModeSwitchKey,
            localeIdentifier: context.locale.identifier
        )
    }
}

private struct PastaKeyboardToolbar<AutocompleteToolbar: View>: View {
    @ObservedObject var model: PastaKeyboardToolbarModel
    let autocompleteToolbar: AutocompleteToolbar
    let insertClip: (String) -> Void
    let publish: () -> Void
    let unlockSecret: (PastaKeyboardSecret) -> Void
    let setSecret: () -> Void
    let submitSecretPrompt: () -> Void
    let cancelSecretPrompt: () -> Void

    var body: some View {
        Group {
            if let prompt = model.secretPrompt {
                // The prompt reuses the toolbar band so the keys below stay
                // native and keep the same keyboard height, and so autocomplete
                // never sees passkey characters.
                PastaSecretPromptRow(
                    prompt: prompt,
                    submit: submitSecretPrompt,
                    cancel: cancelSecretPrompt
                )
            } else {
                actionRow
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: PastaToolbarAppearance.toolbarHeight)
        .background(Color.clear)
    }

    private var actionRow: some View {
        HStack(spacing: 0) {
            iconButton(
                accessibilityLabel: "Publish Clipboard",
                systemImage: "square.and.arrow.up",
                isEnabled: !model.isRunningLiveAction,
                action: publish
            )
            divider
            secretMenu
            divider
            autocompleteToolbar
                .frame(maxWidth: .infinity)
                .frame(height: PastaToolbarAppearance.toolbarHeight)
            divider
            pasteMenu
        }
    }

    private func iconButton(
        accessibilityLabel: String,
        systemImage: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(PastaToolbarAppearance.iconFont)
                .frame(width: PastaToolbarAppearance.actionWidth, height: PastaToolbarAppearance.toolbarHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .allowsHitTesting(isEnabled)
        .opacity(isEnabled ? 1 : 0.35)
        .background(Color.clear)
        .accessibilityLabel(accessibilityLabel)
    }

    private var pasteMenu: some View {
        Menu {
            if model.visibleClips.isEmpty {
                Button("No Pasta history") {}
                    .disabled(true)
            } else {
                ForEach(model.visibleClips, id: \.clipId) { clip in
                    Button(clip.title) {
                        insertClip(clip.text)
                    }
                }
            }
        } label: {
            Image(systemName: "doc.on.clipboard")
                .font(PastaToolbarAppearance.iconFont)
                .frame(width: PastaToolbarAppearance.actionWidth, height: PastaToolbarAppearance.toolbarHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .background(Color.clear)
        .accessibilityLabel("Paste from Pasta History")
    }

    private var secretMenu: some View {
        Menu {
            Button("Set Secret from Clipboard") {
                setSecret()
            }
            .disabled(model.isRunningLiveAction)
            if model.visibleSecrets.isEmpty {
                Button("No Pasta secrets") {}
                    .disabled(true)
            } else {
                ForEach(model.visibleSecrets, id: \.clipId) { secret in
                    Button(secret.key) {
                        unlockSecret(secret)
                    }
                    .disabled(model.isRunningLiveAction)
                }
            }
        } label: {
            Image(systemName: "key.fill")
                .font(PastaToolbarAppearance.iconFont)
                .frame(width: PastaToolbarAppearance.actionWidth, height: PastaToolbarAppearance.toolbarHeight)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .background(Color.clear)
        .accessibilityLabel("Pasta Secrets")
    }

    private var divider: some View {
        PastaToolbarAppearance.separator
            .frame(width: 1, height: PastaToolbarAppearance.separatorHeight)
            .background(Color.clear)
    }
}

/// Compact passkey entry inside the keyboard's own primary view.
private struct PastaSecretPromptRow: View {
    let prompt: PastaSecretPrompt
    let submit: () -> Void
    let cancel: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            Button(action: cancel) {
                Image(systemName: "xmark")
                    .font(PastaToolbarAppearance.iconFont)
                    .frame(width: PastaToolbarAppearance.actionWidth, height: PastaToolbarAppearance.toolbarHeight)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Cancel Pasta Secret")

            VStack(alignment: .leading, spacing: 1) {
                Text(prompt.caption)
                    .font(.system(size: 11, weight: .semibold))
                    .opacity(0.65)
                    .lineLimit(1)
                    .truncationMode(.head)
                Text(prompt.isCurrentFieldEmpty ? prompt.placeholder : prompt.displayValue)
                    .font(.system(size: 15, weight: .regular, design: .monospaced))
                    .opacity(prompt.isCurrentFieldEmpty ? 0.4 : 1)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityLabel("\(prompt.title). \(prompt.caption)")

            Button(action: submit) {
                Text(prompt.submitTitle)
                    .font(.system(size: 15, weight: .semibold))
                    .frame(height: PastaToolbarAppearance.toolbarHeight)
                    .padding(.horizontal, 12)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .allowsHitTesting(!prompt.isCurrentFieldEmpty)
            .opacity(prompt.isCurrentFieldEmpty ? 0.35 : 1)
            .accessibilityLabel(prompt.submitTitle)
        }
        .padding(.trailing, 4)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .background(Color.clear)
    }
}

private enum PastaToolbarAppearance {
    static let foreground = Color.keyboardButtonForeground
    static let separator = Color.keyboardButtonForeground.opacity(0.20)
    static let toolbarHeight: CGFloat = 48
    static let actionWidth: CGFloat = 58
    static let separatorHeight: CGFloat = 30

    static var iconFont: Font { .system(size: 22, weight: .semibold) }
    static var autocompleteToolbarStyle: Autocomplete.ToolbarStyle {
        Autocomplete.ToolbarStyle(
            height: toolbarHeight,
            padding: 0
        )
    }
}

private extension Keyboard.KeyboardCase {
    var isPastaUppercaseState: Bool {
        switch self {
        case .uppercased, .capsLocked:
            return true
        case .auto, .lowercased:
            return false
        }
    }
}

private extension Keyboard.ButtonStyle {
    mutating func applyPastaKeyboardTokens(_ tokens: PastaKeyboardShiftStyleTokens) {
        switch tokens.fill {
        case .standard:
            break
        case .black:
            backgroundColor = .black
        case .white:
            backgroundColor = .white
        }

        switch tokens.foreground {
        case .standard:
            break
        case .black:
            foregroundColor = .black
        case .white:
            foregroundColor = .white
        }
    }
}

@MainActor
private final class PastaKeyboardToolbarModel: ObservableObject {
    @Published private(set) var clips: [PastaKeyboardClip]
    @Published private(set) var secrets: [PastaKeyboardSecret]
    @Published private(set) var secretPrompt: PastaSecretPrompt?
    @Published private(set) var statusMessage: String?
    @Published private(set) var isRunningLiveAction: Bool

    init(
        clips: [PastaKeyboardClip] = [],
        secrets: [PastaKeyboardSecret] = [],
        secretPrompt: PastaSecretPrompt? = nil,
        statusMessage: String? = nil,
        isRunningLiveAction: Bool = false
    ) {
        self.clips = clips
        self.secrets = secrets
        self.secretPrompt = secretPrompt
        self.statusMessage = statusMessage
        self.isRunningLiveAction = isRunningLiveAction
    }

    var visibleClips: [PastaKeyboardClip] {
        Array(clips.prefix(12))
    }

    var visibleSecrets: [PastaKeyboardSecret] {
        Array(secrets.prefix(12))
    }

    func update(
        clips: [PastaKeyboardClip],
        secrets: [PastaKeyboardSecret],
        secretPrompt: PastaSecretPrompt?,
        statusMessage: String?,
        isRunningLiveAction: Bool
    ) {
        self.clips = clips
        self.secrets = secrets
        self.secretPrompt = secretPrompt
        self.statusMessage = statusMessage
        self.isRunningLiveAction = isRunningLiveAction
    }
}

private final class PastaKeyboardBehavior: Keyboard.StandardKeyboardBehavior {
    override func preferredKeyboardCase(
        after gesture: Keyboard.Gesture,
        on action: KeyboardAction
    ) -> Keyboard.KeyboardCase {
        guard gesture == .release else {
            return super.preferredKeyboardCase(after: gesture, on: action)
        }

        switch action {
        case .character, .characterMargin, .diacritic:
            guard keyboardContext.keyboardCase != .capsLocked else { return .capsLocked }
            return keyboardContext.keyboardCase.pastaCaseMode
                .caseAfterInsertedCharacter(
                    autocapitalizesAllCharacters: keyboardContext.autocapitalizationType == .allCharacters
                )
                .keyboardCase
        default:
            return super.preferredKeyboardCase(after: gesture, on: action)
        }
    }
}

private extension Keyboard.KeyboardCase {
    var pastaCaseMode: PastaKeyboardCaseMode {
        PastaKeyboardCaseMode(rawValue: rawValue) ?? .auto
    }
}

private extension PastaKeyboardCaseMode {
    var keyboardCase: Keyboard.KeyboardCase {
        switch self {
        case .auto:
            return .auto
        case .capsLocked:
            return .capsLocked
        case .lowercased:
            return .lowercased
        case .uppercased:
            return .uppercased
        }
    }
}

private final class PastaAutocompleteService: AutocompleteService {
    static let idleSuggestions = PastaKeyboardAutocompleteEngine.idleSuggestions.map(\.keyboardKitSuggestion)

    var locale: Locale = .current

    private let engine = PastaKeyboardAutocompleteEngine()
    private let wordsLock = NSLock()
    private var ignored = Set<String>()
    private var learned = Set<String>()

    var canIgnoreWords: Bool { true }
    var canLearnWords: Bool { true }
    var ignoredWords: [String] { wordsLock.withLock { Array(ignored).sorted() } }
    var learnedWords: [String] { wordsLock.withLock { Array(learned).sorted() } }

    func autocomplete(_ text: String) async throws -> Autocomplete.ServiceResult {
        let ignoredSnapshot = wordsLock.withLock { ignored }
        let suggestions = engine
            .suggestions(for: text, ignoredWords: ignoredSnapshot)
            .map(\.keyboardKitSuggestion)
        return Autocomplete.ServiceResult(inputText: text, suggestions: suggestions)
    }

    func hasIgnoredWord(_ word: String) -> Bool {
        wordsLock.withLock { ignored.contains(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func hasLearnedWord(_ word: String) -> Bool {
        wordsLock.withLock { learned.contains(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func ignoreWord(_ word: String) {
        _ = wordsLock.withLock { ignored.insert(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func learnWord(_ word: String) {
        _ = wordsLock.withLock { learned.insert(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func removeIgnoredWord(_ word: String) {
        _ = wordsLock.withLock { ignored.remove(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func unlearnWord(_ word: String) {
        _ = wordsLock.withLock { learned.remove(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }
}

private extension PastaKeyboardAutocompleteSuggestion {
    var keyboardKitSuggestion: Autocomplete.Suggestion {
        Autocomplete.Suggestion(
            text: text,
            type: kind.keyboardKitSuggestionType,
            title: title
        )
    }
}

private extension PastaKeyboardAutocompleteSuggestionKind {
    var keyboardKitSuggestionType: Autocomplete.SuggestionType {
        switch self {
        case .regular:
            return .regular
        case .autocorrect:
            return .autocorrect
        case .unknown:
            return .unknown
        }
    }
}

private extension NSLock {
    func withLock<T>(_ operation: () -> T) -> T {
        lock()
        defer { unlock() }
        return operation()
    }
}

private struct LivePastaContext {
    let configuration: PastaDeviceConfiguration
    let groupKey: String
    let signingPrivateKey: String
}

private enum PastaKeyboardError: Error {
    case fullAccessRequired
    case notPaired
}

private extension String {
    var singleLineTitle: String {
        let compact = replacingOccurrences(of: "\n", with: " ")
        return compact.isEmpty ? "Text clip" : String(compact.prefix(48))
    }
}

#if DEBUG
private extension PastaKeyboardToolbarModel {
    static var preview: PastaKeyboardToolbarModel {
        PastaKeyboardToolbarModel(
            clips: [
                PastaKeyboardClip(clipId: "clip_preview_3", sequence: 3, title: "Let's take Mish in 25 mins and take a little break then.", text: "Let's take Mish in 25 mins and take a little break then.", createdAt: 0),
                PastaKeyboardClip(clipId: "clip_preview_2", sequence: 2, title: "melissa_bikini@icloud.com", text: "melissa_bikini@icloud.com", createdAt: 0),
                PastaKeyboardClip(clipId: "clip_preview_1", sequence: 1, title: "1172", text: "1172", createdAt: 0)
            ],
            secrets: [
                PastaKeyboardSecret(clipId: "clip_secret_1", sequence: 4, key: "API_TOKEN", createdAt: 0)
            ],
            statusMessage: nil,
            isRunningLiveAction: false
        )
    }

    static var previewSecretPrompt: PastaKeyboardToolbarModel {
        PastaKeyboardToolbarModel(
            secretPrompt: PastaSecretPrompt(intent: .setFromClipboard),
            statusMessage: nil,
            isRunningLiveAction: false
        )
    }
}

/// Live canvas for the Pasta keyboard. Renders the action row in KeyboardKit's
/// native toolbar slot above the stock keys, so the toolbar styling can be tuned
/// in Xcode without a device build. Caveat (see goal-14 / native-ios docs): the
/// canvas does not reproduce the real keyboard-extension host chrome (top
/// safe-area / strip), so confirm final chrome on a device/TestFlight build.
private struct PastaKeyboardPreviewHost: View {
    let controller = KeyboardInputViewController.preview

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 0)
            PastaKeyboardView(
                services: controller.services,
                state: controller.state,
                toolbarModel: .preview,
                insertClip: { _ in },
                publish: {},
                unlockSecret: { _ in },
                setSecret: {},
                submitSecretPrompt: {},
                cancelSecretPrompt: {}
            )
        }
        .keyboardState(controller.state)
        .background(Color(white: 0.85))
    }
}

#Preview("Pasta keyboard — full") {
    PastaKeyboardPreviewHost()
}

#Preview("Pasta toolbar — row only") {
    PastaKeyboardToolbar(
        model: .preview,
        autocompleteToolbar: Autocomplete.Toolbar(
            suggestions: PastaAutocompleteService.idleSuggestions,
            suggestionAction: { _ in }
        ),
        insertClip: { _ in },
        publish: {},
        unlockSecret: { _ in },
        setSecret: {},
        submitSecretPrompt: {},
        cancelSecretPrompt: {}
    )
    .frame(width: 393, height: 60)
    .background(Color.keyboardBackground)
}

#Preview("Pasta toolbar — secret prompt") {
    PastaKeyboardToolbar(
        model: .previewSecretPrompt,
        autocompleteToolbar: EmptyView(),
        insertClip: { _ in },
        publish: {},
        unlockSecret: { _ in },
        setSecret: {},
        submitSecretPrompt: {},
        cancelSecretPrompt: {}
    )
    .frame(width: 393, height: 60)
    .background(Color.keyboardBackground)
}
#endif
