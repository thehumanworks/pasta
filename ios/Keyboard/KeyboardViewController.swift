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
        view.backgroundColor = .clear
        enableExperimentalKeyboardTypeChangeTracking()
        reloadClips()
        setup(for: .pasta) { [weak self] _ in
            guard let self else { return }
            services.keyboardBehavior = PastaKeyboardBehavior(
                keyboardContext: state.keyboardContext,
                repeatGestureTimer: services.repeatGestureTimer
            )
            services.layoutService = PastaKeyboardLayoutService()
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
        VStack(spacing: 0) {
            PastaKeyboardToolbar(
                model: toolbarModel,
                insertClip: insertClip,
                refresh: refresh,
                publish: publish,
                toggleExpanded: toggleExpanded
            )

            KeyboardView(
                layout: pastaLayout,
                state: state,
                services: services,
                renderBackground: false,
                buttonContent: { $0.view },
                buttonView: { $0.view },
                collapsedView: { $0.view },
                emojiKeyboard: { $0.view },
                toolbar: { _ in EmptyView() }
            )
            .autocompleteToolbarStyle(.init(height: 0, padding: 0))
            .keyboardInputToolbarDisplayMode(.none)
            .id(keyboardLayoutIdentifier)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(PastaToolbarAppearance.shelfBackground.ignoresSafeArea())
        .ignoresSafeArea(.container, edges: [.top, .bottom])
    }

    private var pastaLayout: KeyboardLayout {
        services.layoutService.keyboardLayout(for: keyboardContext)
    }

    private var keyboardLayoutIdentifier: String {
        [
            "\(keyboardContext.keyboardType)",
            keyboardContext.keyboardCase.rawValue,
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
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                if let statusMessage = model.statusMessage {
                    Text(statusMessage)
                        .font(PastaToolbarAppearance.font)
                        .foregroundStyle(PastaToolbarAppearance.foreground)
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .frame(height: PastaToolbarAppearance.chipHeight)
                        .background(PastaToolbarAppearance.chipBackground)
                        .overlay(PastaToolbarAppearance.chipBorder)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                }

                Button(action: refresh) {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .allowsHitTesting(!model.isRunningLiveAction)
                .buttonStyle(PastaToolbarButtonStyle())

                Button(action: publish) {
                    Label("Publish", systemImage: "square.and.arrow.up")
                }
                .allowsHitTesting(!model.isRunningLiveAction)
                .buttonStyle(PastaToolbarButtonStyle())

                Button(action: toggleExpanded) {
                    Label(model.showsExpandedHistory ? "Less" : "All", systemImage: model.showsExpandedHistory ? "chevron.up" : "list.bullet")
                }
                .buttonStyle(PastaToolbarButtonStyle())

                if model.clips.isEmpty {
                    Text("Open Pasta to sync")
                        .font(PastaToolbarAppearance.font)
                        .foregroundStyle(PastaToolbarAppearance.foreground)
                        .lineLimit(1)
                        .padding(.horizontal, 12)
                        .frame(height: PastaToolbarAppearance.chipHeight)
                        .background(PastaToolbarAppearance.chipBackground)
                        .overlay(PastaToolbarAppearance.chipBorder)
                        .clipShape(RoundedRectangle(cornerRadius: 7))
                } else {
                    ForEach(model.visibleClips) { clip in
                        Button {
                            insertClip(clip.text)
                        } label: {
                            Text(clip.title)
                                .lineLimit(1)
                        }
                        .buttonStyle(PastaToolbarButtonStyle())
                    }
                }
            }
            .padding(.horizontal, 6)
        }
        .frame(height: PastaToolbarAppearance.shelfHeight)
        .background(PastaToolbarAppearance.shelfBackground)
        .clipped()
    }
}

private struct PastaToolbarButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(PastaToolbarAppearance.font)
            .foregroundStyle(PastaToolbarAppearance.foreground)
            .lineLimit(1)
            .labelStyle(.titleAndIcon)
            .padding(.horizontal, 10)
            .frame(height: PastaToolbarAppearance.chipHeight)
            .background(configuration.isPressed ? PastaToolbarAppearance.pressedChipBackground : PastaToolbarAppearance.chipBackground)
            .overlay(PastaToolbarAppearance.chipBorder)
            .clipShape(RoundedRectangle(cornerRadius: 7))
            .contentShape(RoundedRectangle(cornerRadius: 7))
    }
}

private enum PastaToolbarAppearance {
    static let shelfBackground = Color.keyboardBackground
    static let chipBackground = Color.keyboardButtonBackground
    static let pressedChipBackground = Color.keyboardDarkButtonBackground
    static let foreground = Color.keyboardButtonForeground
    static let border = Color.black.opacity(0.14)
    static let font = Font.system(size: 15, weight: .semibold)
    static let shelfHeight: CGFloat = 36
    static let chipHeight: CGFloat = 31

    static var chipBorder: some View {
        RoundedRectangle(cornerRadius: 7).stroke(border, lineWidth: 1)
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

private final class PastaKeyboardLayoutService: KeyboardLayoutService {
    private let baseService = KeyboardLayout.StandardLayoutService()

    func keyboardLayout(for context: KeyboardContext) -> KeyboardLayout {
        var layout = baseService.keyboardLayout(for: context)
        layout.itemRows.remove(.nextKeyboard)
        return layout
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
