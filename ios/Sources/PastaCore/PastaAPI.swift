import Foundation

public enum PastaAPIError: Error, Equatable {
    case invalidURL
    case http(Int, String)
    case missingClip
    case missingFileEnvelope
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
        do {
            return try await publishFileV2(
                clip: clip,
                configuration: configuration,
                signingPrivateKey: signingPrivateKey
            )
        } catch let error as PastaAPIError where Self.shouldFallbackToV1(error) {
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
    }

    public func downloadFile(
        clipId: String,
        configuration: PastaDeviceConfiguration,
        groupKey: String,
        signingPrivateKey: String
    ) async throws -> PastaDownloadedFileClip {
        let response: FileClipResponse
        do {
            response = try await downloadFileV2(
                clipId: clipId,
                configuration: configuration,
                signingPrivateKey: signingPrivateKey
            )
        } catch let error as PastaAPIError where Self.shouldFallbackToV1(error) {
            response = try await request(
                endpoint: configuration.endpoint,
                method: "GET",
                path: "/v1/files/\(Self.escapePathComponent(clipId))",
                body: Optional<EmptyBody>.none,
                configuration: configuration,
                signingPrivateKey: signingPrivateKey
            )
        }
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
        let bodyText: String
        if let body {
            bodyText = try PastaEncoding.stableJSONString(body)
        } else {
            bodyText = ""
        }
        let request = try signedRequest(
            endpoint: endpoint,
            method: method,
            path: path,
            bodyData: Data(bodyText.utf8),
            contentType: body == nil ? nil : "application/json",
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        let (data, response) = try await session.data(for: request)
        try Self.validateResponse(data: data, response: response)
        if data.isEmpty {
            return EmptyBody() as! T
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    private func publishFileV2(clip: EncryptedClip, configuration: PastaDeviceConfiguration, signingPrivateKey: String) async throws -> StoredClip {
        let encryptedBytes = try PastaEncoding.base64URLDecode(clip.ciphertext)
        let envelope = EncryptedClip(
            clipId: clip.clipId,
            originDeviceId: clip.originDeviceId,
            createdAt: clip.createdAt,
            expiresAt: clip.expiresAt,
            payloadKind: clip.payloadKind,
            mime: clip.mime,
            byteLen: clip.byteLen,
            keyVersion: clip.keyVersion,
            nonce: clip.nonce,
            aadHash: clip.aadHash,
            ciphertext: "",
            storageKind: clip.storageKind,
            payloadId: clip.payloadId,
            r2Key: clip.r2Key,
            metadata: clip.metadata
        )
        let envelopeText = try PastaEncoding.stableJSONString(envelope)
        let request = try signedRequest(
            endpoint: configuration.endpoint,
            method: "POST",
            path: "/v2/files",
            bodyData: Data(encryptedBytes),
            contentType: "application/octet-stream",
            extraHeaders: ["pasta-file-envelope": PastaEncoding.base64URLEncode(Array(envelopeText.utf8))],
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        let (data, response) = try await session.data(for: request)
        try Self.validateResponse(data: data, response: response)
        return try JSONDecoder().decode(ClipResponse.self, from: data).clip
    }

    private func downloadFileV2(clipId: String, configuration: PastaDeviceConfiguration, signingPrivateKey: String) async throws -> FileClipResponse {
        let path = "/v2/files/\(Self.escapePathComponent(clipId))/content"
        let request = try signedRequest(
            endpoint: configuration.endpoint,
            method: "GET",
            path: path,
            bodyData: Data(),
            contentType: nil,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        let (data, response) = try await session.data(for: request)
        try Self.validateResponse(data: data, response: response)
        guard let envelopeHeader = (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "pasta-file-envelope") else {
            throw PastaAPIError.missingFileEnvelope
        }
        let envelopeData = Data(try PastaEncoding.base64URLDecode(envelopeHeader))
        let clip = try JSONDecoder().decode(StoredClip.self, from: envelopeData)
        return FileClipResponse(clip: clip, ciphertext: PastaEncoding.base64URLEncode(Array(data)))
    }

    private func signedRequest(
        endpoint: URL,
        method: String,
        path: String,
        bodyData: Data,
        contentType: String?,
        extraHeaders: [String: String] = [:],
        configuration: PastaDeviceConfiguration?,
        signingPrivateKey: String?
    ) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: endpoint) else { throw PastaAPIError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        if let contentType {
            request.setValue(contentType, forHTTPHeaderField: "content-type")
        }
        if !bodyData.isEmpty || contentType != nil {
            request.httpBody = bodyData
        }
        for (name, value) in extraHeaders {
            request.setValue(value, forHTTPHeaderField: name)
        }
        if let configuration, let signingPrivateKey {
            let timestamp = Int64(Date().timeIntervalSince1970 * 1000)
            let nonce = try PastaEncoding.randomBase64URL(byteCount: 18)
            let bodyHash = PastaEncoding.sha256Base64URL(Array(bodyData))
            let parts = SignedRequestParts(method: method, pathWithQuery: path, timestamp: timestamp, nonce: nonce, bodyHash: bodyHash)
            request.setValue(configuration.accountId, forHTTPHeaderField: "pasta-account-id")
            request.setValue(configuration.deviceId, forHTTPHeaderField: "pasta-device-id")
            request.setValue(String(timestamp), forHTTPHeaderField: "pasta-timestamp")
            request.setValue(nonce, forHTTPHeaderField: "pasta-nonce")
            request.setValue(bodyHash, forHTTPHeaderField: "pasta-body-sha256")
            request.setValue(try PastaCrypto.signCanonicalRequest(parts: parts, privateKey: signingPrivateKey), forHTTPHeaderField: "pasta-signature")
        }
        return request
    }

    private static func validateResponse(data: Data, response: URLResponse) throws {
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let preview = String(data: data, encoding: .utf8)?.prefixText(160) ?? ""
            throw PastaAPIError.http(status, preview)
        }
    }

    private static func shouldFallbackToV1(_ error: PastaAPIError) -> Bool {
        switch error {
        case .http(404, _), .missingFileEnvelope:
            return true
        default:
            return false
        }
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

    init(clip: StoredClip, ciphertext: String) {
        self.clip = clip
        self.ciphertext = ciphertext
    }
}

private struct EmptyBody: Codable {}

private extension StringProtocol {
    func prefixText(_ count: Int) -> String {
        let text = String(prefix(count))
        return text.isEmpty ? "Text clip" : text
    }
}
