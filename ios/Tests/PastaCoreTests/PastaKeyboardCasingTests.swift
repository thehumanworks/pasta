import XCTest
@testable import PastaCore

final class PastaKeyboardCasingTests: XCTestCase {
    func testCharacterTransformationUsesRequestedCase() {
        XCTAssertEqual(PastaKeyboardCaseMode.lowercased.transformedCharacter("Q"), "q")
        XCTAssertEqual(PastaKeyboardCaseMode.auto.transformedCharacter("Q"), "q")
        XCTAssertEqual(PastaKeyboardCaseMode.uppercased.transformedCharacter("q"), "Q")
        XCTAssertEqual(PastaKeyboardCaseMode.capsLocked.transformedCharacter("q"), "Q")
    }

    func testCaseAfterInsertedCharacterCanLeaveInitialUppercaseState() {
        XCTAssertEqual(
            PastaKeyboardCaseMode.uppercased.caseAfterInsertedCharacter(autocapitalizesAllCharacters: false),
            .lowercased
        )
        XCTAssertEqual(
            PastaKeyboardCaseMode.lowercased.caseAfterInsertedCharacter(autocapitalizesAllCharacters: false),
            .lowercased
        )
        XCTAssertEqual(
            PastaKeyboardCaseMode.uppercased.caseAfterInsertedCharacter(autocapitalizesAllCharacters: true),
            .uppercased
        )
        XCTAssertEqual(
            PastaKeyboardCaseMode.capsLocked.caseAfterInsertedCharacter(autocapitalizesAllCharacters: false),
            .capsLocked
        )
    }

    func testLayoutSignatureChangesWhenKeyboardCaseChanges() {
        let lower = PastaKeyboardLayoutSignature(
            keyboardType: "alphabetic",
            keyboardCase: .lowercased,
            interfaceOrientation: "portrait",
            screenWidth: 390,
            screenHeight: 844,
            deviceType: "phone",
            needsInputModeSwitchKey: true,
            localeIdentifier: "en_US"
        )
        let upper = PastaKeyboardLayoutSignature(
            keyboardType: "alphabetic",
            keyboardCase: .uppercased,
            interfaceOrientation: "portrait",
            screenWidth: 390,
            screenHeight: 844,
            deviceType: "phone",
            needsInputModeSwitchKey: true,
            localeIdentifier: "en_US"
        )

        XCTAssertNotEqual(lower, upper)
    }

    func testLayoutSignatureCanKeyBoundedLayoutCache() {
        let signature = PastaKeyboardLayoutSignature(
            keyboardType: "alphabetic",
            keyboardCase: .lowercased,
            interfaceOrientation: "portrait",
            screenWidth: 390,
            screenHeight: 844,
            deviceType: "phone",
            needsInputModeSwitchKey: true,
            localeIdentifier: "en_US"
        )

        XCTAssertEqual([signature: "cached"][signature], "cached")
    }
}
