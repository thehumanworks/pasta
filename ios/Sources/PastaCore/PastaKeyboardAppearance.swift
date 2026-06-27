import Foundation

public enum PastaKeyboardInterfaceStyle: String, Sendable {
    case light
    case dark
}

public enum PastaKeyboardColorToken: Equatable, Sendable {
    case standard
    case black
    case white
}

public struct PastaKeyboardShiftStyleTokens: Equatable, Sendable {
    public let fill: PastaKeyboardColorToken
    public let foreground: PastaKeyboardColorToken

    public init(fill: PastaKeyboardColorToken, foreground: PastaKeyboardColorToken) {
        self.fill = fill
        self.foreground = foreground
    }
}

public enum PastaKeyboardShiftAppearance {
    public static func styleTokens(
        isActive: Bool,
        interfaceStyle: PastaKeyboardInterfaceStyle
    ) -> PastaKeyboardShiftStyleTokens {
        guard isActive, interfaceStyle == .dark else {
            return PastaKeyboardShiftStyleTokens(fill: .standard, foreground: .standard)
        }
        return PastaKeyboardShiftStyleTokens(fill: .white, foreground: .black)
    }
}
