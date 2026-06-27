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

    override func viewDidLoad() {
        super.viewDidLoad()
        applyKeyboardSurfaceBackground()
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
        applyKeyboardSurfaceBackground()
        reloadClips()
        setupPastaKeyboardView()
        autoRefreshHistoryIfPossible()
    }

    override func viewWillSetupKeyboardView() {
        setupPastaKeyboardView()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        applyKeyboardSurfaceBackground()
    }

    private func applyKeyboardSurfaceBackground() {
        let background = PastaToolbarAppearance.uiKeyboardSurface
        view.isOpaque = true
        view.backgroundColor = background
        inputView?.isOpaque = true
        inputView?.backgroundColor = background
        children.forEach { child in
            child.view.isOpaque = true
            child.view.backgroundColor = background
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
        applyKeyboardSurfaceBackground()
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
                    publish: publish
                )
            }
        )
        .keyboardViewStyle(.init(background: .color(PastaToolbarAppearance.keyboardSurface)))
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
    let publish: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            actionButton(
                title: "Publish",
                systemImage: "square.and.arrow.up",
                isEnabled: !model.isRunningLiveAction,
                action: publish
            )
            divider
            pasteMenu
        }
        .frame(height: PastaToolbarAppearance.shelfHeight)
        .background(Color.clear)
    }

    private func statusLabel(_ text: String) -> some View {
        Text(text)
            .font(PastaToolbarAppearance.font)
            .foregroundStyle(PastaToolbarAppearance.foreground)
            .lineLimit(1)
            .truncationMode(.tail)
            .padding(.horizontal, 14)
            .frame(minWidth: 116, maxWidth: 240)
            .frame(height: PastaToolbarAppearance.shelfHeight)
            .background(Color.clear)
    }

    private func actionButton(
        title: String,
        systemImage: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Label {
                Text(title)
            } icon: {
                Image(systemName: systemImage)
            }
            .font(PastaToolbarAppearance.font)
            .labelStyle(.titleAndIcon)
            .padding(.horizontal, 13)
            .lineLimit(1)
            .frame(height: PastaToolbarAppearance.shelfHeight)
            .frame(minWidth: 132)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .allowsHitTesting(isEnabled)
        .background(Color.clear)
    }

    private var pasteMenu: some View {
        Menu {
            if model.visibleClips.isEmpty {
                Button("No Pasta history") {}
                    .disabled(true)
            } else {
                ForEach(model.visibleClips, id: \.sequence) { clip in
                    Button(clip.title) {
                        insertClip(clip.text)
                    }
                }
            }
        } label: {
            Label {
                Text("Paste")
            } icon: {
                Image(systemName: "doc.on.clipboard")
            }
                .font(PastaToolbarAppearance.font)
                .labelStyle(.titleAndIcon)
                .padding(.horizontal, 13)
                .lineLimit(1)
                .frame(height: PastaToolbarAppearance.shelfHeight)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PastaToolbarAppearance.foreground)
        .background(Color.clear)
    }

    private var divider: some View {
        PastaToolbarAppearance.separator
            .frame(width: 1, height: PastaToolbarAppearance.separatorHeight)
            .background(Color.clear)
    }
}

private enum PastaToolbarAppearance {
    /// Match KeyboardKit's standard autocomplete row height so the Pasta actions
    /// sit in the native toolbar slot instead of creating a taller custom band.
    static let foreground = Color.keyboardButtonForeground
    static let separator = Color.keyboardButtonForeground.opacity(0.20)
    static let shelfHeight: CGFloat = 48
    static let separatorHeight: CGFloat = 30

    static var font: Font { .system(size: 17, weight: .semibold) }
    static let keyboardSurface = Color.keyboardBackground
    static let uiKeyboardSurface = UIColor { traits in
        switch traits.userInterfaceStyle {
        case .dark:
            return UIColor(red: 0.173, green: 0.173, blue: 0.173, alpha: 1)
        default:
            return UIColor(red: 0.835, green: 0.839, blue: 0.867, alpha: 1)
        }
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
        insertClip: { _ in },
        publish: {}
    )
    .frame(width: 393, height: 60)
    .background(Color.keyboardBackground)
}
#endif
