import Foundation

/// Pasta-owned keyboard render policy for typing-sensitive paths.
///
/// KeyboardKit already re-evaluates its `KeyboardView` when autocomplete
/// context publishes. Pasta must avoid multiplying that work with per-key
/// SwiftUI overlays, whole-keyboard observation of toolbar state, or nested
/// autocomplete tasks that publish unchanged suggestions.
public struct PastaKeyboardRenderEfficiencyPolicy: Equatable, Sendable {
    /// Prefer one shared UIKit highlight over per-key SwiftUI overlays.
    public let usesSharedTouchHighlight: Bool
    /// Toolbar status/history updates must not observe into the key surface.
    public let isolatesToolbarModelFromKeySurface: Bool
    /// Skip publishing autocomplete suggestions when the band content is unchanged.
    public let skipsUnchangedSuggestionPublishes: Bool
    /// Avoid scheduling debounce work when document text has not changed.
    public let exitsAutocompleteEarlyOnUnchangedText: Bool

    public init(
        usesSharedTouchHighlight: Bool = true,
        isolatesToolbarModelFromKeySurface: Bool = true,
        skipsUnchangedSuggestionPublishes: Bool = true,
        exitsAutocompleteEarlyOnUnchangedText: Bool = true
    ) {
        self.usesSharedTouchHighlight = usesSharedTouchHighlight
        self.isolatesToolbarModelFromKeySurface = isolatesToolbarModelFromKeySurface
        self.skipsUnchangedSuggestionPublishes = skipsUnchangedSuggestionPublishes
        self.exitsAutocompleteEarlyOnUnchangedText = exitsAutocompleteEarlyOnUnchangedText
    }

    public static let standard = PastaKeyboardRenderEfficiencyPolicy()
}

/// Pure fingerprint used to skip redundant autocomplete band updates.
public struct PastaKeyboardSuggestionFingerprint: Equatable, Sendable {
    public let texts: [String]
    public let titles: [String]
    public let kinds: [PastaKeyboardAutocompleteSuggestionKind]

    public init(suggestions: [PastaKeyboardAutocompleteSuggestion]) {
        texts = suggestions.map(\.text)
        titles = suggestions.map(\.title)
        kinds = suggestions.map(\.kind)
    }
}

public enum PastaKeyboardRenderEfficiency {
    public static func shouldPublishSuggestions(
        previous: PastaKeyboardSuggestionFingerprint?,
        next: PastaKeyboardSuggestionFingerprint,
        policy: PastaKeyboardRenderEfficiencyPolicy = .standard
    ) -> Bool {
        guard policy.skipsUnchangedSuggestionPublishes else { return true }
        return previous != next
    }

    public static func shouldScheduleAutocomplete(
        previousText: String?,
        nextText: String,
        policy: PastaKeyboardRenderEfficiencyPolicy = .standard
    ) -> Bool {
        guard policy.exitsAutocompleteEarlyOnUnchangedText else { return true }
        return previousText != nextText
    }
}
