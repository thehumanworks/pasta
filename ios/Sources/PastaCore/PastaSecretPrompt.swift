import Foundation

/// What the keyboard should do once the prompt collects its values.
public enum PastaSecretPromptIntent: Equatable, Sendable {
    case setFromClipboard
    case unlock(clipId: String, key: String)
}

/// The value the prompt is currently collecting.
public enum PastaSecretPromptStep: String, Equatable, Sendable {
    case keyPath
    case passkey
}

public struct PastaSecretPromptSubmission: Equatable, Sendable {
    public let intent: PastaSecretPromptIntent
    public let keyPath: String
    public let passkey: String

    public init(intent: PastaSecretPromptIntent, keyPath: String, passkey: String) {
        self.intent = intent
        self.keyPath = keyPath
        self.passkey = passkey
    }
}

public enum PastaSecretPromptKeyResult: Equatable, Sendable {
    case updated
    case submitRequested
}

public enum PastaSecretPromptAdvance: Equatable, Sendable {
    case awaitingPasskey
    case ready(PastaSecretPromptSubmission)
}

public enum PastaSecretPromptError: Error, Equatable, Sendable {
    case emptyKeyPath
    case invalidKeyPath
    case emptyPasskey

    public var message: String {
        switch self {
        case .emptyKeyPath:
            return "Enter a secret key path."
        case .invalidKeyPath:
            return "Use KEY or production/tool/KEY."
        case .emptyPasskey:
            return "Enter the passkey."
        }
    }
}

/// Collects a secret key path and passkey from inside the keyboard extension.
///
/// A custom keyboard cannot present `UIAlertController` and cannot host a
/// `UITextField` without breaking its own responder chain and text document
/// proxy, so Pasta renders the prompt in its own view and routes key presses
/// into this state machine. Values stay in memory: the passkey is never
/// published, cached, or exposed to autocomplete.
public struct PastaSecretPrompt: Equatable, Sendable {
    public static let maximumFieldLength = 256

    public let intent: PastaSecretPromptIntent
    public private(set) var step: PastaSecretPromptStep
    public private(set) var keyPath: String
    public private(set) var passkey: String

    public init(intent: PastaSecretPromptIntent) {
        self.intent = intent
        switch intent {
        case .setFromClipboard:
            step = .keyPath
            keyPath = ""
        case .unlock(_, let key):
            step = .passkey
            keyPath = key
        }
        passkey = ""
    }

    public var title: String {
        switch intent {
        case .setFromClipboard:
            return "Set Secret"
        case .unlock:
            return "Unlock Secret"
        }
    }

    public var caption: String {
        switch step {
        case .keyPath:
            return "Key path"
        case .passkey:
            return keyPath.isEmpty ? "Passkey" : "Passkey for \(keyPath)"
        }
    }

    public var placeholder: String {
        switch step {
        case .keyPath:
            return "KEY or production/tool/KEY"
        case .passkey:
            return "Type the passkey"
        }
    }

    /// The passkey is masked so it never renders above the keys.
    public var displayValue: String {
        switch step {
        case .keyPath:
            return keyPath
        case .passkey:
            return String(repeating: "•", count: passkey.count)
        }
    }

    public var isCurrentFieldEmpty: Bool {
        currentField.isEmpty
    }

    public var submitTitle: String {
        switch (step, intent) {
        case (.keyPath, _):
            return "Next"
        case (.passkey, .setFromClipboard):
            return "Save"
        case (.passkey, .unlock):
            return "Insert"
        }
    }

    /// Applies one key press. Returns `.submitRequested` for the return key.
    public mutating func insert(_ text: String) -> PastaSecretPromptKeyResult {
        guard !text.isEmpty else { return .updated }
        if text.contains(where: \.isNewline) {
            let leading = text.prefix { !$0.isNewline }
            append(String(leading))
            return .submitRequested
        }
        append(text)
        return .updated
    }

    public mutating func deleteBackward() {
        switch step {
        case .keyPath:
            if !keyPath.isEmpty { keyPath.removeLast() }
        case .passkey:
            if !passkey.isEmpty { passkey.removeLast() }
        }
    }

    /// Confirms the current field: key paths advance, passkeys complete.
    public mutating func advance() throws -> PastaSecretPromptAdvance {
        switch step {
        case .keyPath:
            let trimmed = keyPath.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { throw PastaSecretPromptError.emptyKeyPath }
            guard let normalized = try? PastaCrypto.normalizeSecretKey(trimmed) else {
                throw PastaSecretPromptError.invalidKeyPath
            }
            keyPath = normalized
            step = .passkey
            return .awaitingPasskey
        case .passkey:
            guard !passkey.isEmpty else { throw PastaSecretPromptError.emptyPasskey }
            return .ready(
                PastaSecretPromptSubmission(intent: intent, keyPath: keyPath, passkey: passkey)
            )
        }
    }

    private var currentField: String {
        switch step {
        case .keyPath:
            return keyPath
        case .passkey:
            return passkey
        }
    }

    private mutating func append(_ text: String) {
        switch step {
        case .keyPath:
            // Key paths never contain whitespace, so the space key is inert here
            // instead of producing a value that fails validation on submit.
            let filtered = text.filter { !$0.isWhitespace && !$0.isNewline }
            keyPath = Self.bounded(keyPath + filtered)
        case .passkey:
            let filtered = text.filter { !$0.isNewline }
            passkey = Self.bounded(passkey + filtered)
        }
    }

    private static func bounded(_ value: String) -> String {
        value.count <= maximumFieldLength ? value : String(value.prefix(maximumFieldLength))
    }
}
