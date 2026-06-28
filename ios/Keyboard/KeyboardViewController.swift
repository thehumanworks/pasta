import KeyboardKit
import PastaCore
import SwiftUI
import UIKit

@MainActor
final class KeyboardViewController: KeyboardInputViewController {
    private var clips: [PastaKeyboardClip] = []
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
        refreshToolbarModel()
    }

    private func refreshToolbarModel() {
        toolbarModel.update(
            clips: clips,
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
                insertClip: { [weak self] text in self?.textDocumentProxy.insertText(text) },
                publish: { [weak self] in self?.publishClipboardText() }
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
                let refreshed = try await client.history(
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                clips = refreshed
                try store?.saveKeyboardClips(refreshed)
                if reportsStatus {
                    statusMessage = refreshed.isEmpty ? "No Pasta text history yet." : "Synced \(refreshed.count) Pasta text clips."
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

private struct PastaKeyboardView: View {
    let services: Keyboard.Services
    let state: Keyboard.State
    @ObservedObject var toolbarModel: PastaKeyboardToolbarModel
    let insertClip: (String) -> Void
    let publish: () -> Void

    @EnvironmentObject private var keyboardContext: KeyboardContext
    @StateObject private var layoutCache = PastaKeyboardLayoutCache()

    var body: some View {
        // Pasta is additive: KeyboardKit owns the keyboard, autocomplete band,
        // sizing, and input handling. Pasta only adds compact side actions around
        // KeyboardKit's standard autocomplete toolbar.
        KeyboardView(
            layout: pastaLayout,
            state: state,
            services: services,
            buttonContent: { $0.view },
            buttonView: { $0.view },
            collapsedView: { $0.view },
            emojiKeyboard: { $0.view },
            toolbar: { params in
                PastaKeyboardToolbar(
                    model: toolbarModel,
                    autocompleteToolbar: params.view,
                    insertClip: insertClip,
                    publish: publish
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

    var body: some View {
        HStack(spacing: 0) {
            iconButton(
                accessibilityLabel: "Publish Clipboard",
                systemImage: "square.and.arrow.up",
                isEnabled: !model.isRunningLiveAction,
                action: publish
            )
            divider
            autocompleteToolbar
                .frame(maxWidth: .infinity)
                .frame(height: PastaToolbarAppearance.toolbarHeight)
            divider
            pasteMenu
        }
        .frame(maxWidth: .infinity)
        .frame(height: PastaToolbarAppearance.toolbarHeight)
        .background(Color.clear)
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

    private var divider: some View {
        PastaToolbarAppearance.separator
            .frame(width: 1, height: PastaToolbarAppearance.separatorHeight)
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
    @Published private(set) var statusMessage: String?
    @Published private(set) var isRunningLiveAction: Bool

    init(clips: [PastaKeyboardClip] = [], statusMessage: String? = nil, isRunningLiveAction: Bool = false) {
        self.clips = clips
        self.statusMessage = statusMessage
        self.isRunningLiveAction = isRunningLiveAction
    }

    var visibleClips: [PastaKeyboardClip] {
        Array(clips.prefix(12))
    }

    func update(clips: [PastaKeyboardClip], statusMessage: String?, isRunningLiveAction: Bool) {
        self.clips = clips
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
        wordsLock.withLock { ignored.insert(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func learnWord(_ word: String) {
        wordsLock.withLock { learned.insert(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func removeIgnoredWord(_ word: String) {
        wordsLock.withLock { ignored.remove(PastaKeyboardAutocompleteEngine.normalized(word)) }
    }

    func unlearnWord(_ word: String) {
        wordsLock.withLock { learned.remove(PastaKeyboardAutocompleteEngine.normalized(word)) }
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
                publish: {}
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
        publish: {}
    )
    .frame(width: 393, height: 60)
    .background(Color.keyboardBackground)
}
#endif
