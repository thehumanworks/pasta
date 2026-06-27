public enum PastaCore {
    public static let bootstrapVersion = "0.1.0-ios-bootstrap"
    public static let directoryBundleMIME = "application/vnd.pasta.directory+zip"
    public static let appGroupIdentifier = "group.com.thehumanworks.pasta"
    public static let minimumSupportedIOSMajorVersion = 17
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
