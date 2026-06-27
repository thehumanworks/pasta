import Foundation

public enum PastaCore {
    public static let bootstrapVersion = "0.2.0-ios-keyboard"
    public static let protocolVersion = "0.1.7"
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
    public var id: Int { sequence }
    public let sequence: Int
    public let title: String
    public let text: String
    public let createdAt: Int64

    public init(sequence: Int, title: String, text: String, createdAt: Int64) {
        self.sequence = sequence
        self.title = title
        self.text = text
        self.createdAt = createdAt
    }
}

public struct PastaHistoryClip: Codable, Equatable, Identifiable, Sendable {
    public var id: String { clipId }
    public let seq: Int
    public let clipId: String
    public let title: String
    public let payloadKind: String
    public let mime: String
    public let byteLen: Int
    public let createdAt: Int64
    public let text: String?

    public var resolvedKind: PastaResolvedClipKind {
        if payloadKind == "text" { return .text }
        if payloadKind == "image" { return .image }
        if payloadKind == "file", mime == PastaCore.directoryBundleMIME { return .directoryBundle }
        return .file
    }

    public var isExportable: Bool {
        switch resolvedKind {
        case .image, .file, .directoryBundle:
            return true
        case .text:
            return false
        }
    }

    public init(
        seq: Int,
        clipId: String,
        title: String,
        payloadKind: String,
        mime: String,
        byteLen: Int,
        createdAt: Int64,
        text: String? = nil
    ) {
        self.seq = seq
        self.clipId = clipId
        self.title = title
        self.payloadKind = payloadKind
        self.mime = mime
        self.byteLen = byteLen
        self.createdAt = createdAt
        self.text = text
    }
}
