import XCTest
@testable import PastaCore

final class PastaKeyboardAppearanceTests: XCTestCase {
    func testInactiveShiftUsesStandardFillInLightAndDarkMode() {
        XCTAssertEqual(
            PastaKeyboardShiftAppearance.styleTokens(isActive: false, interfaceStyle: .light),
            PastaKeyboardShiftStyleTokens(fill: .standard, foreground: .standard)
        )
        XCTAssertEqual(
            PastaKeyboardShiftAppearance.styleTokens(isActive: false, interfaceStyle: .dark),
            PastaKeyboardShiftStyleTokens(fill: .standard, foreground: .standard)
        )
    }

    func testActiveShiftUsesStandardFillInLightMode() {
        XCTAssertEqual(
            PastaKeyboardShiftAppearance.styleTokens(isActive: true, interfaceStyle: .light),
            PastaKeyboardShiftStyleTokens(fill: .standard, foreground: .standard)
        )
    }

    func testActiveShiftUsesWhiteFillAndBlackForegroundInDarkMode() {
        XCTAssertEqual(
            PastaKeyboardShiftAppearance.styleTokens(isActive: true, interfaceStyle: .dark),
            PastaKeyboardShiftStyleTokens(fill: .white, foreground: .black)
        )
    }
}
