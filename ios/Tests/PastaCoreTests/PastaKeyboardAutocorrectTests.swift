import XCTest
@testable import PastaCore

final class PastaKeyboardAutocorrectTests: XCTestCase {
    func testSuggestionToApplyCorrectsMisspellingBeforeTerminator() {
        let suggestion = PastaKeyboardAutocorrect.suggestionToApply(
            for: "Can you fix the keybaord",
            autocorrectEnabled: true
        )

        XCTAssertEqual(suggestion?.text, "keyboard")
        XCTAssertEqual(suggestion?.kind, .autocorrect)
    }

    func testSuggestionToApplyIsNilWhenAutocorrectDisabled() {
        let suggestion = PastaKeyboardAutocorrect.suggestionToApply(
            for: "Can you fix the keybaord",
            autocorrectEnabled: false
        )

        XCTAssertNil(suggestion)
    }

    func testSuggestionToApplyHonorsIgnoredWords() {
        let suggestion = PastaKeyboardAutocorrect.suggestionToApply(
            for: "keybaord",
            autocorrectEnabled: true,
            ignoredWords: ["keybaord"]
        )

        XCTAssertNil(suggestion)
    }

    func testPublishingDemotesAutocorrectWhenDisabled() {
        let suggestions = [
            PastaKeyboardAutocompleteSuggestion(
                text: "keybaord",
                title: "\"keybaord\"",
                kind: .unknown
            ),
            PastaKeyboardAutocompleteSuggestion(
                text: "keyboard",
                kind: .autocorrect
            )
        ]

        let published = PastaKeyboardAutocorrect.suggestionsForPublishing(
            suggestions,
            autocorrectEnabled: false
        )

        XCTAssertEqual(published.map(\.kind), [.unknown, .regular])
        XCTAssertEqual(published.map(\.text), ["keybaord", "keyboard"])
    }

    func testPublishingKeepsAutocorrectWhenEnabled() {
        let suggestions = [
            PastaKeyboardAutocompleteSuggestion(text: "keyboard", kind: .autocorrect)
        ]

        let published = PastaKeyboardAutocorrect.suggestionsForPublishing(
            suggestions,
            autocorrectEnabled: true
        )

        XCTAssertEqual(published.first?.kind, .autocorrect)
    }

    func testAutocorrectEnabledDefaultsTrueAndPersistsToggle() {
        let suiteName = "PastaKeyboardAutocorrectTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertTrue(PastaKeyboardAutocorrect.isAutocorrectEnabled(in: defaults))

        PastaKeyboardAutocorrect.setAutocorrectEnabled(false, in: defaults)
        XCTAssertFalse(PastaKeyboardAutocorrect.isAutocorrectEnabled(in: defaults))

        PastaKeyboardAutocorrect.setAutocorrectEnabled(true, in: defaults)
        XCTAssertTrue(PastaKeyboardAutocorrect.isAutocorrectEnabled(in: defaults))
        XCTAssertEqual(
            defaults.object(forKey: PastaKeyboardAutocorrect.isAutocorrectEnabledSettingsKey) as? Bool,
            true
        )
    }
}
