import KeyboardKit
import PastaCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

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
    @Published var historyClips: [PastaHistoryClip] = []
    @Published var joinToken = ""
    @Published var publishText = ""
    @Published var status = "Not paired"
    @Published var isBusy = false
    @Published var preparedExport: PastaPreparedExport?

    private let client = PastaAPIClient()
    private let keychain = PastaKeychainStore()
    private let store: PastaAppGroupStore?
    private var exportStore: PastaTemporaryFileStore?

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
            try await performRefreshHistory()
            status = "Published clip \(clip.seq)"
        }
    }

    func publishSelectedFile(_ url: URL) async {
        await run("Publishing \(url.lastPathComponent)...") {
            let configuration = try requireConfiguration()
            let didStartAccess = url.startAccessingSecurityScopedResource()
            defer {
                if didStartAccess {
                    url.stopAccessingSecurityScopedResource()
                }
            }
            let resourceValues = try url.resourceValues(forKeys: [.isDirectoryKey, .contentTypeKey])
            if resourceValues.isDirectory == true {
                throw PastaAppError.directoryImportNotSupported
            }
            let data = try Data(contentsOf: url)
            let contentType = resourceValues.contentType ?? UTType(filenameExtension: url.pathExtension)
            let mime = contentType?.preferredMIMEType ?? "application/octet-stream"
            let payloadKind = mime.hasPrefix("image/") ? "image" : "file"
            let clip = try await client.publishFile(
                bytes: Array(data),
                fileName: url.lastPathComponent,
                mime: mime,
                payloadKind: payloadKind,
                configuration: configuration,
                groupKey: try keychain.get(.groupKey),
                signingPrivateKey: try keychain.get(.signingPrivateKey)
            )
            try await performRefreshHistory()
            status = clip.payloadKind == "image" ? "Published image \(clip.seq)" : "Published file \(clip.seq)"
        }
    }

    func prepareExport(_ clip: PastaHistoryClip) async {
        guard clip.isExportable else {
            status = "Text clips copy to the iPhone clipboard."
            return
        }
        await run("Preparing \(clip.title)...") {
            let configuration = try requireConfiguration()
            let downloaded = try await client.downloadFile(
                clipId: clip.clipId,
                configuration: configuration,
                groupKey: try keychain.get(.groupKey),
                signingPrivateKey: try keychain.get(.signingPrivateKey)
            )
            try? exportStore?.cleanup()
            let tempStore = try PastaTemporaryFileStore()
            let url = try tempStore.stageFile(
                bytes: downloaded.bytes,
                suggestedName: downloaded.suggestedFileName,
                fallbackName: PastaFileNames.defaultOutputName(payloadKind: downloaded.clip.payloadKind, mime: downloaded.clip.mime)
            )
            exportStore = tempStore
            preparedExport = PastaPreparedExport(clipId: clip.clipId, title: downloaded.suggestedFileName, url: url)
            status = "Ready to export \(downloaded.suggestedFileName)"
        }
    }

    func cleanupPreparedExport() {
        try? exportStore?.cleanup()
        exportStore = nil
        preparedExport = nil
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
        historyClips = try await client.historyClips(
            configuration: configuration,
            groupKey: try keychain.get(.groupKey),
            signingPrivateKey: try keychain.get(.signingPrivateKey)
        )
        clips = refreshed
        try store?.saveKeyboardClips(refreshed)
        status = historyClips.isEmpty ? "No history yet." : "Synced \(historyClips.count) clips."
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
    case directoryImportNotSupported
}

struct PastaPreparedExport: Identifiable {
    let id = UUID()
    let clipId: String
    let title: String
    let url: URL
}

private extension String {
    var singleLineTitle: String {
        let compact = replacingOccurrences(of: "\n", with: " ")
        return compact.isEmpty ? "Text clip" : String(compact.prefix(48))
    }
}
