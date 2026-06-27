import KeyboardKit
import PastaCore
import SwiftUI
import UIKit

@MainActor
final class KeyboardViewController: KeyboardInputViewController {
    private var clips: [PastaKeyboardClip] = []
    private var showsExpandedHistory = false
    private var isRunningLiveAction = false
    private var statusMessage: String?
    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store = try? PastaAppGroupStore()

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(Color.keyboardBackground)
        enableExperimentalKeyboardTypeChangeTracking()
        reloadClips()
        setup(for: .pasta) { [weak self] _ in
            guard let self else { return }
            services.keyboardBehavior = PastaKeyboardBehavior(
                keyboardContext: state.keyboardContext,
                repeatGestureTimer: services.repeatGestureTimer
            )
            setupPastaKeyboardView()
        }
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reloadClips()
        setupPastaKeyboardView()
    }

    override func viewWillSetupKeyboardView() {
        setupPastaKeyboardView()
    }

    private func reloadClips() {
        clips = store?.loadKeyboardClips() ?? []
    }

    private func setupPastaKeyboardView() {
        let model = PastaKeyboardToolbarModel(
            clips: clips,
            statusMessage: statusMessage,
            showsExpandedHistory: showsExpandedHistory,
            isRunningLiveAction: isRunningLiveAction
        )
        setupKeyboardView { [weak self] controller in
            PastaKeyboardView(
                services: controller.services,
                state: controller.state,
                toolbarModel: model,
                insertClip: { [weak self] text in self?.textDocumentProxy.insertText(text) },
                refresh: { [weak self] in self?.refreshHistoryFromNetwork() },
                publish: { [weak self] in self?.publishClipboardText() },
                toggleExpanded: { [weak self] in self?.toggleExpandedHistory() }
            )
        }
    }

    private func toggleExpandedHistory() {
        showsExpandedHistory.toggle()
        setupPastaKeyboardView()
    }

    private func refreshHistoryFromNetwork() {
        Task {
            await runLiveAction(started: "Refreshing Pasta history...") {
                let live = try liveContext()
                let refreshed = try await client.history(
                    configuration: live.configuration,
                    groupKey: live.groupKey,
                    signingPrivateKey: live.signingPrivateKey
                )
                clips = refreshed
                try store?.saveKeyboardClips(refreshed)
                statusMessage = refreshed.isEmpty ? "No Pasta text history yet." : "Synced \(refreshed.count) Pasta text clips."
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
                    sequence: clip.seq,
                    title: text.singleLineTitle,
                    text: text,
                    createdAt: clip.createdAt
                )
                clips = [cached] + clips.filter { $0.sequence != clip.seq }
                try store?.saveKeyboardClips(clips)
                statusMessage = "Published clipboard to Pasta."
            }
        }
    }

    private func runLiveAction(started: String, operation: () async throws -> Void) async {
        guard !isRunningLiveAction else { return }
        isRunningLiveAction = true
        statusMessage = started
        setupPastaKeyboardView()
        defer {
            isRunningLiveAction = false
            setupPastaKeyboardView()
        }
        do {
            try await operation()
        } catch PastaKeyboardError.fullAccessRequired {
            statusMessage = "Allow Full Access for live sync."
        } catch PastaKeyboardError.notPaired {
            statusMessage = "Pair in Pasta before live sync."
        } catch {
            statusMessage = "Pasta sync failed."
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
    let refresh: () -> Void
    let publish: () -> Void
    let toggleExpanded: () -> Void

    @EnvironmentObject private var keyboardContext: KeyboardContext

    var body: some View {
        // Pasta is additive: KeyboardKit owns the keys and input handling, and the
        // Pasta action row lives in KeyboardKit's native toolbar slot (where the
        // QuickType band normally sits). Opacity comes from an explicit keyboard
        // surface, not `renderBackground` — the standard style service's background
        // is transparent, so never set `renderBackground: false` and hand-paint a
        // sibling strip again.
        KeyboardView(
            layout: pastaLayout,
            state: state,
            services: services,
            buttonContent: { $0.view },
            buttonView: { $0.view },
            collapsedView: { $0.view },
            emojiKeyboard: { $0.view },
            toolbar: { _ in
                PastaKeyboardToolbar(
                    model: toolbarModel,
                    insertClip: insertClip,
                    refresh: refresh,
                    publish: publish,
                    toggleExpanded: toggleExpanded
                )
            }
        )
        .keyboardViewStyle(.init(background: .color(.keyboardBackground)))
        .autocompleteToolbarStyle(.init(height: PastaToolbarAppearance.shelfHeight, padding: 0))
        .keyboardInputToolbarDisplayMode(.none)
        .id(keyboardLayoutIdentifier)
    }

    private var pastaLayout: KeyboardLayout {
        services.layoutService.keyboardLayout(for: keyboardContext)
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
            "\(keyboardContext.deviceTypeForKeyboard)"
        ].joined(separator: "|")
    }
}

private struct PastaKeyboardToolbar: View {
    let model: PastaKeyboardToolbarModel
    let insertClip: (String) -> Void
    let refresh: () -> Void
    let publish: () -> Void
    let toggleExpanded: () -> Void

    var body: some View {
        ZStack(alignment: .topLeading) {
            PastaToolbarAppearance.shelfBackground
            scrollRow
        }
        .frame(maxWidth: .infinity)
        .frame(height: PastaToolbarAppearance.shelfHeight)
        .background(alignment: .top) {
            PastaToolbarAppearance.shelfBackground
                .frame(height: PastaToolbarAppearance.shelfHeight + PastaToolbarAppearance.topBleed)
                .offset(y: -PastaToolbarAppearance.topBleed)
        }
    }

    private var scrollRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .center, spacing: 0) {
                if let statusMessage = model.statusMessage {
                    Text(statusMessage)
                        .font(PastaToolbarAppearance.font)
                        .foregroundColor(PastaToolbarAppearance.foreground)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .padding(.horizontal, 14)
                        .frame(height: PastaToolbarAppearance.shelfHeight)
                    PastaToolbarDivider()
                }

                PastaToolbarActionButton(
                    title: "Refresh",
                    systemImage: "arrow.clockwise",
                    isEnabled: !model.isRunningLiveAction,
                    action: refresh
                )

                PastaToolbarDivider()

                PastaToolbarActionButton(
                    title: "Publish",
                    systemImage: "square.and.arrow.up",
                    isEnabled: !model.isRunningLiveAction,
                    action: publish
                )

                PastaToolbarDivider()

                PastaToolbarActionButton(
                    title: model.showsExpandedHistory ? "Less" : "All",
                    systemImage: model.showsExpandedHistory ? "chevron.up" : "list.bullet",
                    isEnabled: true,
                    action: toggleExpanded
                )

                if model.clips.isEmpty {
                    PastaToolbarDivider()
                    Text("Open Pasta to sync")
                        .font(PastaToolbarAppearance.font)
                        .foregroundColor(PastaToolbarAppearance.foreground)
                        .lineLimit(1)
                        .padding(.horizontal, 16)
                        .frame(height: PastaToolbarAppearance.shelfHeight)
                } else {
                    ForEach(model.visibleClips) { clip in
                        PastaToolbarDivider()
                        Button {
                            insertClip(clip.text)
                        } label: {
                            Text(clip.title)
                                .lineLimit(1)
                                .truncationMode(.tail)
                        }
                        .buttonStyle(PastaToolbarTextButtonStyle())
                    }
                }
            }
            .frame(height: PastaToolbarAppearance.shelfHeight)
        }
        .contentMargins(.zero, for: .scrollContent)
        .scrollClipDisabled()
        .frame(height: PastaToolbarAppearance.shelfHeight)
        .frame(maxWidth: .infinity, alignment: .top)
    }
}

private struct PastaToolbarActionButton: View {
    let title: String
    let systemImage: String
    let isEnabled: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemImage)
                    .font(PastaToolbarAppearance.font)
                    .symbolRenderingMode(.monochrome)
                Text(title)
                    .font(PastaToolbarAppearance.font)
            }
            .foregroundColor(PastaToolbarAppearance.foreground)
            .lineLimit(1)
            .padding(.horizontal, 13)
            .frame(height: PastaToolbarAppearance.shelfHeight)
            .frame(maxHeight: .infinity, alignment: .center)
            .background(PastaToolbarAppearance.shelfBackground)
        }
        .buttonStyle(.plain)
        .allowsHitTesting(isEnabled)
    }
}

private struct PastaToolbarTextButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(PastaToolbarAppearance.font)
            .foregroundColor(PastaToolbarAppearance.foreground)
            .lineLimit(1)
            .padding(.horizontal, 16)
            .frame(height: PastaToolbarAppearance.shelfHeight)
            .frame(maxWidth: 220)
            .background(
                configuration.isPressed
                    ? PastaToolbarAppearance.pressedSegmentBackground
                    : PastaToolbarAppearance.shelfBackground
            )
            .contentShape(Rectangle())
    }
}

private struct PastaToolbarDivider: View {
    var body: some View {
        Rectangle()
            .fill(PastaToolbarAppearance.separator)
            .frame(width: 1, height: PastaToolbarAppearance.separatorHeight)
    }
}

private enum PastaToolbarAppearance {
    /// 60pt band (~25% taller than KeyboardKit's 48pt autocomplete default) for readable,
    /// full-height action targets. Shelf and segments stay fully opaque so host content
    /// cannot bleed through and make labels look blurred.
    static let shelfBackground = Color.keyboardBackground
    static let foreground = Color.keyboardButtonForeground
    static let pressedSegmentBackground = Color.keyboardButtonForeground.opacity(0.08)
    static let separator = Color.keyboardButtonForeground.opacity(0.20)
    static let font = Font.system(size: 17, weight: .semibold)
    static let shelfHeight: CGFloat = 60
    static let separatorHeight: CGFloat = 36
    /// Paints the seam above the shelf where the extension host leaves a narrow strip.
    static let topBleed: CGFloat = 10
}

private struct PastaKeyboardToolbarModel {
    let clips: [PastaKeyboardClip]
    let statusMessage: String?
    let showsExpandedHistory: Bool
    let isRunningLiveAction: Bool

    var visibleClips: [PastaKeyboardClip] {
        Array(clips.prefix(showsExpandedHistory ? 30 : 12))
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
                PastaKeyboardClip(sequence: 3, title: "Let's take Mish in 25 mins and take a little break then.", text: "Let's take Mish in 25 mins and take a little break then.", createdAt: 0),
                PastaKeyboardClip(sequence: 2, title: "melissa_bikini@icloud.com", text: "melissa_bikini@icloud.com", createdAt: 0),
                PastaKeyboardClip(sequence: 1, title: "1172", text: "1172", createdAt: 0)
            ],
            statusMessage: nil,
            showsExpandedHistory: false,
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
                refresh: {},
                publish: {},
                toggleExpanded: {}
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
        insertClip: { _ in },
        refresh: {},
        publish: {},
        toggleExpanded: {}
    )
    .frame(width: 393, height: 60)
    .background(Color.keyboardBackground)
}
#endif
