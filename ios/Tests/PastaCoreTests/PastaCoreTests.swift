import XCTest
@testable import PastaCore

final class PastaCoreBootstrapTests: XCTestCase {
    func testBootstrapConstantsMatchNativeIOSContract() {
        XCTAssertEqual(PastaCore.bootstrapVersion, "0.2.0-ios-keyboard")
        XCTAssertEqual(PastaCore.protocolVersion, "0.1.7")
        XCTAssertEqual(PastaCore.directoryBundleMIME, "application/vnd.pasta.directory+zip")
        XCTAssertEqual(PastaCore.appGroupIdentifier, "group.com.thehumanworks.pasta")
        XCTAssertEqual(PastaCore.keychainAccessGroup, "54MXM5JG3R.com.thehumanworks.pasta")
        XCTAssertEqual(PastaCore.minimumSupportedIOSMajorVersion, 17)
    }

    func testNativeSurfacesAreExplicit() {
        XCTAssertEqual(
            PastaIOSSurface.allCases.map(\.rawValue),
            ["app", "keyboardExtension", "shareExtension", "appIntents", "fileProvider"]
        )
    }

    func testKeyboardOnlyDirectlyInsertsText() {
        XCTAssertEqual(PastaClipInsertability.keyboardAction(for: .text), .insertText)
        XCTAssertEqual(PastaClipInsertability.keyboardAction(for: .image), .handoff)
        XCTAssertEqual(PastaClipInsertability.keyboardAction(for: .file), .handoff)
        XCTAssertEqual(PastaClipInsertability.keyboardAction(for: .directoryBundle), .handoff)
    }

    func testJoinTokenExtractionAcceptsCliAndJsonPastes() throws {
        let endpoint = PastaEncoding.base64URLEncode(PastaEncoding.bytes("https://pasta.example"))
        let redeemSecret = PastaEncoding.base64URLEncode(Array(repeating: UInt8(1), count: 32))
        let sealSecret = PastaEncoding.base64URLEncode(Array(repeating: UInt8(2), count: 32))
        let token = "pasta_join_v1.\(endpoint).acct_test.grant_test.\(redeemSecret).\(sealSecret)"
        XCTAssertEqual(PastaCrypto.extractJoinGrantToken(from: "join token \(token)"), token)
        XCTAssertEqual(PastaCrypto.extractJoinGrantToken(from: #"{ "joinToken": "\#(token)" }"#), token)
        XCTAssertEqual(PastaCrypto.extractJoinGrantToken(from: "join token \(token.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)!)"), token)
        XCTAssertEqual(PastaCrypto.extractJoinGrantToken(from: "join token pasta_join_v1.\n\(endpoint).\nacct_test.\ngrant_test.\n\(redeemSecret).\n\(sealSecret)"), token)
        XCTAssertEqual(try PastaCrypto.parseJoinGrantTokenFromUserInput("join token \(token)").grantId, "grant_test")
    }

    func testJoinTokenValidationRejectsDamagedSecretsBeforeRedeem() throws {
        let endpoint = PastaEncoding.base64URLEncode(PastaEncoding.bytes("https://pasta.example"))
        let redeemSecret = PastaEncoding.base64URLEncode(Array(repeating: UInt8(1), count: 32))
        let truncatedSealSecret = PastaEncoding.base64URLEncode(Array(repeating: UInt8(2), count: 12))
        let token = "pasta_join_v1.\(endpoint).acct_test.grant_test.\(redeemSecret).\(truncatedSealSecret)"
        XCTAssertThrowsError(try PastaCrypto.parseJoinGrantTokenFromUserInput("join token \(token)")) { error in
            XCTAssertEqual(error as? PastaCryptoError, .invalidToken)
        }
    }
}

final class PastaCoreVectorTests: XCTestCase {
    func testBase64UrlMatchesTypeScriptVector() throws {
        let vectors = try loadVectors()
        XCTAssertEqual(PastaEncoding.base64URLEncode(vectors.base64Url.bytes), vectors.base64Url.encoded)
        XCTAssertEqual(try PastaEncoding.base64URLDecode(vectors.base64Url.encoded), vectors.base64Url.bytes)
    }

    func testStableJsonAndBodyHashMatchTypeScriptVector() throws {
        let vectors = try loadVectors()
        let body = StableBody(clipId: "clip_vector", items: [.string("pasta"), .int(42), .null], nested: .init(a: true, z: 3))
        let encoded = try PastaEncoding.stableJSONString(body)
        XCTAssertEqual(encoded, vectors.stableJson.encoded)
        XCTAssertEqual(PastaEncoding.sha256Base64URL(encoded), vectors.stableJson.sha256)
    }

    func testCanonicalRequestAndSignatureMatchTypeScriptVector() throws {
        let vectors = try loadVectors()
        XCTAssertEqual(PastaEncoding.canonicalRequest(vectors.signedRequest.parts), vectors.signedRequest.canonical)
        XCTAssertEqual(
            try PastaCrypto.signCanonicalRequest(parts: vectors.signedRequest.parts, privateKey: vectors.signedRequest.privateKey),
            vectors.signedRequest.signature
        )
    }

    func testTextClipEncryptionAndDecryptionMatchTypeScriptVector() throws {
        let vectors = try loadVectors()
        let expected = vectors.textClip.clip
        let encrypted = try PastaCrypto.encryptTextClip(TextClipEncryptionInput(
            accountId: vectors.textClip.accountId,
            routingId: vectors.textClip.routingId,
            originDeviceId: expected.originDeviceId,
            plaintext: vectors.textClip.plaintext,
            groupKey: vectors.textClip.groupKey,
            keyVersion: expected.keyVersion,
            clipId: expected.clipId,
            createdAt: expected.createdAt,
            expiresAt: expected.expiresAt,
            nonce: expected.nonce
        ))
        XCTAssertEqual(encrypted, expected)
        XCTAssertEqual(
            try PastaCrypto.decryptTextClip(
                groupKey: vectors.textClip.groupKey,
                accountId: vectors.textClip.accountId,
                routingId: vectors.textClip.routingId,
                clip: expected
            ),
            vectors.textClip.plaintext
        )
    }

    func testGroupKeyWrapMatchesTypeScriptVector() throws {
        let vectors = try loadVectors()
        let wrapped = try PastaCrypto.wrapGroupKey(
            groupKey: vectors.wrappedGroupKey.groupKey,
            senderPrivateKey: vectors.wrappedGroupKey.senderPrivateKey,
            senderPublicKey: vectors.wrappedGroupKey.senderPublicKey,
            recipientPublicKey: vectors.wrappedGroupKey.recipientPublicKey,
            nonce: vectors.wrappedGroupKey.nonce
        )
        XCTAssertEqual(wrapped, vectors.wrappedGroupKey.wrapped)
        XCTAssertEqual(
            try PastaCrypto.unwrapGroupKey(
                wrappedGroupKey: wrapped,
                recipientPrivateKey: vectors.wrappedGroupKey.recipientPrivateKey,
                recipientPublicKey: vectors.wrappedGroupKey.recipientPublicKey
            ),
            vectors.wrappedGroupKey.groupKey
        )
    }

    func testJoinGrantOpeningMatchesTypeScriptVector() throws {
        let vectors = try loadVectors()
        let token = try PastaCrypto.parseJoinGrantToken(vectors.joinGrant.token)
        XCTAssertEqual(token.endpoint.absoluteString, vectors.joinGrant.endpoint)
        XCTAssertEqual(token.accountId, vectors.joinGrant.accountId)
        XCTAssertEqual(token.grantId, vectors.joinGrant.grantId)
        XCTAssertEqual(token.redeemSecret, vectors.joinGrant.redeemSecret)
        XCTAssertEqual(token.sealSecret, vectors.joinGrant.sealSecret)
        XCTAssertEqual(
            try PastaCrypto.openJoinGrant(
                sealedGroupKey: vectors.joinGrant.sealedGroupKey,
                accountId: vectors.joinGrant.accountId,
                grantId: vectors.joinGrant.grantId,
                sealSecret: vectors.joinGrant.sealSecret
            ),
            vectors.joinGrant.openedGroupKey
        )
        XCTAssertEqual(vectors.joinGrant.openedGroupKey, vectors.joinGrant.groupKey)
    }

    private func loadVectors() throws -> PastaVectors {
        let url = Bundle.module.url(forResource: "pasta-core-vectors", withExtension: "json")!
        return try JSONDecoder().decode(PastaVectors.self, from: Data(contentsOf: url))
    }
}

final class PastaCoreStorageTests: XCTestCase {
    func testAppGroupStoreKeepsConfigAndKeyboardCacheOutOfStandardDefaults() throws {
        let suiteName = "PastaCoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let store = PastaAppGroupStore(defaults: defaults)
        let configuration = PastaDeviceConfiguration(
            endpoint: PastaCore.defaultEndpoint,
            accountId: "acct_test",
            routingId: "space_test",
            deviceId: "dev_test",
            deviceName: "iPhone",
            verifyPublicKey: "verify_public",
            wrapPublicKey: "wrap_public",
            keyVersion: 1
        )
        try store.saveConfiguration(configuration)
        try store.saveKeyboardClips([PastaKeyboardClip(sequence: 7, title: "Hello", text: "Hello", createdAt: 1)])
        XCTAssertEqual(store.loadConfiguration(), configuration)
        XCTAssertEqual(store.loadKeyboardClips().map(\.sequence), [7])
        XCTAssertNil(UserDefaults.standard.data(forKey: "pasta.device.configuration"))
        XCTAssertNil(UserDefaults.standard.data(forKey: "pasta.keyboard.cachedTextClips"))
    }

    func testKeychainStoreDoesNotMirrorSecretsIntoUserDefaults() throws {
        let service = "PastaCoreTests.\(UUID().uuidString)"
        let store = PastaKeychainStore(service: service, accessGroup: nil)
        defer {
            store.deleteAll()
        }
        try store.set("secret_group_key", for: .groupKey)
        XCTAssertEqual(try store.get(.groupKey), "secret_group_key")
        XCTAssertNil(UserDefaults.standard.string(forKey: PastaSecretName.groupKey.rawValue))
    }
}

final class PastaCoreLiveRelayTests: XCTestCase {
    func testLiveRelayJoinPublishAndHistoryWhenTokenProvided() async throws {
        guard let rawToken = ProcessInfo.processInfo.environment["PASTA_IOS_JOIN_TOKEN"],
              !rawToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            throw XCTSkip("Set PASTA_IOS_JOIN_TOKEN to run the live iOS Swift relay smoke.")
        }

        let token = try PastaCrypto.parseJoinGrantTokenFromUserInput(rawToken)
        let keyMaterial = try PastaCrypto.generateDeviceKeyMaterial()
        let deviceName = "ios-swift-smoke-\(UUID().uuidString.prefix(8))"
        let client = PastaAPIClient()
        let (configuration, groupKey) = try await client.redeemJoinGrant(
            token: token,
            deviceName: deviceName,
            keyMaterial: keyMaterial
        )
        XCTAssertEqual(configuration.accountId, token.accountId)
        XCTAssertEqual(configuration.deviceName, deviceName)

        let text = "pasta-ios-swift-smoke-\(UUID().uuidString)"
        let published = try await client.publishText(
            text,
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: keyMaterial.signing.privateKey
        )
        XCTAssertEqual(published.payloadKind, "text")
        XCTAssertEqual(published.mime, PastaCore.textMime)

        let history = try await client.history(
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: keyMaterial.signing.privateKey
        )
        XCTAssertTrue(history.contains { $0.text == text })
    }
}

private struct PastaVectors: Decodable {
    let base64Url: Base64Vector
    let stableJson: StableJSONVector
    let signedRequest: SignedRequestVector
    let textClip: TextClipVector
    let wrappedGroupKey: WrappedGroupKeyVector
    let joinGrant: JoinGrantVector
}

private struct Base64Vector: Decodable {
    let bytes: [UInt8]
    let encoded: String
}

private struct StableJSONVector: Decodable {
    let encoded: String
    let sha256: String
}

private struct SignedRequestVector: Decodable {
    let parts: SignedRequestParts
    let canonical: String
    let privateKey: String
    let publicKey: String
    let signature: String
}

private struct TextClipVector: Decodable {
    let accountId: String
    let routingId: String
    let groupKey: String
    let plaintext: String
    let clip: EncryptedClip
}

private struct WrappedGroupKeyVector: Decodable {
    let groupKey: String
    let senderPrivateKey: String
    let senderPublicKey: String
    let recipientPrivateKey: String
    let recipientPublicKey: String
    let nonce: String
    let wrapped: String
}

private struct JoinGrantVector: Decodable {
    let endpoint: String
    let accountId: String
    let grantId: String
    let redeemSecret: String
    let sealSecret: String
    let groupKey: String
    let token: String
    let sealedGroupKey: String
    let openedGroupKey: String
}

private struct StableBody: Encodable {
    let clipId: String
    let items: [StableValue]
    let nested: Nested

    struct Nested: Encodable {
        let a: Bool
        let z: Int
    }
}

private enum StableValue: Encodable {
    case string(String)
    case int(Int)
    case null

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .int(let value):
            try container.encode(value)
        case .null:
            try container.encodeNil()
        }
    }
}
