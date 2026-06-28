import XCTest
@testable import PastaCore

final class PastaKeyboardAutocompletePolicyTests: XCTestCase {
    func testAutocompleteContextKeepsOnlyTypingRelevantSuffix() {
        let policy = PastaKeyboardAutocompletePolicy(maximumContextCharacters: 12)

        XCTAssertEqual(
            policy.autocompleteContext(from: "Earlier sentence. activeword"),
            ". activeword"
        )
    }

    func testCorrectionIsSkippedForTransientOrPathologicalWords() {
        let policy = PastaKeyboardAutocompletePolicy(
            minimumCorrectedWordCharacters: 3,
            maximumCorrectedWordCharacters: 8
        )

        XCTAssertFalse(policy.shouldAttemptCorrection(for: "i"))
        XCTAssertFalse(policy.shouldAttemptCorrection(for: "42"))
        XCTAssertFalse(policy.shouldAttemptCorrection(for: "superlongword"))
        XCTAssertTrue(policy.shouldAttemptCorrection(for: "keybaord"))
    }

    func testStandardDebounceProtectsFastTypingWithoutMakingSuggestionsFeelIdle() {
        XCTAssertGreaterThanOrEqual(PastaKeyboardAutocompletePolicy.standard.debounceMilliseconds, 16)
        XCTAssertLessThanOrEqual(PastaKeyboardAutocompletePolicy.standard.debounceMilliseconds, 35)
    }

    func testEngineCorrectsKnownTyposWithoutSystemSpellchecker() {
        let suggestions = PastaKeyboardAutocompleteEngine()
            .suggestions(for: "Can you fix the keybaord")

        XCTAssertEqual(suggestions.first?.text, "keybaord")
        XCTAssertEqual(suggestions.first?.title, "\"keybaord\"")
        XCTAssertEqual(suggestions.first?.kind, .unknown)
        XCTAssertTrue(suggestions.contains {
            $0.text == "keyboard" && $0.kind == .autocorrect
        })
    }

    func testEngineHonorsIgnoredCorrections() {
        let suggestions = PastaKeyboardAutocompleteEngine()
            .suggestions(for: "Can you fix the keybaord", ignoredWords: ["keybaord"])

        XCTAssertFalse(suggestions.contains { $0.kind == .autocorrect })
    }

    func testEnginePreservesTypedCasing() {
        let suggestions = PastaKeyboardAutocompleteEngine()
            .suggestions(for: "KEYBAORD")

        XCTAssertTrue(suggestions.contains {
            $0.text == "KEYBOARD" && $0.kind == .autocorrect
        })
    }

    func testEngineBoundsAutocompleteContextBeforeExtractingCurrentWord() {
        let engine = PastaKeyboardAutocompleteEngine(
            policy: PastaKeyboardAutocompletePolicy(maximumContextCharacters: 7)
        )

        let suggestions = engine.suggestions(for: "keybaord letters")

        XCTAssertTrue(suggestions.contains { $0.text == "letters" })
        XCTAssertFalse(suggestions.contains { $0.text == "keyboard" })
    }
}
