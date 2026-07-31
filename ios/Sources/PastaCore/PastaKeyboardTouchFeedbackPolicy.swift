import Foundation

public struct PastaKeyboardTouchFeedbackPolicy: Equatable, Sendable {
    public let minimumVisibleMilliseconds: Int
    public let visualFeedbackOpacityLight: Double
    public let visualFeedbackOpacityDark: Double

    public init(
        minimumVisibleMilliseconds: Int = 90,
        visualFeedbackOpacityLight: Double = 0.10,
        visualFeedbackOpacityDark: Double = 0.14
    ) {
        self.minimumVisibleMilliseconds = minimumVisibleMilliseconds
        self.visualFeedbackOpacityLight = visualFeedbackOpacityLight
        self.visualFeedbackOpacityDark = visualFeedbackOpacityDark
    }

    public static let standard = PastaKeyboardTouchFeedbackPolicy()

    public var minimumVisibleNanoseconds: UInt64 {
        UInt64(max(0, minimumVisibleMilliseconds)) * 1_000_000
    }

    public func remainingVisibleNanoseconds(after elapsedNanoseconds: UInt64) -> UInt64 {
        let minimum = minimumVisibleNanoseconds
        return elapsedNanoseconds < minimum ? minimum - elapsedNanoseconds : 0
    }
}
