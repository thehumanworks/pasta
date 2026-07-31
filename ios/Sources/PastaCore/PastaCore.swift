import Foundation

public enum PastaCore {
    public static let bootstrapVersion = "0.2.0-ios-keyboard"
    public static let protocolVersion = "0.1.19"
    public static let signingVersion = "PASTA-SIGN-V1"
    public static let directoryBundleMIME = "application/vnd.pasta.directory+zip"
    public static let appGroupIdentifier = "group.com.thehumanworks.pasta"
    public static let keychainAccessGroup = "54MXM5JG3R.com.thehumanworks.pasta"
    public static let defaultEndpoint = URL(string: "https://pasta.nothuman.work")!
    public static let minimumSupportedIOSMajorVersion = 17
    public static let textMime = "text/plain; charset=utf-8"
    public static let secretMime = "application/vnd.pasta.secret+json"
    public static let passkeySecretPbkdf2Iterations = 210_000
    public static let passkeySecretSaltBytes = 16
    public static let passkeySecretKeyBytes = 32
    public static let defaultHistoryLimit = 20
    public static let largePayloadMaxBytes = 50 * 1024 * 1024
}

public enum PastaIOSSurface: String, CaseIterable, Sendable {
    case app
    case keyboardExtension
    case shareExtension
    case appIntents
    case fileProvider
}

public enum PastaResolvedClipKind: Equatable, Sendable {
    case text
    case image
    case file
    case directoryBundle
    case secret

    public static func resolve(payloadKind: String, mime: String) -> PastaResolvedClipKind {
        if mime == PastaCore.directoryBundleMIME {
            return .directoryBundle
        }
        switch payloadKind {
        case "text":
            return .text
        case "image":
            return .image
        case "secret":
            return .secret
        default:
            return .file
        }
    }
}

public enum PastaKeyboardAction: Equatable, Sendable {
    case insertText
    case unlockSecret
    case handoff
}

public enum PastaClipInsertability {
    public static func keyboardAction(for kind: PastaResolvedClipKind) -> PastaKeyboardAction {
        switch kind {
        case .text:
            return .insertText
        case .secret:
            return .unlockSecret
        case .image, .file, .directoryBundle:
            return .handoff
        }
    }
}

public struct PastaKeyboardSecret: Codable, Equatable, Identifiable, Sendable {
    public var id: String { clipId }
    public let clipId: String
    public let sequence: Int
    public let key: String
    public let createdAt: Int64

    public init(clipId: String, sequence: Int, key: String, createdAt: Int64) {
        self.clipId = clipId
        self.sequence = sequence
        self.key = key
        self.createdAt = createdAt
    }
}

public struct PastaKeyboardClip: Codable, Equatable, Identifiable, Sendable {
    public var id: String { clipId }
    public let clipId: String
    public let sequence: Int
    public let title: String
    public let text: String
    public let createdAt: Int64

    public init(clipId: String, sequence: Int, title: String, text: String, createdAt: Int64) {
        self.clipId = clipId
        self.sequence = sequence
        self.title = title
        self.text = text
        self.createdAt = createdAt
    }
}

public struct PastaHistoryEntry: Codable, Equatable, Identifiable, Sendable {
    public var id: String { clipId }
    public let clipId: String
    public let sequence: Int
    public let payloadKind: String
    public let mime: String
    public let byteLen: Int
    public let title: String
    public let preview: String
    public let text: String?
    public let createdAt: Int64

    public var resolvedKind: PastaResolvedClipKind {
        PastaResolvedClipKind.resolve(payloadKind: payloadKind, mime: mime)
    }

    public var kindLabel: String {
        switch resolvedKind {
        case .text:
            return "Text"
        case .image:
            return "Image"
        case .file:
            return "File"
        case .directoryBundle:
            return "Directory"
        case .secret:
            return "Secret"
        }
    }

    public var isKeyboardInsertable: Bool {
        text != nil && resolvedKind == .text
    }

    public var keyboardSecret: PastaKeyboardSecret? {
        guard resolvedKind == .secret else { return nil }
        let key = metadataName ?? title
        return PastaKeyboardSecret(clipId: clipId, sequence: sequence, key: key, createdAt: createdAt)
    }

    public var isExportable: Bool {
        switch resolvedKind {
        case .image, .file, .directoryBundle:
            return true
        case .text, .secret:
            return false
        }
    }

    public var keyboardClip: PastaKeyboardClip? {
        guard let text, isKeyboardInsertable else { return nil }
        return PastaKeyboardClip(
            clipId: clipId,
            sequence: sequence,
            title: title,
            text: text,
            createdAt: createdAt
        )
    }

    public let metadataName: String?

    public init(
        clipId: String,
        sequence: Int,
        payloadKind: String,
        mime: String,
        byteLen: Int,
        title: String,
        preview: String,
        text: String?,
        createdAt: Int64,
        metadataName: String? = nil
    ) {
        self.clipId = clipId
        self.sequence = sequence
        self.payloadKind = payloadKind
        self.mime = mime
        self.byteLen = byteLen
        self.title = title
        self.preview = preview
        self.text = text
        self.createdAt = createdAt
        self.metadataName = metadataName
    }

    public init(clip: StoredClip, decryptedText: String?, metadataName: String? = nil) {
        let resolvedKind = PastaResolvedClipKind.resolve(payloadKind: clip.payloadKind, mime: clip.mime)
        let textPreview = decryptedText?.pastaSingleLinePreview(maxLength: 96)
        let fileName = metadataName.map { PastaFileNames.exportName(metadataName: $0, payloadKind: clip.payloadKind, mime: clip.mime) }
        let secretTitle = resolvedKind == .secret ? "Secret: \(metadataName ?? "unnamed")" : nil
        self.init(
            clipId: clip.clipId,
            sequence: clip.seq,
            payloadKind: clip.payloadKind,
            mime: clip.mime,
            byteLen: clip.byteLen,
            title: decryptedText?.pastaSingleLineTitle(maxLength: 48) ?? secretTitle ?? fileName ?? Self.title(for: resolvedKind, sequence: clip.seq),
            preview: textPreview ?? Self.preview(for: resolvedKind, mime: clip.mime, byteLen: clip.byteLen, metadataName: metadataName),
            text: resolvedKind == .text ? decryptedText : nil,
            createdAt: clip.createdAt,
            metadataName: metadataName
        )
    }

    public static func keyboardClips(from entries: [PastaHistoryEntry]) -> [PastaKeyboardClip] {
        entries.compactMap(\.keyboardClip)
    }

    public static func keyboardSecrets(from entries: [PastaHistoryEntry]) -> [PastaKeyboardSecret] {
        entries.compactMap(\.keyboardSecret)
    }

    private static func title(for kind: PastaResolvedClipKind, sequence: Int) -> String {
        switch kind {
        case .text:
            return "Text clip \(sequence)"
        case .image:
            return "Image clip \(sequence)"
        case .file:
            return "File clip \(sequence)"
        case .directoryBundle:
            return "Directory clip \(sequence)"
        case .secret:
            return "Secret clip \(sequence)"
        }
    }

    private static func preview(for kind: PastaResolvedClipKind, mime: String, byteLen: Int, metadataName: String? = nil) -> String {
        let size = "\(byteLen) bytes"
        switch kind {
        case .text:
            return "Encrypted text"
        case .secret:
            return "Passkey-protected secret\(metadataName.map { " \($0)" } ?? "")"
        case .image, .file, .directoryBundle:
            return "\(mime) - \(size)"
        }
    }
}

private extension String {
    func pastaSingleLineTitle(maxLength: Int) -> String {
        let compact = pastaSingleLinePreview(maxLength: maxLength)
        return compact.isEmpty ? "Text clip" : compact
    }

    func pastaSingleLinePreview(maxLength: Int) -> String {
        let compact = replacingOccurrences(of: "\n", with: " ")
        return String(compact.prefix(maxLength))
    }
}
