import Foundation

public enum PastaKeyboardCaseMode: String, CaseIterable, Sendable {
    case auto
    case capsLocked
    case lowercased
    case uppercased

    public var usesUppercaseCharacters: Bool {
        switch self {
        case .auto, .lowercased:
            return false
        case .uppercased, .capsLocked:
            return true
        }
    }

    public func transformedCharacter(_ character: String) -> String {
        usesUppercaseCharacters ? character.uppercased() : character.lowercased()
    }

    public func caseAfterInsertedCharacter(autocapitalizesAllCharacters: Bool) -> PastaKeyboardCaseMode {
        if self == .capsLocked { return .capsLocked }
        return autocapitalizesAllCharacters ? .uppercased : .lowercased
    }
}

public struct PastaKeyboardLayoutSignature: Equatable, Sendable {
    public let keyboardType: String
    public let keyboardCase: PastaKeyboardCaseMode
    public let interfaceOrientation: String
    public let screenWidth: Int
    public let screenHeight: Int
    public let deviceType: String
    public let needsInputModeSwitchKey: Bool
    public let localeIdentifier: String

    public init(
        keyboardType: String,
        keyboardCase: PastaKeyboardCaseMode,
        interfaceOrientation: String,
        screenWidth: Int,
        screenHeight: Int,
        deviceType: String,
        needsInputModeSwitchKey: Bool,
        localeIdentifier: String
    ) {
        self.keyboardType = keyboardType
        self.keyboardCase = keyboardCase
        self.interfaceOrientation = interfaceOrientation
        self.screenWidth = screenWidth
        self.screenHeight = screenHeight
        self.deviceType = deviceType
        self.needsInputModeSwitchKey = needsInputModeSwitchKey
        self.localeIdentifier = localeIdentifier
    }
}
