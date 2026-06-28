import Foundation

public struct PastaKeyboardAutocompletePolicy: Equatable, Sendable {
    public let debounceMilliseconds: Int
    public let maximumContextCharacters: Int
    public let minimumCorrectedWordCharacters: Int
    public let maximumCorrectedWordCharacters: Int

    public init(
        debounceMilliseconds: Int = 24,
        maximumContextCharacters: Int = 96,
        minimumCorrectedWordCharacters: Int = 3,
        maximumCorrectedWordCharacters: Int = 32
    ) {
        self.debounceMilliseconds = debounceMilliseconds
        self.maximumContextCharacters = maximumContextCharacters
        self.minimumCorrectedWordCharacters = minimumCorrectedWordCharacters
        self.maximumCorrectedWordCharacters = maximumCorrectedWordCharacters
    }

    public static let standard = PastaKeyboardAutocompletePolicy()

    public func autocompleteContext(from text: String) -> String {
        guard maximumContextCharacters > 0 else { return "" }
        return String(text.suffix(maximumContextCharacters))
    }

    public func shouldAttemptCorrection(for word: String) -> Bool {
        let characterCount = word.count
        guard characterCount >= minimumCorrectedWordCharacters else { return false }
        guard characterCount <= maximumCorrectedWordCharacters else { return false }
        return word.rangeOfCharacter(from: .letters) != nil
    }
}
