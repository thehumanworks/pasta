import XCTest
@testable import PastaCore

final class PastaKeyboardTouchFeedbackPolicyTests: XCTestCase {
    func testStandardFeedbackPersistsLongEnoughForShortTaps() {
        XCTAssertGreaterThanOrEqual(PastaKeyboardTouchFeedbackPolicy.standard.minimumVisibleMilliseconds, 70)
        XCTAssertLessThanOrEqual(PastaKeyboardTouchFeedbackPolicy.standard.minimumVisibleMilliseconds, 120)
    }

    func testQuickTapOnlyWaitsForRemainingMinimumVisibility() {
        let policy = PastaKeyboardTouchFeedbackPolicy(minimumVisibleMilliseconds: 90)

        XCTAssertEqual(
            policy.remainingVisibleNanoseconds(after: 20_000_000),
            70_000_000
        )
    }

    func testLongPressDoesNotRemainHighlightedAfterRelease() {
        let policy = PastaKeyboardTouchFeedbackPolicy(minimumVisibleMilliseconds: 90)

        XCTAssertEqual(
            policy.remainingVisibleNanoseconds(after: 120_000_000),
            0
        )
    }

    func testStandardFeedbackIsVisibleButDoesNotHideKeyLabels() {
        XCTAssertGreaterThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityLight, 0.05)
        XCTAssertLessThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityLight, 0.20)
        XCTAssertGreaterThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityDark, 0.05)
        XCTAssertLessThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityDark, 0.20)
    }
}
