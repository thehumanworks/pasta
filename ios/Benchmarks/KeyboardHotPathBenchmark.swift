import Foundation

struct BenchmarkResult {
    let label: String
    let milliseconds: Double
    let checksum: Int
}

struct LayoutKey: Hashable {
    let keyboardType: Int
    let orientation: Int
    let width: Int
    let height: Int
    let deviceClass: Int
    let needsInputModeSwitchKey: Bool
}

struct LayoutItem: Hashable {
    let action: String
    let width: Int
}

struct KeyboardLayout {
    var rows: [[LayoutItem]]
}

final class KeyboardLayoutCache {
    private var key: LayoutKey?
    private var layout: KeyboardLayout?

    func layout(for key: LayoutKey) -> KeyboardLayout {
        if self.key == key, let layout {
            return layout
        }
        let generated = makeBaseLayout(for: key)
        self.key = key
        self.layout = generated
        return generated
    }
}

final class SimulatedTextChecker {
    private let completionsByPrefix: [String: [String]]
    private let availableLanguages: Set<String>
    private let autocorrections: [String: String]

    init() {
        let completions = [
            "about", "again", "because", "before", "between", "clipboard",
            "complete", "completion", "keyboard", "message", "native",
            "number", "ordinary", "pasta", "paste", "pasted", "pasting",
            "performance", "privacy", "publish", "quick", "release", "remote",
            "row", "secure", "shared", "shift", "space", "suggestion", "symbol",
            "sync", "system", "testing", "text", "thanks", "there", "through",
            "today", "toolbar", "tomorrow", "trusted", "typed", "typing",
            "visible", "without"
        ]
        availableLanguages = Set([
            "ar", "de", "en", "en_GB", "en_US", "es", "fr", "it", "ja",
            "ko", "nb", "nl", "pt", "sv", "zh-Hans", "zh-Hant"
        ])
        autocorrections = [
            "teh": "the",
            "recieve": "receive",
            "keybaord": "keyboard",
            "publsih": "publish",
            "clipbaord": "clipboard"
        ]

        var index: [String: [String]] = [:]
        for completion in completions {
            var prefix = ""
            for scalar in completion.unicodeScalars {
                prefix.unicodeScalars.append(scalar)
                index[prefix, default: []].append(completion)
            }
        }
        completionsByPrefix = index
    }

    func language(candidates: [String]) -> String {
        candidates.first { availableLanguages.contains($0) } ?? "en_US"
    }

    func suggestions(for word: String) -> [String] {
        let lower = word.lowercased()
        var suggestions: [String] = []
        var seen = Set<String>()
        if word.count > 1 {
            append(word, to: &suggestions, seen: &seen)
        }
        if let correction = autocorrections[lower], correction != lower {
            append(correction, to: &suggestions, seen: &seen)
        }
        for completion in completionsByPrefix[lower] ?? [] where completion != lower {
            append(matchCase(completion, for: word), to: &suggestions, seen: &seen)
            if suggestions.count == 3 { break }
        }
        return suggestions.isEmpty ? ["I", "The", "It"] : Array(suggestions.prefix(3))
    }
}

let defaultIterations = 40_000
let iterations = argumentValue("--iterations").flatMap(Int.init) ?? defaultIterations
let mode = argumentValue("--mode") ?? "both"
let maxOptimizedTotalMs = argumentValue("--max-optimized-total-ms").flatMap(Double.init)
let minImprovementPercent = argumentValue("--min-improvement-percent").flatMap(Double.init)

let layoutKeys = [
    LayoutKey(keyboardType: 0, orientation: 1, width: 393, height: 852, deviceClass: 0, needsInputModeSwitchKey: true),
    LayoutKey(keyboardType: 0, orientation: 1, width: 393, height: 852, deviceClass: 0, needsInputModeSwitchKey: true),
    LayoutKey(keyboardType: 0, orientation: 1, width: 393, height: 852, deviceClass: 0, needsInputModeSwitchKey: true),
    LayoutKey(keyboardType: 1, orientation: 1, width: 393, height: 852, deviceClass: 0, needsInputModeSwitchKey: true),
    LayoutKey(keyboardType: 0, orientation: 1, width: 393, height: 852, deviceClass: 0, needsInputModeSwitchKey: true),
]

let typingSamples = [
    "T",
    "Th",
    "I am testing the Pasta keybaord",
    "Can you publsih this clipbaord",
    "The suggestion row should stay native",
    "thanks for checking teh keyboard",
    "clipboard sync before tomorrow"
]

let languageCandidates = ["en_GB", "en-GB", "en", "en_US"]

var results: [BenchmarkResult] = []

if mode == "baseline" || mode == "both" {
    results.append(measure("baseline.layout_rebuild") {
        var checksum = 0
        for i in 0..<iterations {
            let key = layoutKeys[i % layoutKeys.count]
            let layout = makeBaseLayout(for: key)
            checksum &+= layoutChecksum(layout)
        }
        return checksum
    })
    results.append(measure("baseline.autocomplete_new_checker") {
        var checksum = 0
        for i in 0..<iterations {
            let text = typingSamples[i % typingSamples.count]
            let checker = SimulatedTextChecker()
            checksum &+= checker.language(candidates: languageCandidates).count
            checksum &+= checker.suggestions(for: currentWord(in: text)).joined().count
        }
        return checksum
    })
}

if mode == "optimized" || mode == "both" {
    results.append(measure("optimized.layout_cache") {
        var checksum = 0
        let cache = KeyboardLayoutCache()
        for i in 0..<iterations {
            checksum &+= layoutChecksum(cache.layout(for: layoutKeys[i % layoutKeys.count]))
        }
        return checksum
    })
    results.append(measure("optimized.autocomplete_reused_checker") {
        var checksum = 0
        let checker = SimulatedTextChecker()
        let language = checker.language(candidates: languageCandidates)
        for i in 0..<iterations {
            let text = typingSamples[i % typingSamples.count]
            checksum &+= language.count
            checksum &+= checker.suggestions(for: currentWord(in: text)).joined().count
        }
        return checksum
    })
}

print("Pasta keyboard hot path benchmark")
print("iterations: \(iterations)")
for result in results {
    print("\(result.label): \(format(result.milliseconds)) ms checksum=\(result.checksum)")
}

let optimizedTotal = total(prefix: "optimized", in: results)
var thresholdFailed = false

if mode == "both" {
    let baseline = total(prefix: "baseline", in: results)
    let delta = baseline - optimizedTotal
    let percent = baseline == 0 ? 0 : (delta / baseline) * 100
    print("baseline.total: \(format(baseline)) ms")
    print("optimized.total: \(format(optimizedTotal)) ms")
    print("improvement: \(format(delta)) ms (\(format(percent))% faster)")
    if let minImprovementPercent, percent < minImprovementPercent {
        standardError("expected improvement >= \(format(minImprovementPercent))%, got \(format(percent))%")
        thresholdFailed = true
    }
} else if mode == "optimized" {
    print("optimized.total: \(format(optimizedTotal)) ms")
}

if let maxOptimizedTotalMs, optimizedTotal > maxOptimizedTotalMs {
    standardError("expected optimized.total <= \(format(maxOptimizedTotalMs)) ms, got \(format(optimizedTotal)) ms")
    thresholdFailed = true
}
if thresholdFailed {
    fatalError("keyboard benchmark threshold failed")
}

func measure(_ label: String, _ operation: () -> Int) -> BenchmarkResult {
    let start = DispatchTime.now().uptimeNanoseconds
    let checksum = operation()
    let end = DispatchTime.now().uptimeNanoseconds
    return BenchmarkResult(
        label: label,
        milliseconds: Double(end - start) / 1_000_000,
        checksum: checksum
    )
}

func total(prefix: String, in results: [BenchmarkResult]) -> Double {
    results
        .filter { $0.label.hasPrefix(prefix) }
        .map(\.milliseconds)
        .reduce(0, +)
}

func makeBaseLayout(for key: LayoutKey) -> KeyboardLayout {
    let alphaRows = [
        "qwertyuiop",
        "asdfghjkl",
        "zxcvbnm"
    ]
    let symbolRows = [
        "1234567890",
        "-/:;()$&@\"",
        ".,?!'"
    ]
    let source = key.keyboardType == 0 ? alphaRows : symbolRows
    var rows = source.map { row in
        row.map { LayoutItem(action: String($0), width: 10) }
    }
    var controlRow = [
        LayoutItem(action: "shift", width: 14),
        LayoutItem(action: "space", width: 44),
        LayoutItem(action: "return", width: 18)
    ]
    if key.needsInputModeSwitchKey {
        controlRow.insert(LayoutItem(action: "nextKeyboard", width: 12), at: 1)
    }
    rows.append(controlRow)
    return KeyboardLayout(rows: rows)
}

func layoutChecksum(_ layout: KeyboardLayout) -> Int {
    layout.rows.reduce(0) { rowSum, row in
        rowSum &+ row.reduce(0) { itemSum, item in
            itemSum &+ item.action.unicodeScalars.reduce(0) { $0 &+ Int($1.value) } &+ item.width
        }
    }
}

func currentWord(in text: String) -> String {
    var result = ""
    for scalar in text.unicodeScalars.reversed() {
        guard CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "'")).contains(scalar) else {
            break
        }
        result.unicodeScalars.insert(scalar, at: result.unicodeScalars.startIndex)
    }
    return result
}

func append(_ value: String, to suggestions: inout [String], seen: inout Set<String>) {
    let key = value.lowercased()
    guard !key.isEmpty, !seen.contains(key) else { return }
    seen.insert(key)
    suggestions.append(value)
}

func matchCase(_ value: String, for word: String) -> String {
    guard let first = word.unicodeScalars.first, CharacterSet.uppercaseLetters.contains(first) else {
        return value
    }
    return value.prefix(1).uppercased() + value.dropFirst()
}

func argumentValue(_ name: String) -> String? {
    guard let index = CommandLine.arguments.firstIndex(of: name) else { return nil }
    let valueIndex = CommandLine.arguments.index(after: index)
    guard CommandLine.arguments.indices.contains(valueIndex) else { return nil }
    return CommandLine.arguments[valueIndex]
}

func format(_ value: Double) -> String {
    String(format: "%.3f", value)
}

func standardError(_ message: String) {
    FileHandle.standardError.write(Data((message + "\n").utf8))
}
