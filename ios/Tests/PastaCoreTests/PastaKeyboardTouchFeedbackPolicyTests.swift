import XCTest
@testable import PastaCore

final class PastaKeyboardTouchFeedbackPolicyTests: XCTestCase {
    func testStandardFeedbackStartsOnTouchDown() {
        XCTAssertEqual(PastaKeyboardTouchFeedbackPolicy.standard.touchDownDelaySeconds, 0)
    }

    func testStandardFeedbackDoesNotAnimateAfterTouchDown() {
        XCTAssertEqual(PastaKeyboardTouchFeedbackPolicy.standard.animationDurationSeconds, 0)
    }

    func testStandardFeedbackPersistsLongEnoughForShortTaps() {
        XCTAssertGreaterThanOrEqual(PastaKeyboardTouchFeedbackPolicy.standard.minimumVisibleMilliseconds, 70)
        XCTAssertLessThanOrEqual(PastaKeyboardTouchFeedbackPolicy.standard.minimumVisibleMilliseconds, 120)
    }

    func testStandardFeedbackIsVisibleButDoesNotHideKeyLabels() {
        XCTAssertGreaterThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityLight, 0.05)
        XCTAssertLessThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityLight, 0.20)
        XCTAssertGreaterThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityDark, 0.05)
        XCTAssertLessThan(PastaKeyboardTouchFeedbackPolicy.standard.visualFeedbackOpacityDark, 0.20)
    }
}
