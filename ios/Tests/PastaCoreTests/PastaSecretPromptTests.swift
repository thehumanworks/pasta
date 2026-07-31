import XCTest
@testable import PastaCore

final class PastaSecretPromptTests: XCTestCase {
    func testSetPromptCollectsKeyPathThenPasskey() throws {
        var prompt = PastaSecretPrompt(intent: .setFromClipboard)
        XCTAssertEqual(prompt.step, .keyPath)
        XCTAssertEqual(prompt.submitTitle, "Next")
        XCTAssertTrue(prompt.isCurrentFieldEmpty)

        for character in "production/tool/KEY" {
            XCTAssertEqual(prompt.insert(String(character)), .updated)
        }
        XCTAssertEqual(prompt.displayValue, "production/tool/KEY")

        XCTAssertEqual(try prompt.advance(), .awaitingPasskey)
        XCTAssertEqual(prompt.step, .passkey)
        XCTAssertEqual(prompt.caption, "Passkey for production/tool/KEY")
        XCTAssertEqual(prompt.submitTitle, "Save")

        _ = prompt.insert("pass")
        XCTAssertEqual(
            try prompt.advance(),
            .ready(
                PastaSecretPromptSubmission(
                    intent: .setFromClipboard,
                    keyPath: "production/tool/KEY",
                    passkey: "pass"
                )
            )
        )
    }

    func testUnlockPromptOnlyCollectsPasskeyForTheSelectedSecret() throws {
        var prompt = PastaSecretPrompt(intent: .unlock(clipId: "clip_secret", key: "API_TOKEN"))
        XCTAssertEqual(prompt.step, .passkey)
        XCTAssertEqual(prompt.keyPath, "API_TOKEN")
        XCTAssertEqual(prompt.submitTitle, "Insert")

        _ = prompt.insert("hunter2")
        XCTAssertEqual(
            try prompt.advance(),
            .ready(
                PastaSecretPromptSubmission(
                    intent: .unlock(clipId: "clip_secret", key: "API_TOKEN"),
                    keyPath: "API_TOKEN",
                    passkey: "hunter2"
                )
            )
        )
    }

    func testPasskeyIsMaskedAndKeyPathIsVisible() {
        var prompt = PastaSecretPrompt(intent: .unlock(clipId: "clip_secret", key: "API_TOKEN"))
        _ = prompt.insert("abcd")
        XCTAssertEqual(prompt.displayValue, "••••")
        XCTAssertFalse(prompt.displayValue.contains("abcd"))

        var setPrompt = PastaSecretPrompt(intent: .setFromClipboard)
        _ = setPrompt.insert("KEY")
        XCTAssertEqual(setPrompt.displayValue, "KEY")
    }

    func testReturnKeySubmitsAndKeepsTypedCharacters() {
        var prompt = PastaSecretPrompt(intent: .unlock(clipId: "clip_secret", key: "KEY"))
        XCTAssertEqual(prompt.insert("pa"), .updated)
        XCTAssertEqual(prompt.insert("ss\n"), .submitRequested)
        XCTAssertEqual(prompt.passkey, "pass")
    }

    func testDeleteBackwardEditsOnlyTheActiveField() throws {
        var prompt = PastaSecretPrompt(intent: .setFromClipboard)
        _ = prompt.insert("KEYS")
        prompt.deleteBackward()
        XCTAssertEqual(prompt.keyPath, "KEY")

        _ = try prompt.advance()
        _ = prompt.insert("pass")
        prompt.deleteBackward()
        XCTAssertEqual(prompt.passkey, "pas")
        XCTAssertEqual(prompt.keyPath, "KEY")

        var emptyPrompt = PastaSecretPrompt(intent: .setFromClipboard)
        emptyPrompt.deleteBackward()
        XCTAssertEqual(emptyPrompt.keyPath, "")
    }

    func testKeyPathIgnoresWhitespaceAndRejectsInvalidPaths() {
        var prompt = PastaSecretPrompt(intent: .setFromClipboard)
        _ = prompt.insert("A B")
        XCTAssertEqual(prompt.keyPath, "AB")

        var leadingSlash = PastaSecretPrompt(intent: .setFromClipboard)
        _ = leadingSlash.insert("/KEY")
        XCTAssertThrowsError(try leadingSlash.advance()) { error in
            XCTAssertEqual(error as? PastaSecretPromptError, .invalidKeyPath)
        }

        var empty = PastaSecretPrompt(intent: .setFromClipboard)
        XCTAssertThrowsError(try empty.advance()) { error in
            XCTAssertEqual(error as? PastaSecretPromptError, .emptyKeyPath)
        }
    }

    func testEmptyPasskeyCannotBeSubmitted() throws {
        var prompt = PastaSecretPrompt(intent: .unlock(clipId: "clip_secret", key: "KEY"))
        XCTAssertThrowsError(try prompt.advance()) { error in
            XCTAssertEqual(error as? PastaSecretPromptError, .emptyPasskey)
        }
    }

    func testFieldsAreBoundedSoALongPasteCannotGrowWithoutLimit() throws {
        var prompt = PastaSecretPrompt(intent: .unlock(clipId: "clip_secret", key: "KEY"))
        _ = prompt.insert(String(repeating: "a", count: PastaSecretPrompt.maximumFieldLength + 50))
        XCTAssertEqual(prompt.passkey.count, PastaSecretPrompt.maximumFieldLength)
    }
}
