import Foundation

/// Pasta-owned autocorrect policy helpers for KeyboardKit's suggestion band.
///
/// KeyboardKit auto-applies ``PastaKeyboardAutocompleteSuggestionKind/autocorrect``
/// suggestions when the user types a terminator (space/punctuation). Pasta must
/// keep those suggestions fresh despite debounced autocomplete, and demote them
/// to regular suggestions when the user disables autocorrect in app settings.
public enum PastaKeyboardAutocorrect {
    /// App Group / KeyboardKit settings key for the autocorrect toggle.
    ///
    /// Matches KeyboardKit 9.9.1 ``AutocompleteSettings/isAutocorrectEnabled``
    /// under the default ``KeyboardSettings`` prefix.
    public static let isAutocorrectEnabledSettingsKey =
        "com.keyboardkit.settings.autocomplete.isAutocorrectEnabled"

    /// Whether autocorrect should auto-apply on terminators. Defaults to enabled.
    public static func isAutocorrectEnabled(
        in defaults: UserDefaults
    ) -> Bool {
        if defaults.object(forKey: isAutocorrectEnabledSettingsKey) == nil {
            return true
        }
        return defaults.bool(forKey: isAutocorrectEnabledSettingsKey)
    }

    /// Persist the containing-app autocorrect toggle for the keyboard extension.
    public static func setAutocorrectEnabled(
        _ isEnabled: Bool,
        in defaults: UserDefaults
    ) {
        defaults.set(isEnabled, forKey: isAutocorrectEnabledSettingsKey)
    }

    /// Adapt engine suggestions for display/apply according to the user toggle.
    ///
    /// When autocorrect is disabled, autocorrect candidates become regular
    /// suggestions so the user can still tap them, but terminators will not
    /// auto-apply a replacement.
    public static func suggestionsForPublishing(
        _ suggestions: [PastaKeyboardAutocompleteSuggestion],
        autocorrectEnabled: Bool
    ) -> [PastaKeyboardAutocompleteSuggestion] {
        guard !autocorrectEnabled else { return suggestions }
        return suggestions.map { suggestion in
            guard suggestion.kind == .autocorrect else { return suggestion }
            return PastaKeyboardAutocompleteSuggestion(
                text: suggestion.text,
                title: suggestion.title,
                kind: .regular
            )
        }
    }

    /// Resolve the autocorrect suggestion KeyboardKit should apply for `text`.
    ///
    /// Returns `nil` when autocorrect is disabled, the current word has no
    /// correction, or the word is ignored.
    public static func suggestionToApply(
        for text: String,
        autocorrectEnabled: Bool,
        ignoredWords: Set<String> = [],
        engine: PastaKeyboardAutocompleteEngine = PastaKeyboardAutocompleteEngine()
    ) -> PastaKeyboardAutocompleteSuggestion? {
        guard autocorrectEnabled else { return nil }
        return engine
            .suggestions(for: text, ignoredWords: ignoredWords)
            .first { $0.kind == .autocorrect }
    }
}
