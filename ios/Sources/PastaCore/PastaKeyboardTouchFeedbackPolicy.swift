import Foundation

public struct PastaKeyboardTouchFeedbackPolicy: Equatable, Sendable {
    public let touchDownDelaySeconds: Double
    public let minimumVisibleMilliseconds: Int
    public let visualFeedbackOpacityLight: Double
    public let visualFeedbackOpacityDark: Double
    public let animationDurationSeconds: Double

    public init(
        touchDownDelaySeconds: Double = 0,
        minimumVisibleMilliseconds: Int = 90,
        visualFeedbackOpacityLight: Double = 0.10,
        visualFeedbackOpacityDark: Double = 0.14,
        animationDurationSeconds: Double = 0
    ) {
        self.touchDownDelaySeconds = touchDownDelaySeconds
        self.minimumVisibleMilliseconds = minimumVisibleMilliseconds
        self.visualFeedbackOpacityLight = visualFeedbackOpacityLight
        self.visualFeedbackOpacityDark = visualFeedbackOpacityDark
        self.animationDurationSeconds = animationDurationSeconds
    }

    public static let standard = PastaKeyboardTouchFeedbackPolicy()

    public var minimumVisibleNanoseconds: UInt64 {
        UInt64(max(0, minimumVisibleMilliseconds)) * 1_000_000
    }
}
