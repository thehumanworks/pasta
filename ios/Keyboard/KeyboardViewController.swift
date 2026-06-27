import PastaCore
import UIKit

@MainActor
final class KeyboardViewController: UIInputViewController {
    private var clips: [PastaKeyboardClip] = []
    private var isShifted = false
    private var showsExpandedHistory = false
    private var isRunningLiveAction = false
    private var statusMessage: String?
    private var heightConstraint: NSLayoutConstraint?
    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store = try? PastaAppGroupStore()
    private let letterRows = [
        ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
        ["a", "s", "d", "f", "g", "h", "j", "k", "l"]
    ]
    private let thirdLetterRow = ["z", "x", "c", "v", "b", "n", "m"]

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.systemGray6
        configureKeyboardHeight()
        reloadClips()
        renderKeyboard()
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        reloadClips()
        renderKeyboard()
    }

    private func reloadClips() {
        clips = store?.loadKeyboardClips() ?? []
    }

    private func renderKeyboard() {
        updateKeyboardHeight()
        view.subviews.forEach { $0.removeFromSuperview() }
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 7
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
            stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
            stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
            stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6)
        ])

        stack.addArrangedSubview(historyStrip())
        if showsExpandedHistory {
            stack.addArrangedSubview(expandedHistoryList())
        }
        for row in letterRows {
            stack.addArrangedSubview(keyRow(row.map { (isShifted ? $0.uppercased() : $0, CGFloat(1)) }))
        }
        let thirdRow = [("shift", CGFloat(1.35))]
            + thirdLetterRow.map { (isShifted ? $0.uppercased() : $0, CGFloat(1)) }
            + [("delete", CGFloat(1.35))]
        stack.addArrangedSubview(keyRow(thirdRow))
        stack.addArrangedSubview(keyRow([(",", 1.2), ("space", 5.5), (".", 1.2), ("return", 2.2)], height: 47))
    }

    private func configureKeyboardHeight() {
        guard heightConstraint == nil else { return }
        heightConstraint = view.heightAnchor.constraint(equalToConstant: preferredKeyboardHeight)
        heightConstraint?.priority = UILayoutPriority(999)
        heightConstraint?.isActive = true
    }

    private func updateKeyboardHeight() {
        heightConstraint?.constant = preferredKeyboardHeight
    }

    private var preferredKeyboardHeight: CGFloat {
        let isLandscape = UIScreen.main.bounds.width > UIScreen.main.bounds.height
        if showsExpandedHistory {
            return isLandscape ? 300 : 392
        }
        return isLandscape ? 216 : 291
    }

    private func historyStrip() -> UIView {
        let scroll = UIScrollView()
        scroll.showsHorizontalScrollIndicator = false
        let stack = UIStackView()
        stack.axis = .horizontal
        stack.spacing = 6
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.heightAnchor.constraint(equalTo: scroll.frameLayoutGuide.heightAnchor)
        ])

        if let statusMessage {
            stack.addArrangedSubview(statusPill(statusMessage))
        }
        stack.addArrangedSubview(actionButton(title: "Refresh", systemImage: "arrow.clockwise", accessibilityLabel: "Refresh Pasta history") { [weak self] in
            self?.refreshHistoryFromNetwork()
        })
        stack.addArrangedSubview(actionButton(title: "Publish", systemImage: "square.and.arrow.up", accessibilityLabel: "Publish iPhone clipboard to Pasta") { [weak self] in
            self?.publishClipboardText()
        })
        stack.addArrangedSubview(actionButton(title: showsExpandedHistory ? "Less" : "All", systemImage: showsExpandedHistory ? "chevron.up" : "list.bullet", accessibilityLabel: "Toggle Pasta history") { [weak self] in
            guard let self else { return }
            showsExpandedHistory.toggle()
            renderKeyboard()
        })
        if clips.isEmpty {
            stack.addArrangedSubview(historyButton(title: "Open Pasta to sync", text: nil))
        } else {
            for clip in clips.prefix(12) {
                stack.addArrangedSubview(historyButton(title: clip.title, text: clip.text))
            }
        }
        scroll.heightAnchor.constraint(equalToConstant: 38).isActive = true
        return scroll
    }

    private func expandedHistoryList() -> UIView {
        let scroll = UIScrollView()
        scroll.showsVerticalScrollIndicator = true
        let stack = UIStackView()
        stack.axis = .vertical
        stack.spacing = 5
        stack.translatesAutoresizingMaskIntoConstraints = false
        scroll.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor),
            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor)
        ])

        if clips.isEmpty {
            stack.addArrangedSubview(historyButton(title: "No cached Pasta text", text: nil))
        } else {
            for clip in clips.prefix(20) {
                stack.addArrangedSubview(historyButton(title: clip.title, text: clip.text))
            }
        }
        scroll.heightAnchor.constraint(equalToConstant: 104).isActive = true
        return scroll
    }

    private func keyRow(_ keys: [(String, CGFloat)], height: CGFloat = 46) -> UIStackView {
        let row = UIStackView()
        row.axis = .horizontal
        row.spacing = 6
        row.distribution = .fillProportionally
        for (key, weight) in keys {
            let container = WeightedKeyContainer(weight: weight)
            let button = keyButton(key)
            button.translatesAutoresizingMaskIntoConstraints = false
            container.addSubview(button)
            NSLayoutConstraint.activate([
                button.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                button.trailingAnchor.constraint(equalTo: container.trailingAnchor),
                button.topAnchor.constraint(equalTo: container.topAnchor),
                button.bottomAnchor.constraint(equalTo: container.bottomAnchor)
            ])
            row.addArrangedSubview(container)
        }
        row.heightAnchor.constraint(equalToConstant: height).isActive = true
        return row
    }

    private func statusPill(_ message: String) -> UILabel {
        let label = UILabel()
        label.text = message
        label.textAlignment = .center
        label.numberOfLines = 1
        label.font = UIFont.preferredFont(forTextStyle: .caption1)
        label.textColor = UIColor.secondaryLabel
        label.backgroundColor = UIColor.tertiarySystemBackground
        label.layer.cornerRadius = 7
        label.clipsToBounds = true
        label.setContentCompressionResistancePriority(.required, for: .horizontal)
        return label
    }

    private func historyButton(title: String, text: String?) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.baseBackgroundColor = UIColor.secondarySystemBackground
        configuration.baseForegroundColor = UIColor.label
        configuration.cornerStyle = .small
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 12, bottom: 0, trailing: 12)
        button.configuration = configuration
        button.titleLabel?.font = UIFont.preferredFont(forTextStyle: .footnote)
        button.accessibilityLabel = "Pasta clip \(title)"
        if let text {
            button.addAction(UIAction { [weak self] _ in
                self?.textDocumentProxy.insertText(text)
            }, for: .touchUpInside)
        } else {
            button.isEnabled = false
        }
        return button
    }

    private func actionButton(title: String, systemImage: String, accessibilityLabel: String, action: @escaping () -> Void) -> UIButton {
        let button = UIButton(type: .system)
        var configuration = UIButton.Configuration.filled()
        configuration.title = title
        configuration.image = UIImage(systemName: systemImage)
        configuration.imagePadding = 4
        configuration.baseBackgroundColor = UIColor.systemBackground
        configuration.baseForegroundColor = UIColor.label
        configuration.contentInsets = NSDirectionalEdgeInsets(top: 0, leading: 10, bottom: 0, trailing: 10)
        button.configuration = configuration
        button.titleLabel?.font = UIFont.preferredFont(forTextStyle: .footnote)
        button.accessibilityLabel = accessibilityLabel
        button.isEnabled = !isRunningLiveAction || title == "All" || title == "Less"
        button.addAction(UIAction { _ in action() }, for: .touchUpInside)
        return button
    }

    private func keyButton(_ key: String) -> UIButton {
        let button = UIButton(type: .system)
        button.setTitle(displayTitle(for: key), for: .normal)
        button.titleLabel?.font = key.count == 1
            ? UIFont.systemFont(ofSize: 22, weight: .regular)
            : UIFont.systemFont(ofSize: 16, weight: .regular)
        button.backgroundColor = key == "space" ? UIColor.white : backgroundColor(for: key)
        button.tintColor = UIColor.label
        button.layer.cornerRadius = 6
        button.accessibilityLabel = displayTitle(for: key)
        button.addAction(UIAction { [weak self] _ in
            self?.handle(key)
        }, for: .touchUpInside)
        return button
    }

    private func displayTitle(for key: String) -> String {
        switch key {
        case "space": return "space"
        case "delete": return "⌫"
        case "return": return "return"
        case "shift": return isShifted ? "⇧" : "⇧"
        default: return key
        }
    }

    private func backgroundColor(for key: String) -> UIColor {
        switch key {
        case "shift", "delete", "return":
            return UIColor.systemGray4
        default:
            return UIColor.secondarySystemBackground
        }
    }

    private func handle(_ key: String) {
        switch key {
        case "space":
            textDocumentProxy.insertText(" ")
        case "delete":
            textDocumentProxy.deleteBackward()
        case "return":
            textDocumentProxy.insertText("\n")
        case "shift":
            isShifted.toggle()
            renderKeyboard()
        default:
            textDocumentProxy.insertText(key)
            if isShifted {
                isShifted = false
                renderKeyboard()
            }
        }
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
        renderKeyboard()
        defer {
            isRunningLiveAction = false
            renderKeyboard()
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

private final class WeightedKeyContainer: UIView {
    private let weight: CGFloat

    init(weight: CGFloat) {
        self.weight = max(weight, 0.1)
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    override var intrinsicContentSize: CGSize {
        CGSize(width: weight * 44, height: UIView.noIntrinsicMetric)
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
