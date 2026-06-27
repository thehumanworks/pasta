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

    public func history(configuration: PastaDeviceConfiguration, groupKey: String, signingPrivateKey: String, limit: Int = PastaCore.defaultHistoryLimit) async throws -> [PastaKeyboardClip] {
        let response: ClipsResponse = try await request(
            endpoint: configuration.endpoint,
            method: "GET",
            path: "/v1/clips/history?limit=\(limit)",
            body: Optional<EmptyBody>.none,
            configuration: configuration,
            signingPrivateKey: signingPrivateKey
        )
        return try response.clips.compactMap { clip in
            guard clip.payloadKind == "text" else { return nil }
            let text = try PastaCrypto.decryptTextClip(
                groupKey: groupKey,
                accountId: configuration.accountId,
                routingId: configuration.routingId,
                clip: clip.encryptedClip
            )
            return PastaKeyboardClip(
                sequence: clip.seq,
                title: text.replacingOccurrences(of: "\n", with: " ").prefixText(42),
                text: text,
                createdAt: clip.createdAt
            )
        }
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

private struct EmptyBody: Codable {}

private extension StringProtocol {
    func prefixText(_ count: Int) -> String {
        let text = String(prefix(count))
        return text.isEmpty ? "Text clip" : text
    }
}
