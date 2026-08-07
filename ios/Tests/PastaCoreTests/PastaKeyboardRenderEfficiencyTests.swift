import XCTest
@testable import PastaCore

final class PastaKeyboardRenderEfficiencyTests: XCTestCase {
    func testStandardPolicyKeepsRenderGuardsEnabled() {
        let policy = PastaKeyboardRenderEfficiencyPolicy.standard

        XCTAssertTrue(policy.usesSharedTouchHighlight)
        XCTAssertTrue(policy.isolatesToolbarModelFromKeySurface)
        XCTAssertTrue(policy.skipsUnchangedSuggestionPublishes)
        XCTAssertTrue(policy.exitsAutocompleteEarlyOnUnchangedText)
    }

    func testUnchangedSuggestionFingerprintsAreNotRepublished() {
        let suggestions = [
            PastaKeyboardAutocompleteSuggestion(text: "the"),
            PastaKeyboardAutocompleteSuggestion(text: "then"),
            PastaKeyboardAutocompleteSuggestion(text: "there")
        ]
        let fingerprint = PastaKeyboardSuggestionFingerprint(suggestions: suggestions)

        XCTAssertFalse(
            PastaKeyboardRenderEfficiency.shouldPublishSuggestions(
                previous: fingerprint,
                next: fingerprint
            )
        )
    }

    func testChangedSuggestionFingerprintsArePublished() {
        let previous = PastaKeyboardSuggestionFingerprint(
            suggestions: [PastaKeyboardAutocompleteSuggestion(text: "the")]
        )
        let next = PastaKeyboardSuggestionFingerprint(
            suggestions: [PastaKeyboardAutocompleteSuggestion(text: "then")]
        )

        XCTAssertTrue(
            PastaKeyboardRenderEfficiency.shouldPublishSuggestions(
                previous: previous,
                next: next
            )
        )
    }

    func testAutocompleteSchedulingSkipsUnchangedDocumentText() {
        XCTAssertFalse(
            PastaKeyboardRenderEfficiency.shouldScheduleAutocomplete(
                previousText: "hello",
                nextText: "hello"
            )
        )
        XCTAssertTrue(
            PastaKeyboardRenderEfficiency.shouldScheduleAutocomplete(
                previousText: "hell",
                nextText: "hello"
            )
        )
    }

    func testExpandedCompletionIndexCoversCommonPrefixes() {
        let engine = PastaKeyboardAutocompleteEngine()

        let suggestions = engine.suggestions(for: "th")
        let texts = suggestions.map(\.text)

        XCTAssertTrue(texts.contains("that") || texts.contains("thanks") || texts.contains("there") || texts.contains("their"))
        XCTAssertEqual(suggestions.first?.kind, .unknown)
    }
}
