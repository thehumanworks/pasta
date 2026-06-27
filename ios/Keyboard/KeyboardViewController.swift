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
        view.isOpaque = true
        view.backgroundColor = PastaToolbarAppearance.uiShelfBackground
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

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        // KeyboardKit's hosting controller defaults to a clear root view, which lets the
        // host app bleed through any unpainted SwiftUI pixels in the toolbar band.
        for child in children {
            child.view.isOpaque = true
            child.view.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        }
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
                Keyboard.Toolbar {
                    PastaKeyboardToolbarRepresentable(
                        model: toolbarModel,
                        insertClip: insertClip,
                        refresh: refresh,
                        publish: publish,
                        toggleExpanded: toggleExpanded
                    )
                }
            }
        )
        .keyboardViewStyle(.init(background: .color(.keyboardBackground)))
        .autocompleteToolbarStyle(.init(height: PastaToolbarAppearance.shelfHeight, padding: 0))
        .keyboardToolbarStyle(.init(
            backgroundColor: PastaToolbarAppearance.shelfBackground,
            height: PastaToolbarAppearance.shelfHeight,
            minHeight: PastaToolbarAppearance.shelfHeight
        ))
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

private struct PastaKeyboardToolbarRepresentable: UIViewRepresentable {
    let model: PastaKeyboardToolbarModel
    let insertClip: (String) -> Void
    let refresh: () -> Void
    let publish: () -> Void
    let toggleExpanded: () -> Void

    func makeUIView(context: Context) -> PastaToolbarUIView {
        let view = PastaToolbarUIView()
        view.apply(
            model: model,
            actions: PastaToolbarUIView.Actions(
                insertClip: insertClip,
                refresh: refresh,
                publish: publish,
                toggleExpanded: toggleExpanded
            )
        )
        return view
    }

    func updateUIView(_ uiView: PastaToolbarUIView, context: Context) {
        uiView.apply(
            model: model,
            actions: PastaToolbarUIView.Actions(
                insertClip: insertClip,
                refresh: refresh,
                publish: publish,
                toggleExpanded: toggleExpanded
            )
        )
    }
}

@MainActor
private final class PastaToolbarUIView: UIView {
    struct Actions {
        let insertClip: (String) -> Void
        let refresh: () -> Void
        let publish: () -> Void
        let toggleExpanded: () -> Void
    }

    private let bleedView = UIView()
    private let scrollView = UIScrollView()
    private let stackView = UIStackView()
    private var actions = Actions(
        insertClip: { _ in },
        refresh: {},
        publish: {},
        toggleExpanded: {}
    )

    override init(frame: CGRect) {
        super.init(frame: frame)
        isOpaque = true
        backgroundColor = PastaToolbarAppearance.uiShelfBackground

        bleedView.isOpaque = true
        bleedView.backgroundColor = PastaToolbarAppearance.uiShelfBackground

        scrollView.isOpaque = true
        scrollView.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        scrollView.showsHorizontalScrollIndicator = false
        scrollView.alwaysBounceHorizontal = true
        scrollView.contentInsetAdjustmentBehavior = .never
        scrollView.contentInset = .zero
        scrollView.scrollIndicatorInsets = .zero

        stackView.axis = .horizontal
        stackView.alignment = .center
        stackView.spacing = 0
        stackView.isOpaque = true
        stackView.backgroundColor = PastaToolbarAppearance.uiShelfBackground

        addSubview(bleedView)
        addSubview(scrollView)
        scrollView.addSubview(stackView)

        bleedView.translatesAutoresizingMaskIntoConstraints = false
        scrollView.translatesAutoresizingMaskIntoConstraints = false
        stackView.translatesAutoresizingMaskIntoConstraints = false

        NSLayoutConstraint.activate([
            bleedView.leadingAnchor.constraint(equalTo: leadingAnchor),
            bleedView.trailingAnchor.constraint(equalTo: trailingAnchor),
            bleedView.topAnchor.constraint(equalTo: topAnchor, constant: -PastaToolbarAppearance.topBleed),
            bleedView.heightAnchor.constraint(equalToConstant: PastaToolbarAppearance.shelfHeight + PastaToolbarAppearance.topBleed),

            scrollView.leadingAnchor.constraint(equalTo: leadingAnchor),
            scrollView.trailingAnchor.constraint(equalTo: trailingAnchor),
            scrollView.topAnchor.constraint(equalTo: topAnchor),
            scrollView.bottomAnchor.constraint(equalTo: bottomAnchor),

            stackView.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor),
            stackView.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor),
            stackView.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor),
            stackView.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor),
            stackView.heightAnchor.constraint(equalTo: scrollView.frameLayoutGuide.heightAnchor)
        ])
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    func apply(model: PastaKeyboardToolbarModel, actions: Actions) {
        self.actions = actions
        rebuild(model: model)
    }

    private func rebuild(model: PastaKeyboardToolbarModel) {
        stackView.arrangedSubviews.forEach { view in
            stackView.removeArrangedSubview(view)
            view.removeFromSuperview()
        }

        if let statusMessage = model.statusMessage {
            stackView.addArrangedSubview(makeStatusLabel(statusMessage))
            stackView.addArrangedSubview(makeDivider())
        }

        stackView.addArrangedSubview(makeActionButton(
            title: "Refresh",
            systemImage: "arrow.clockwise",
            isEnabled: !model.isRunningLiveAction,
            action: actions.refresh
        ))
        stackView.addArrangedSubview(makeDivider())
        stackView.addArrangedSubview(makeActionButton(
            title: "Publish",
            systemImage: "square.and.arrow.up",
            isEnabled: !model.isRunningLiveAction,
            action: actions.publish
        ))
        stackView.addArrangedSubview(makeDivider())
        stackView.addArrangedSubview(makeActionButton(
            title: model.showsExpandedHistory ? "Less" : "All",
            systemImage: model.showsExpandedHistory ? "chevron.up" : "list.bullet",
            isEnabled: true,
            action: actions.toggleExpanded
        ))

        if model.clips.isEmpty {
            stackView.addArrangedSubview(makeDivider())
            stackView.addArrangedSubview(makeStatusLabel("Open Pasta to sync"))
        } else {
            for clip in model.visibleClips {
                stackView.addArrangedSubview(makeDivider())
                stackView.addArrangedSubview(makeClipButton(clip: clip))
            }
        }
    }

    private func makeStatusLabel(_ text: String) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = PastaToolbarAppearance.uiFont
        label.textColor = PastaToolbarAppearance.uiForeground
        label.lineBreakMode = .byTruncatingTail
        label.setContentHuggingPriority(.defaultLow, for: .horizontal)

        let container = UIView()
        container.isOpaque = true
        container.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        container.addSubview(label)
        label.translatesAutoresizingMaskIntoConstraints = false
        container.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: 14),
            label.trailingAnchor.constraint(equalTo: container.trailingAnchor, constant: -14),
            label.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            container.heightAnchor.constraint(equalToConstant: PastaToolbarAppearance.shelfHeight)
        ])
        return container
    }

    private func makeDivider() -> UIView {
        let divider = UIView()
        divider.isOpaque = true
        divider.backgroundColor = PastaToolbarAppearance.uiSeparator
        divider.translatesAutoresizingMaskIntoConstraints = false
        divider.widthAnchor.constraint(equalToConstant: 1).isActive = true
        divider.heightAnchor.constraint(equalToConstant: PastaToolbarAppearance.separatorHeight).isActive = true
        return divider
    }

    private func makeActionButton(
        title: String,
        systemImage: String,
        isEnabled: Bool,
        action: @escaping () -> Void
    ) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.title = title
        configuration.image = UIImage(systemName: systemImage, withConfiguration: PastaToolbarAppearance.uiSymbolConfiguration)
        configuration.imagePadding = 5
        configuration.baseForegroundColor = PastaToolbarAppearance.uiForeground
        configuration.background.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 13, bottom: 0, trailing: 13)
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = PastaToolbarAppearance.uiFont
            return outgoing
        }

        let button = UIButton(configuration: configuration)
        button.isOpaque = true
        button.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        button.isUserInteractionEnabled = isEnabled
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(equalToConstant: PastaToolbarAppearance.shelfHeight).isActive = true
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func makeClipButton(clip: PastaKeyboardClip) -> UIButton {
        var configuration = UIButton.Configuration.plain()
        configuration.title = clip.title
        configuration.baseForegroundColor = PastaToolbarAppearance.uiForeground
        configuration.background.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 16, bottom: 0, trailing: 16)
        configuration.titleLineBreakMode = .byTruncatingTail
        configuration.titleTextAttributesTransformer = UIConfigurationTextAttributesTransformer { incoming in
            var outgoing = incoming
            outgoing.font = PastaToolbarAppearance.uiFont
            return outgoing
        }

        let button = UIButton(configuration: configuration)
        button.isOpaque = true
        button.backgroundColor = PastaToolbarAppearance.uiShelfBackground
        button.translatesAutoresizingMaskIntoConstraints = false
        button.heightAnchor.constraint(equalToConstant: PastaToolbarAppearance.shelfHeight).isActive = true
        button.widthAnchor.constraint(lessThanOrEqualToConstant: 220).isActive = true
        let clipText = clip.text
        button.addAction(UIAction { [weak self] _ in
            self?.actions.insertClip(clipText)
        }, for: .touchUpInside)
        return button
    }
}

private enum PastaToolbarAppearance {
    /// 60pt band (~25% taller than KeyboardKit's 48pt autocomplete default) for readable,
    /// full-height action targets. Shelf and segments stay fully opaque so host content
    /// cannot bleed through and make labels look blurred.
    static let shelfBackground = Color.keyboardBackground
    static let foreground = Color.keyboardButtonForeground
    static let separator = Color.keyboardButtonForeground.opacity(0.20)
    static let shelfHeight: CGFloat = 60
    static let separatorHeight: CGFloat = 36
    /// Paints the seam above the shelf where the extension host leaves a narrow strip.
    static let topBleed: CGFloat = 10

    static var uiShelfBackground: UIColor { UIColor(Color.keyboardBackground) }
    static var uiForeground: UIColor { UIColor(Color.keyboardButtonForeground) }
    static var uiSeparator: UIColor { uiForeground.withAlphaComponent(0.20) }
    static var uiFont: UIFont { .systemFont(ofSize: 17, weight: .semibold) }
    static var uiSymbolConfiguration: UIImage.SymbolConfiguration {
        UIImage.SymbolConfiguration(font: uiFont, scale: .medium)
    }
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
    PastaKeyboardToolbarRepresentable(
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
