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
        let scalars = text.unicodeScalars
        var start = scalars.endIndex
        while start != scalars.startIndex {
            let previous = scalars.index(before: start)
            guard wordCharacters.contains(scalars[previous]) else { break }
            start = previous
        }

        guard start != scalars.endIndex else { return nil }
        return String(scalars[start...])
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
        "about", "after", "again", "all", "also", "always", "and", "another",
        "any", "anyone", "anything", "around", "back", "because", "before",
        "being", "between", "both", "build", "called", "change", "clipboard",
        "come", "complete", "completion", "could", "device", "different",
        "does", "doing", "during", "each", "even", "every", "example",
        "first", "following", "found", "from", "general", "good", "great",
        "have", "here", "history", "however", "into", "just", "keyboard",
        "know", "last", "later", "like", "little", "look", "made", "make",
        "many", "message", "more", "most", "much", "must", "native", "need",
        "never", "next", "number", "only", "ordinary", "other", "over",
        "pasta", "paste", "pasted", "pasting", "people", "performance",
        "place", "please", "point", "privacy", "probably", "problem",
        "publish", "quick", "really", "release", "remote", "right", "same",
        "secure", "see", "should", "shared", "shift", "since", "small",
        "some", "something", "space", "still", "such", "suggestion", "symbol",
        "sync", "system", "take", "testing", "text", "than", "thanks", "that",
        "their", "them", "then", "there", "these", "they", "thing", "think",
        "this", "those", "through", "time", "today", "together", "toolbar",
        "tomorrow", "too", "trusted", "typed", "typing", "under", "until",
        "very", "visible", "want", "well", "were", "what", "when", "where",
        "which", "while", "will", "with", "without", "work", "would", "year",
        "your"
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
