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
