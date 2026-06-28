import Foundation

public enum PastaKeyboardAutocompleteSuggestionKind: String, Sendable {
    case regular
    case autocorrect
    case unknown
}

public struct PastaKeyboardAutocompleteSuggestion: Equatable, Sendable {
    public let text: String
    public let title: String
    public let kind: PastaKeyboardAutocompleteSuggestionKind

    public init(
        text: String,
        title: String? = nil,
        kind: PastaKeyboardAutocompleteSuggestionKind = .regular
    ) {
        self.text = text
        self.title = title ?? text
        self.kind = kind
    }
}

public struct PastaKeyboardAutocompleteEngine: Sendable {
    private let policy: PastaKeyboardAutocompletePolicy

    public static let idleSuggestions = [
        PastaKeyboardAutocompleteSuggestion(text: "I"),
        PastaKeyboardAutocompleteSuggestion(text: "The"),
        PastaKeyboardAutocompleteSuggestion(text: "It")
    ]

    public init(policy: PastaKeyboardAutocompletePolicy = .standard) {
        self.policy = policy
    }

    public func suggestions(
        for text: String,
        ignoredWords: Set<String> = []
    ) -> [PastaKeyboardAutocompleteSuggestion] {
        let context = policy.autocompleteContext(from: text)
        guard let word = Self.currentWord(in: context), !word.isEmpty else {
            return Self.idleSuggestions
        }

        var suggestions: [PastaKeyboardAutocompleteSuggestion] = []
        var seen = Set<String>()
        appendUnknownSuggestion(for: word, to: &suggestions, seen: &seen)
        appendAutocorrectSuggestion(
            for: word,
            ignoredWords: ignoredWords,
            to: &suggestions,
            seen: &seen
        )
        appendCompletionSuggestions(for: word, to: &suggestions, seen: &seen)
        return suggestions.isEmpty ? Self.idleSuggestions : Array(suggestions.prefix(3))
    }

    private func appendUnknownSuggestion(
        for word: String,
        to suggestions: inout [PastaKeyboardAutocompleteSuggestion],
        seen: inout Set<String>
    ) {
        guard word.count > 1 else { return }
        append(
            PastaKeyboardAutocompleteSuggestion(
                text: word,
                title: "\"\(word)\"",
                kind: .unknown
            ),
            to: &suggestions,
            seen: &seen
        )
    }

    private func appendAutocorrectSuggestion(
        for word: String,
        ignoredWords: Set<String>,
        to suggestions: inout [PastaKeyboardAutocompleteSuggestion],
        seen: inout Set<String>
    ) {
        guard policy.shouldAttemptCorrection(for: word) else { return }
        let normalized = Self.normalized(word)
        guard !ignoredWords.contains(normalized) else { return }
        guard let correction = Self.autocorrections[normalized] else { return }
        guard !correction.caseInsensitiveEquals(word) else { return }
        append(
            PastaKeyboardAutocompleteSuggestion(
                text: correction.autocompleteCased(for: word),
                kind: .autocorrect
            ),
            to: &suggestions,
            seen: &seen
        )
    }

    private func appendCompletionSuggestions(
        for word: String,
        to suggestions: inout [PastaKeyboardAutocompleteSuggestion],
        seen: inout Set<String>
    ) {
        let prefix = Self.normalized(word)
        for completion in Self.completionsByPrefix[prefix] ?? [] {
            guard !completion.caseInsensitiveEquals(word) else { continue }
            append(
                PastaKeyboardAutocompleteSuggestion(
                    text: completion.autocompleteCased(for: word)
                ),
                to: &suggestions,
                seen: &seen
            )
        }
    }

    private func append(
        _ suggestion: PastaKeyboardAutocompleteSuggestion,
        to suggestions: inout [PastaKeyboardAutocompleteSuggestion],
        seen: inout Set<String>
    ) {
        let key = Self.normalized(suggestion.text)
        guard !key.isEmpty, !seen.contains(key) else { return }
        seen.insert(key)
        suggestions.append(suggestion)
    }

    private static func currentWord(in text: String) -> String? {
        let nsText = text as NSString
        var start = nsText.length
        while start > 0 {
            let codeUnit = nsText.character(at: start - 1)
            guard
                let scalar = UnicodeScalar(Int(codeUnit)),
                wordCharacters.contains(scalar)
            else {
                break
            }
            start -= 1
        }

        let length = nsText.length - start
        guard length > 0 else { return nil }
        return nsText.substring(with: NSRange(location: start, length: length))
    }

    public static func normalized(_ word: String) -> String {
        word.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private static let wordCharacters = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "'"))
    private static let autocorrections = [
        "teh": "the",
        "recieve": "receive",
        "keybaord": "keyboard",
        "publsih": "publish",
        "clipbaord": "clipboard",
        "psta": "pasta"
    ]
    private static let completions = [
        "about", "again", "because", "before", "between", "clipboard",
        "complete", "completion", "device", "history", "keyboard", "message",
        "native", "number", "ordinary", "pasta", "paste", "pasted", "pasting",
        "performance", "privacy", "publish", "quick", "release", "remote",
        "secure", "shared", "shift", "space", "suggestion", "symbol", "sync",
        "system", "testing", "text", "thanks", "there", "through", "today",
        "toolbar", "tomorrow", "trusted", "typed", "typing", "visible",
        "without"
    ]
    private static let completionsByPrefix: [String: [String]] = {
        var index: [String: [String]] = [:]
        for completion in completions {
            var prefix = ""
            for scalar in completion.unicodeScalars {
                prefix.unicodeScalars.append(scalar)
                index[prefix, default: []].append(completion)
            }
        }
        return index
    }()
}

private extension String {
    func autocompleteCased(for word: String) -> String {
        let isUppercased = word.count > 1 && word == word.uppercased()
        let startsUppercase = word.unicodeScalars.first.map { CharacterSet.uppercaseLetters.contains($0) } ?? false
        if isUppercased { return uppercased() }
        if startsUppercase { return prefix(1).uppercased() + dropFirst() }
        return self
    }

    func caseInsensitiveEquals(_ other: String) -> Bool {
        compare(other, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame
    }
}
