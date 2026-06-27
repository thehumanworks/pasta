import Foundation

public enum PastaAPIError: Error, Equatable {
    case invalidURL
    case http(Int, String)
    case missingClip
}

public struct PastaAPIClient: Sendable {
    public var session: URLSession

    public init(session: URLSession = .shared) {
        self.session = session
    }

    public func redeemJoinGrant(token: JoinGrantToken, deviceName: String, keyMaterial: PastaDeviceKeyMaterial) async throws -> (PastaDeviceConfiguration, String) {
        let deviceId = "dev_\(try PastaEncoding.randomBase64URL(byteCount: 12))"
        let body = RedeemJoinGrantBody(
            grantId: token.grantId,
            redeemSecret: token.redeemSecret,
            newDeviceId: deviceId,
            newDeviceName: deviceName,
            verifyPublicKey: keyMaterial.signing.publicKey,
            wrapPublicKey: keyMaterial.wrapping.publicKey
        )
        let response: PairingGrantRedeemResponse = try await request(
            endpoint: token.endpoint,
            method: "POST",
            path: "/v1/pairing/grants/redeem",
            body: body,
            configuration: nil,
            signingPrivateKey: nil
        )
        let groupKey = try PastaCrypto.openJoinGrant(
            sealedGroupKey: response.sealedGroupKey,
            accountId: token.accountId,
            grantId: token.grantId,
            sealSecret: token.sealSecret
        )
        let configuration = PastaDeviceConfiguration(
            endpoint: token.endpoint,
            accountId: response.accountId,
            routingId: response.routingId,
            deviceId: response.deviceId,
            deviceName: deviceName,
            verifyPublicKey: keyMaterial.signing.publicKey,
            wrapPublicKey: keyMaterial.wrapping.publicKey,
            keyVersion: response.keyVersion
        )
        return (configuration, groupKey)
    }

    public func publishText(_ text: String, configuration: PastaDeviceConfiguration, groupKey: String, signingPrivateKey: String) async throws -> StoredClip {
        let clip = try PastaCrypto.encryptTextClip(TextClipEncryptionInput(
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            originDeviceId: configuration.deviceId,
            plaintext: text,
            groupKey: groupKey,
            keyVersion: configuration.keyVersion
        ))
        let response: ClipResponse = try await request(
            endpoint: configuration.endpoint,
            method: "POST",
            path: "/v1/clips",
            body: clip,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        return response.clip
    }

    public func publishFile(
        bytes: [UInt8],
        fileName: String?,
        mime: String,
        payloadKind: String = "file",
        configuration: PastaDeviceConfiguration,
        groupKey: String,
        signingPrivateKey: String
    ) async throws -> StoredClip {
        let metadata = fileName.map { ClipMetadata(name: PastaFileNames.sanitized($0, fallback: "file")) }
        let clip = try PastaCrypto.encryptBytesClip(BytesClipEncryptionInput(
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            originDeviceId: configuration.deviceId,
            bytes: bytes,
            payloadKind: payloadKind,
            mime: mime,
            groupKey: groupKey,
            keyVersion: configuration.keyVersion,
            metadata: metadata
        ))
        let response: ClipResponse = try await request(
            endpoint: configuration.endpoint,
            method: "POST",
            path: "/v1/files",
            body: clip,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        return response.clip
    }

    public func downloadFile(
        clipId: String,
        configuration: PastaDeviceConfiguration,
        groupKey: String,
        signingPrivateKey: String
    ) async throws -> PastaDownloadedFileClip {
        let response: FileClipResponse = try await request(
            endpoint: configuration.endpoint,
            method: "GET",
            path: "/v1/files/\(Self.escapePathComponent(clipId))",
            body: Optional<EmptyBody>.none,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        let encryptedClip = EncryptedClip(
            clipId: response.clip.clipId,
            originDeviceId: response.clip.originDeviceId,
            createdAt: response.clip.createdAt,
            expiresAt: response.clip.expiresAt,
            payloadKind: response.clip.payloadKind,
            mime: response.clip.mime,
            byteLen: response.clip.byteLen,
            keyVersion: response.clip.keyVersion,
            nonce: response.clip.nonce,
            aadHash: response.clip.aadHash,
            ciphertext: response.ciphertext,
            storageKind: response.clip.storageKind,
            payloadId: response.clip.payloadId,
            r2Key: response.clip.r2Key,
            metadata: response.clip.metadata
        )
        let bytes = try PastaCrypto.decryptBytesClip(
            groupKey: groupKey,
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            clip: encryptedClip
        )
        let metadata = try PastaCrypto.decryptClipMetadata(
            groupKey: groupKey,
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            clip: encryptedClip
        )
        return PastaDownloadedFileClip(
            clip: response.clip,
            bytes: bytes,
            metadata: metadata,
            suggestedFileName: PastaFileNames.exportName(
                metadataName: metadata?.name,
                payloadKind: response.clip.payloadKind,
                mime: response.clip.mime
            )
        )
    }

    public func history(configuration: PastaDeviceConfiguration, groupKey: String, signingPrivateKey: String, limit: Int = PastaCore.defaultHistoryLimit) async throws -> [PastaKeyboardClip] {
        let entries = try await historyEntries(
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: signingPrivateKey,
            limit: limit
        )
        return PastaHistoryEntry.keyboardClips(from: entries)
    }

    public func historyEntries(configuration: PastaDeviceConfiguration, groupKey: String, signingPrivateKey: String, limit: Int = PastaCore.defaultHistoryLimit) async throws -> [PastaHistoryEntry] {
        let response: ClipsResponse = try await request(
            endpoint: configuration.endpoint,
            method: "GET",
            path: "/v1/clips/history?limit=\(limit)",
            body: Optional<EmptyBody>.none,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        return try response.clips.map { clip in
            let text: String?
            let metadataName: String?
            if clip.payloadKind == "text" {
                text = try PastaCrypto.decryptTextClip(
                    groupKey: groupKey,
                    accountId: configuration.accountId,
                    routingId: configuration.routingId,
                    clip: clip.encryptedClip
                )
                metadataName = nil
            } else {
                text = nil
                metadataName = try PastaCrypto.decryptClipMetadata(
                    groupKey: groupKey,
                    accountId: configuration.accountId,
                    routingId: configuration.routingId,
                    clip: clip.encryptedClip
                )?.name
            }
            return PastaHistoryEntry(clip: clip, decryptedText: text, metadataName: metadataName)
        }
    }

    public func deleteClip(clipId: String, configuration: PastaDeviceConfiguration, signingPrivateKey: String) async throws -> PastaDeleteClipResponse {
        try await request(
            endpoint: configuration.endpoint,
            method: "DELETE",
            path: "/v1/clips/\(Self.escapePathComponent(clipId))",
            body: Optional<EmptyBody>.none,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
    }

    private func request<T: Decodable, B: Encodable>(
        endpoint: URL,
        method: String,
        path: String,
        body: B?,
        configuration: PastaDeviceConfiguration?,
        signingPrivateKey: String?
    ) async throws -> T {
        guard let url = URL(string: path, relativeTo: endpoint) else { throw PastaAPIError.invalidURL }
        let bodyText: String
        if let body {
            bodyText = try PastaEncoding.stableJSONString(body)
        } else {
            bodyText = ""
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "content-type")
            request.httpBody = Data(bodyText.utf8)
        }
        if let configuration, let signingPrivateKey {
            let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
            let nonce = try PastaEncoding.randomBase64URL(byteCount: 18)
            let bodyHash = PastaEncoding.sha256Base64URL(bodyText)
            let parts = SignedRequestParts(method: method, pathWithQuery: path, timestamp: timestamp, nonce: nonce, bodyHash: bodyHash)
            request.setValue(configuration.accountId, forHTTPHeaderField: "pasta-account-id")
            request.setValue(configuration.deviceId, forHTTPHeaderField: "pasta-device-id")
            request.setValue(String(timestamp), forHTTPHeaderField: "pasta-timestamp")
            request.setValue(nonce, forHTTPHeaderField: "pasta-nonce")
            request.setValue(bodyHash, forHTTPHeaderField: "pasta-body-sha256")
            request.setValue(try PastaCrypto.signCanonicalRequest(parts: parts, privateKey: signingPrivateKey), forHTTPHeaderField: "pasta-signature")
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let preview = String(data: data, encoding: .utf8)?.prefixText(160) ?? ""
            throw PastaAPIError.http(status, preview)
        }
        if data.isEmpty {
            return EmptyBody() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private static func escapePathComponent(_ value: String) -> String {
        var allowed = CharacterSet.urlPathAllowed
        allowed.remove(charactersIn: "/")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}

private struct RedeemJoinGrantBody: Codable {
    let grantId: String
    let redeemSecret: String
    let newDeviceId: String
    let newDeviceName: String
    let verifyPublicKey: String
    let wrapPublicKey: String
}

private struct ClipResponse: Codable {
    let clip: StoredClip
}

private struct ClipsResponse: Codable {
    let clips: [StoredClip]
}

private struct FileClipResponse: Codable {
    let clip: StoredClip
    let ciphertext: String
}

private struct EmptyBody: Codable {}

private extension StringProtocol {
    func prefixText(_ count: Int) -> String {
        let text = String(prefix(count))
        return text.isEmpty ? "Text clip" : text
    }
}
