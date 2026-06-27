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
    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store = try? PastaAppGroupStore()
    private let autocompleteService = PastaAutocompleteService()

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
        setupPastaKeyboardView()
        autoRefreshHistoryIfPossible()
    }

    override func viewWillSetupKeyboardView() {
        setupPastaKeyboardView()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        deferKeyboardSurfaceToHost()
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

    private func reloadClips() {
        clips = store?.loadKeyboardClips() ?? []
    }

    private func setupPastaKeyboardView() {
        let model = PastaKeyboardToolbarModel(
            clips: clips,
            statusMessage: statusMessage,
            isRunningLiveAction: isRunningLiveAction
        )
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
        setupPastaKeyboardView()
        defer {
            isRunningLiveAction = false
            setupPastaKeyboardView()
        }
        do {
            try await operation()
        } catch PastaKeyboardError.fullAccessRequired {
            if reportsStatus { statusMessage = "Allow Full Access for live sync." }
        } catch PastaKeyboardError.notPaired {
            if reportsStatus { statusMessage = "Pair in Pasta before live sync." }
        } catch {
            if reportsStatus { statusMessage = "Pasta sync failed." }
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
    let toolbarModel: PastaKeyboardToolbarModel
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
    private var cachedKey: PastaKeyboardLayoutKey?
    private var cachedLayout: KeyboardLayout?

    func layout(for keyboardContext: KeyboardContext, service: KeyboardLayoutService) -> KeyboardLayout {
        let key = PastaKeyboardLayoutKey(context: keyboardContext)
        if cachedKey == key, let cachedLayout {
            return cachedLayout
        }

        var layout = service.keyboardLayout(for: keyboardContext)
        if keyboardContext.keyboardType == .alphabetic {
            let config = layout.deviceConfiguration ?? .standard(for: keyboardContext)
            let numberRow = KeyboardAction.Row(characters: "1234567890").map {
                $0.standardLayoutItem(for: config)
            }
            layout.itemRows.insert(numberRow, at: 0)
        }

        cachedKey = key
        cachedLayout = layout
        return layout
    }
}

private struct PastaKeyboardLayoutKey: Equatable {
    let keyboardType: String
    let interfaceOrientation: String
    let screenWidth: Int
    let screenHeight: Int
    let deviceType: String
    let needsInputModeSwitchKey: Bool
    let localeIdentifier: String

    init(context: KeyboardContext) {
        keyboardType = "\(context.keyboardType)"
        interfaceOrientation = "\(context.interfaceOrientation)"
        screenWidth = Int(context.screenSize.width.rounded())
        screenHeight = Int(context.screenSize.height.rounded())
        deviceType = "\(context.deviceTypeForKeyboard)"
        needsInputModeSwitchKey = context.needsInputModeSwitchKey
        localeIdentifier = context.locale.identifier
    }
}

private struct PastaKeyboardToolbar<AutocompleteToolbar: View>: View {
    let model: PastaKeyboardToolbarModel
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

private struct PastaKeyboardToolbarModel {
    let clips: [PastaKeyboardClip]
    let statusMessage: String?
    let isRunningLiveAction: Bool

    var visibleClips: [PastaKeyboardClip] {
        Array(clips.prefix(12))
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
            if keyboardContext.autocapitalizationType == .allCharacters { return .uppercased }
            return .lowercased
        default:
            return super.preferredKeyboardCase(after: gesture, on: action)
        }
    }
}

private final class PastaAutocompleteService: AutocompleteService {
    static let idleSuggestions = [
        Autocomplete.Suggestion(text: "I"),
        Autocomplete.Suggestion(text: "The"),
        Autocomplete.Suggestion(text: "It")
    ]

    var locale: Locale = .current

    private var ignored = Set<String>()
    private var learned = Set<String>()

    var canIgnoreWords: Bool { true }
    var canLearnWords: Bool { true }
    var ignoredWords: [String] { Array(ignored).sorted() }
    var learnedWords: [String] { Array(learned).sorted() }

    func autocomplete(_ text: String) async throws -> Autocomplete.ServiceResult {
        let languageCandidates = Self.languageCandidates(for: locale)
        let ignoredSnapshot = ignored
        let suggestions = await MainActor.run {
            Self.suggestions(
                for: text,
                languageCandidates: languageCandidates,
                ignoredWords: ignoredSnapshot
            )
        }
        return Autocomplete.ServiceResult(inputText: text, suggestions: suggestions)
    }

    func hasIgnoredWord(_ word: String) -> Bool {
        ignored.contains(Self.normalized(word))
    }

    func hasLearnedWord(_ word: String) -> Bool {
        learned.contains(Self.normalized(word))
    }

    func ignoreWord(_ word: String) {
        ignored.insert(Self.normalized(word))
    }

    func learnWord(_ word: String) {
        learned.insert(Self.normalized(word))
    }

    func removeIgnoredWord(_ word: String) {
        ignored.remove(Self.normalized(word))
    }

    func unlearnWord(_ word: String) {
        learned.remove(Self.normalized(word))
    }

    @MainActor
    private static func suggestions(
        for text: String,
        languageCandidates: [String],
        ignoredWords: Set<String>
    ) -> [Autocomplete.Suggestion] {
        guard let range = currentWordRange(in: text) else {
            return Self.idleSuggestions
        }

        let nsText = text as NSString
        let word = nsText.substring(with: range)
        guard !word.isEmpty else { return Self.idleSuggestions }

        let checker = Self.checker
        let language = checkerLanguage(candidates: languageCandidates)
        var suggestions: [Autocomplete.Suggestion] = []
        var seen = Set<String>()

        appendUnknownSuggestion(for: word, to: &suggestions, seen: &seen)
        appendAutocorrectSuggestion(
            for: word,
            text: text,
            range: range,
            checker: checker,
            language: language,
            ignoredWords: ignoredWords,
            to: &suggestions,
            seen: &seen
        )
        appendCompletionSuggestions(
            for: word,
            text: text,
            range: range,
            checker: checker,
            language: language,
            to: &suggestions,
            seen: &seen
        )
        appendFallbackSuggestions(for: word, to: &suggestions, seen: &seen)

        return suggestions.isEmpty ? Self.idleSuggestions : Array(suggestions.prefix(3))
    }

    private static func appendUnknownSuggestion(
        for word: String,
        to suggestions: inout [Autocomplete.Suggestion],
        seen: inout Set<String>
    ) {
        guard word.count > 1 else { return }
        append(
            Autocomplete.Suggestion(text: word, type: .unknown, title: "\"\(word)\""),
            to: &suggestions,
            seen: &seen
        )
    }

    @MainActor
    private static func appendAutocorrectSuggestion(
        for word: String,
        text: String,
        range: NSRange,
        checker: UITextChecker,
        language: String,
        ignoredWords: Set<String>,
        to suggestions: inout [Autocomplete.Suggestion],
        seen: inout Set<String>
    ) {
        guard !ignoredWords.contains(normalized(word)) else { return }
        let misspelled = checker.rangeOfMisspelledWord(
            in: text,
            range: range,
            startingAt: range.location,
            wrap: false,
            language: language
        )
        guard misspelled.location != NSNotFound else { return }
        guard let guess = checker.guesses(forWordRange: range, in: text, language: language)?.first else { return }
        guard !guess.caseInsensitiveEquals(word) else { return }
        let suggestion = Autocomplete.Suggestion(text: guess, type: .autocorrect)
            .autocompleteCased(for: word)
        append(suggestion, to: &suggestions, seen: &seen)
    }

    @MainActor
    private static func appendCompletionSuggestions(
        for word: String,
        text: String,
        range: NSRange,
        checker: UITextChecker,
        language: String,
        to suggestions: inout [Autocomplete.Suggestion],
        seen: inout Set<String>
    ) {
        let completions = checker.completions(
            forPartialWordRange: range,
            in: text,
            language: language
        ) ?? []

        for completion in completions.prefix(6) {
            guard !completion.caseInsensitiveEquals(word) else { continue }
            let suggestion = Autocomplete.Suggestion(text: completion)
                .autocompleteCased(for: word)
            append(suggestion, to: &suggestions, seen: &seen)
        }
    }

    private static func appendFallbackSuggestions(
        for word: String,
        to suggestions: inout [Autocomplete.Suggestion],
        seen: inout Set<String>
    ) {
        let prefix = word.lowercased()
        for fallback in Self.commonWords where fallback.lowercased().hasPrefix(prefix) {
            guard !fallback.caseInsensitiveEquals(word) else { continue }
            let suggestion = Autocomplete.Suggestion(text: fallback)
                .autocompleteCased(for: word)
            append(suggestion, to: &suggestions, seen: &seen)
        }
    }

    private static func append(
        _ suggestion: Autocomplete.Suggestion,
        to suggestions: inout [Autocomplete.Suggestion],
        seen: inout Set<String>
    ) {
        let key = normalized(suggestion.text)
        guard !key.isEmpty, !seen.contains(key) else { return }
        seen.insert(key)
        suggestions.append(suggestion)
    }

    private static func currentWordRange(in text: String) -> NSRange? {
        let nsText = text as NSString
        var start = nsText.length
        while start > 0 {
            let codeUnit = nsText.character(at: start - 1)
            guard
                let scalar = UnicodeScalar(Int(codeUnit)),
                Self.wordCharacters.contains(scalar)
            else {
                break
            }
            start -= 1
        }

        let length = nsText.length - start
        guard length > 0 else { return nil }
        return NSRange(location: start, length: length)
    }

    @MainActor
    private static func checkerLanguage(candidates: [String]) -> String {
        candidates.first { availableCheckerLanguages.contains($0) } ?? "en_US"
    }

    private static func languageCandidates(for locale: Locale) -> [String] {
        [
            locale.identifier,
            locale.identifier.replacingOccurrences(of: "_", with: "-"),
            locale.language.languageCode?.identifier ?? "",
            "en_US",
            "en"
        ].filter { !$0.isEmpty }
    }

    private static func normalized(_ word: String) -> String {
        word.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static let wordCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "'"))
    @MainActor private static let checker = UITextChecker()
    @MainActor private static let availableCheckerLanguages = Set(UITextChecker.availableLanguages)
    private static let commonWords = [
        "I", "the", "to", "and", "you", "that", "it", "in", "is", "for",
        "of", "on", "with", "this", "we", "are", "be", "have", "not", "can",
        "will", "from", "at", "as", "if", "or", "so", "but", "just", "thanks"
    ]
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

    func caseInsensitiveEquals(_ other: String) -> Bool {
        compare(other, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
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
