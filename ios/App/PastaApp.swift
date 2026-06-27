import KeyboardKit
import PastaCore
import SwiftUI
import UIKit

@main
struct PastaApp: App {
    @StateObject private var model = PastaAppModel()

    var body: some Scene {
        WindowGroup {
            KeyboardAppView(for: .pasta) {
                PastaRootView()
                    .environmentObject(model)
            }
        }
    }
}

@MainActor
final class PastaAppModel: ObservableObject {
    @Published var configuration: PastaDeviceConfiguration?
    @Published var clips: [PastaKeyboardClip] = []
    @Published var joinToken = ""
    @Published var publishText = ""
    @Published var status = "Not paired"
    @Published var isBusy = false

    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store: PastaAppGroupStore?

    init() {
        store = try? PastaAppGroupStore()
        configuration = store?.loadConfiguration()
        clips = store?.loadKeyboardClips() ?? []
        status = configuration == nil ? "Paste a Pasta join token to pair this iPhone." : "Paired as \(configuration?.deviceName ?? "iPhone")"
    }

    func join() async {
        await run("Joining Pasta space...") {
            let token = try PastaCrypto.parseJoinGrantTokenFromUserInput(joinToken)
            let keys = try PastaCrypto.generateDeviceKeyMaterial()
            let deviceName = UIDevice.current.name.isEmpty ? "Pasta iPhone" : UIDevice.current.name
            let (configuration, groupKey) = try await client.redeemJoinGrant(token: token, deviceName: deviceName, keyMaterial: keys)
            try keychain.set(groupKey, for: .groupKey)
            try keychain.set(keys.signing.privateKey, for: .signingPrivateKey)
            try keychain.set(keys.wrapping.privateKey, for: .wrappingPrivateKey)
            try store?.saveConfiguration(configuration)
            self.configuration = configuration
            self.joinToken = ""
            self.status = "Paired as \(configuration.deviceName)"
            do {
                try await performRefreshHistory()
            } catch {
                self.status = "Paired as \(configuration.deviceName). Refresh history later."
            }
        }
    }

    func refreshHistory() async {
        await run("Refreshing history...") {
            try await performRefreshHistory()
        }
    }

    func publishCurrentText() async {
        let text = publishText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            status = "Enter text before publishing."
            return
        }
        await run("Publishing text...") {
            let configuration = try requireConfiguration()
            let clip = try await client.publishText(
                text,
                configuration: configuration,
                groupKey: try keychain.get(.groupKey),
                signingPrivateKey: try keychain.get(.signingPrivateKey)
            )
            publishText = ""
            let cached = PastaKeyboardClip(sequence: clip.seq, title: text.singleLineTitle, text: text, createdAt: clip.createdAt)
            clips = [cached] + clips.filter { $0.sequence != clip.seq }
            try store?.saveKeyboardClips(clips)
            status = "Published clip \(clip.seq)"
        }
    }

    func importClipboardText() {
        let text = UIPasteboard.general.string ?? ""
        guard !text.isEmpty else {
            status = "Clipboard has no text."
            return
        }
        publishText = text
        status = "Clipboard text staged. Tap Publish to send."
    }

    func copyLatestToClipboard() {
        guard let clip = clips.first else {
            status = "No cached text clips."
            return
        }
        UIPasteboard.general.string = clip.text
        status = "Copied clip \(clip.sequence) to iPhone clipboard."
    }

    func seedLocalClip() {
        let clip = PastaKeyboardClip(
            sequence: Int(Date().timeIntervalSince1970),
            title: "Pasta keyboard ready",
            text: "Pasta keyboard ready",
            createdAt: Int64(Date().timeIntervalSince1970 * 1000)
        )
        clips = [clip] + clips
        try? store?.saveKeyboardClips(clips)
        status = "Saved a local keyboard clip."
    }

    private func performRefreshHistory() async throws {
        let configuration = try requireConfiguration()
        let refreshed = try await client.history(
            configuration: configuration,
            groupKey: try keychain.get(.groupKey),
            signingPrivateKey: try keychain.get(.signingPrivateKey)
        )
        clips = refreshed
        try store?.saveKeyboardClips(refreshed)
        status = refreshed.isEmpty ? "No text history yet." : "Synced \(refreshed.count) text clips."
    }

    private func requireConfiguration() throws -> PastaDeviceConfiguration {
        guard let configuration else { throw PastaAppError.notPaired }
        return configuration
    }

    private func run(_ busyStatus: String, operation: () async throws -> Void) async {
        guard !isBusy else { return }
        isBusy = true
        status = busyStatus
        defer { isBusy = false }
        do {
            try await operation()
        } catch {
            status = Self.statusMessage(for: error)
        }
    }

    private static func statusMessage(for error: Error) -> String {
        switch error {
        case PastaCryptoError.invalidToken:
            return "Join token is invalid or incomplete. Paste the full `join token ...` line from Pasta."
        case PastaCryptoError.invalidGrant, PastaCryptoError.cryptoFailed:
            return "Join token crypto check failed. Create a fresh token and paste it without editing."
        case let apiError as PastaAPIError:
            return statusMessage(for: apiError)
        default:
            return "Error: \(String(describing: error))"
        }
    }

    private static func statusMessage(for error: PastaAPIError) -> String {
        switch error {
        case .http(401, let body) where body.contains("bad_grant"):
            return "Join token was rejected. Create a fresh token on an already paired device."
        case .http(403, let body) where body.contains("grant_revoked"):
            return "Join token was revoked. Create a fresh token and try again."
        case .http(404, _):
            return "Join token was not found. Paste a current token from an already paired device."
        case .http(409, let body) where body.contains("grant_consumed"):
            return "Join token was already used. Create a fresh token and try again."
        case .http(410, let body) where body.contains("expired_grant"):
            return "Join token expired. Create a fresh token and try again."
        case .http(let status, _):
            return "Join failed with server error \(status). Try a fresh token."
        case .invalidURL:
            return "Join token endpoint is invalid. Create a fresh token and try again."
        case .missingClip:
            return "Pasta could not find that clip."
        }
    }
}

enum PastaAppError: Error {
    case notPaired
}

private extension String {
    var singleLineTitle: String {
        let compact = replacingOccurrences(of: "\n", with: " ")
        return compact.isEmpty ? "Text clip" : String(compact.prefix(48))
    }
}
