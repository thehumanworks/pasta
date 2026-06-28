import Foundation

public enum PastaCore {
    public static let bootstrapVersion = "0.2.0-ios-keyboard"
    public static let protocolVersion = "0.1.16"
    public static let signingVersion = "PASTA-SIGN-V1"
    public static let directoryBundleMIME = "application/vnd.pasta.directory+zip"
    public static let appGroupIdentifier = "group.com.thehumanworks.pasta"
    public static let keychainAccessGroup = "54MXM5JG3R.com.thehumanworks.pasta"
    public static let defaultEndpoint = URL(string: "https://pasta.nothuman.work")!
    public static let minimumSupportedIOSMajorVersion = 17
    public static let textMime = "text/plain; charset=utf-8"
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

    public static func resolve(payloadKind: String, mime: String) -> PastaResolvedClipKind {
        if mime == PastaCore.directoryBundleMIME {
            return .directoryBundle
        }
        switch payloadKind {
        case "text":
            return .text
        case "image":
            return .image
        default:
            return .file
        }
    }
}

public enum PastaKeyboardAction: Equatable, Sendable {
    case insertText
    case handoff
}

public enum PastaClipInsertability {
    public static func keyboardAction(for kind: PastaResolvedClipKind) -> PastaKeyboardAction {
        switch kind {
        case .text:
            return .insertText
        case .image, .file, .directoryBundle:
            return .handoff
        }
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
        }
    }

    public var isKeyboardInsertable: Bool {
        text != nil && resolvedKind == .text
    }

    public var isExportable: Bool {
        switch resolvedKind {
        case .image, .file, .directoryBundle:
            return true
        case .text:
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

    public init(
        clipId: String,
        sequence: Int,
        payloadKind: String,
        mime: String,
        byteLen: Int,
        title: String,
        preview: String,
        text: String?,
        createdAt: Int64
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
    }

    public init(clip: StoredClip, decryptedText: String?, metadataName: String? = nil) {
        let resolvedKind = PastaResolvedClipKind.resolve(payloadKind: clip.payloadKind, mime: clip.mime)
        let textPreview = decryptedText?.pastaSingleLinePreview(maxLength: 96)
        let fileName = metadataName.map { PastaFileNames.exportName(metadataName: $0, payloadKind: clip.payloadKind, mime: clip.mime) }
        self.init(
            clipId: clip.clipId,
            sequence: clip.seq,
            payloadKind: clip.payloadKind,
            mime: clip.mime,
            byteLen: clip.byteLen,
            title: decryptedText?.pastaSingleLineTitle(maxLength: 48) ?? fileName ?? Self.title(for: resolvedKind, sequence: clip.seq),
            preview: textPreview ?? Self.preview(for: resolvedKind, mime: clip.mime, byteLen: clip.byteLen),
            text: resolvedKind == .text ? decryptedText : nil,
            createdAt: clip.createdAt
        )
    }

    public static func keyboardClips(from entries: [PastaHistoryEntry]) -> [PastaKeyboardClip] {
        entries.compactMap(\.keyboardClip)
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
        }
    }

    private static func preview(for kind: PastaResolvedClipKind, mime: String, byteLen: Int) -> String {
        let size = "\(byteLen) bytes"
        switch kind {
        case .text:
            return "Encrypted text"
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
