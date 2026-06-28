import XCTest
@testable import PastaCore

final class PastaCoreBootstrapTests: XCTestCase {
    func testBootstrapConstantsMatchNativeIOSContract() {
        XCTAssertEqual(PastaCore.bootstrapVersion, "0.2.0-ios-keyboard")
        XCTAssertEqual(PastaCore.protocolVersion, "0.1.19")
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

    func testBytesClipEncryptionAndDecryptionMatchTypeScriptVector() throws {
        let vectors = try loadVectors()
        let expected = vectors.bytesClip.clip
        let encrypted = try PastaCrypto.encryptBytesClip(BytesClipEncryptionInput(
            accountId: vectors.bytesClip.accountId,
            routingId: vectors.bytesClip.routingId,
            originDeviceId: expected.originDeviceId,
            bytes: vectors.bytesClip.bytes,
            payloadKind: expected.payloadKind,
            mime: expected.mime,
            groupKey: vectors.bytesClip.groupKey,
            keyVersion: expected.keyVersion,
            clipId: expected.clipId,
            createdAt: expected.createdAt,
            expiresAt: expected.expiresAt,
            nonce: expected.nonce
        ))
        XCTAssertEqual(encrypted, expected)
        XCTAssertEqual(
            try PastaCrypto.decryptBytesClip(
                groupKey: vectors.bytesClip.groupKey,
                accountId: vectors.bytesClip.accountId,
                routingId: vectors.bytesClip.routingId,
                clip: expected
            ),
            vectors.bytesClip.bytes
        )
    }

    func testEncryptedMetadataNameRoundTripsWithoutPlaintextInEnvelope() throws {
        let groupKey = PastaEncoding.base64URLEncode(Array(repeating: UInt8(9), count: 32))
        let encrypted = try PastaCrypto.encryptBytesClip(BytesClipEncryptionInput(
            accountId: "acct_meta",
            routingId: "space_meta",
            originDeviceId: "dev_meta",
            bytes: [1, 2, 3],
            payloadKind: "file",
            mime: "application/pdf",
            groupKey: groupKey,
            clipId: "clip_meta",
            createdAt: 1,
            nonce: PastaEncoding.base64URLEncode(Array(repeating: UInt8(2), count: 24)),
            metadata: ClipMetadata(name: "Secret Plan.pdf")
        ))
        let envelope = try PastaEncoding.stableJSONString(encrypted)
        XCTAssertFalse(envelope.contains("Secret Plan.pdf"))
        let metadata = try PastaCrypto.decryptClipMetadata(
            groupKey: groupKey,
            accountId: "acct_meta",
            routingId: "space_meta",
            clip: encrypted
        )
        XCTAssertEqual(metadata?.name, "Secret Plan.pdf")
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
        try store.saveKeyboardClips([PastaKeyboardClip(clipId: "clip_cached", sequence: 7, title: "Hello", text: "Hello", createdAt: 1)])
        XCTAssertEqual(store.loadConfiguration(), configuration)
        XCTAssertEqual(store.loadKeyboardClips().map(\.sequence), [7])
        XCTAssertEqual(store.loadKeyboardClips().map(\.clipId), ["clip_cached"])
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

final class PastaCoreHistoryDeleteTests: XCTestCase {
    override func tearDown() {
        PastaMockURLProtocol.handler = nil
        super.tearDown()
    }

    func testDeleteClipUsesClipIdPathAndSignedDelete() async throws {
        let configuration = Self.testConfiguration
        let signing = try PastaCrypto.generateSigningKeyPair(seed: Array(repeating: UInt8(3), count: 32))
        let client = PastaAPIClient(session: Self.mockSession { request in
            XCTAssertEqual(request.httpMethod, "DELETE")
            XCTAssertEqual(request.url?.path, "/v1/clips/clip_delete_test")
            XCTAssertNil(request.url?.query)
            XCTAssertNil(request.httpBody)
            XCTAssertEqual(request.value(forHTTPHeaderField: "pasta-account-id"), configuration.accountId)
            XCTAssertEqual(request.value(forHTTPHeaderField: "pasta-device-id"), configuration.deviceId)
            XCTAssertNotNil(request.value(forHTTPHeaderField: "pasta-signature"))
            return Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: #"{"clipId":"clip_delete_test","deleted":1,"deletedObjects":0}"#
            )
        })

        let result = try await client.deleteClip(
            clipId: "clip_delete_test",
            configuration: configuration,
            signingPrivateKey: signing.privateKey
        )

        XCTAssertEqual(result, PastaDeleteClipResponse(clipId: "clip_delete_test", deleted: 1, deletedObjects: 0))
    }

    func testHistoryEntriesKeepClipIdAndRefreshTextOnlyKeyboardCache() async throws {
        let configuration = Self.testConfiguration
        let signing = try PastaCrypto.generateSigningKeyPair(seed: Array(repeating: UInt8(4), count: 32))
        let groupKey = PastaEncoding.base64URLEncode(Array(repeating: UInt8(9), count: 32))
        let text = "hello from remote history"
        let encryptedText = try PastaCrypto.encryptTextClip(TextClipEncryptionInput(
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            originDeviceId: configuration.deviceId,
            plaintext: text,
            groupKey: groupKey,
            keyVersion: configuration.keyVersion,
            clipId: "clip_text_cache",
            createdAt: 1000,
            expiresAt: nil,
            nonce: PastaEncoding.base64URLEncode(Array(repeating: UInt8(2), count: 24))
        ))
        let storedText = StoredClip(seq: 8, clip: encryptedText)
        let storedFile = StoredClip(
            seq: 7,
            clipId: "clip_file_cache",
            originDeviceId: configuration.deviceId,
            createdAt: 900,
            expiresAt: nil,
            payloadKind: "file",
            mime: "application/pdf",
            byteLen: 42,
            keyVersion: configuration.keyVersion,
            nonce: PastaEncoding.base64URLEncode(Array(repeating: UInt8(7), count: 24)),
            aadHash: "file_aad_hash",
            ciphertext: "",
            storageKind: "r2",
            payloadId: "payload_file",
            r2Key: "spaces/space_test/clips/clip_file_cache/payload_file",
            metadata: nil
        )
        let responseBody = try JSONEncoder().encode(ClipsFixture(clips: [storedText, storedFile]))
        let client = PastaAPIClient(session: Self.mockSession { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/v1/clips/history")
            XCTAssertEqual(request.url?.query, "limit=5")
            return Self.jsonResponse(request: request, statusCode: 200, data: responseBody)
        })

        let entries = try await client.historyEntries(
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: signing.privateKey,
            limit: 5
        )

        XCTAssertEqual(entries.map(\.clipId), ["clip_text_cache", "clip_file_cache"])
        XCTAssertEqual(entries.map(\.sequence), [8, 7])
        XCTAssertEqual(entries[0].text, text)
        XCTAssertEqual(entries[0].keyboardClip?.clipId, "clip_text_cache")
        XCTAssertNil(entries[1].text)
        XCTAssertEqual(entries[1].kindLabel, "File")

        let cached = PastaHistoryEntry.keyboardClips(from: entries)
        XCTAssertEqual(cached.map(\.clipId), ["clip_text_cache"])
        XCTAssertEqual(cached.map(\.text), [text])

        let suiteName = "PastaCoreTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer {
            defaults.removePersistentDomain(forName: suiteName)
        }
        let store = PastaAppGroupStore(defaults: defaults)
        try store.saveKeyboardClips(cached)
        XCTAssertEqual(store.loadKeyboardClips(), cached)
    }

    private static let testConfiguration = PastaDeviceConfiguration(
        endpoint: URL(string: "https://pasta.example")!,
        accountId: "acct_test",
        routingId: "space_test",
        deviceId: "dev_test",
        deviceName: "iPhone",
        verifyPublicKey: "verify_public",
        wrapPublicKey: "wrap_public",
        keyVersion: 1
    )

    private static func mockSession(_ handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) -> URLSession {
        PastaMockURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PastaMockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private static func jsonResponse(request: URLRequest, statusCode: Int, body: String) -> (HTTPURLResponse, Data) {
        jsonResponse(request: request, statusCode: statusCode, data: Data(body.utf8))
    }

    private static func jsonResponse(request: URLRequest, statusCode: Int, data: Data) -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["content-type": "application/json"]
        )!
        return (response, data)
    }
}

final class PastaCoreFileAPITests: XCTestCase {
    override func tearDown() {
        PastaMockURLProtocol.handler = nil
        super.tearDown()
    }

    func testPublishFileUsesSignedPostFilesRequestWithEncryptedMetadata() async throws {
        let configuration = Self.testConfiguration
        let signing = try PastaCrypto.generateSigningKeyPair(seed: Array(repeating: UInt8(7), count: 32))
        let groupKey = PastaEncoding.base64URLEncode(Array(repeating: UInt8(9), count: 32))
        let client = PastaAPIClient(session: Self.mockSession { request in
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.url?.path, "/v1/files")
            XCTAssertEqual(request.value(forHTTPHeaderField: "pasta-account-id"), configuration.accountId)
            XCTAssertEqual(request.value(forHTTPHeaderField: "pasta-device-id"), configuration.deviceId)
            XCTAssertNotNil(request.value(forHTTPHeaderField: "pasta-signature"))

            let body = try XCTUnwrap(request.pastaTestBodyData())
            let bodyText = String(data: body, encoding: .utf8) ?? ""
            XCTAssertFalse(bodyText.contains("secret-report.pdf"))
            let clip = try JSONDecoder().decode(EncryptedClip.self, from: body)
            XCTAssertEqual(clip.payloadKind, "file")
            XCTAssertEqual(clip.mime, "application/octet-stream")
            XCTAssertEqual(clip.originDeviceId, configuration.deviceId)
            XCTAssertNotNil(clip.metadata)

            let stored = StoredClip(
                seq: 11,
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
                storageKind: "r2",
                payloadId: "payload_test",
                r2Key: "spaces/\(configuration.routingId)/clips/\(clip.clipId)/payload_test",
                metadata: clip.metadata
            )
            return try Self.jsonResponse(request: request, statusCode: 201, body: ClipFixture(clip: stored))
        })

        let published = try await client.publishFile(
            bytes: [1, 2, 3, 4],
            fileName: "secret-report.pdf",
            mime: "application/octet-stream",
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: signing.privateKey
        )

        XCTAssertEqual(published.seq, 11)
        XCTAssertEqual(published.storageKind, "r2")
        XCTAssertEqual(published.payloadKind, "file")
    }

    func testDownloadFileUsesSignedClipIdPathAndDecryptsBytes() async throws {
        let configuration = Self.testConfiguration
        let signing = try PastaCrypto.generateSigningKeyPair(seed: Array(repeating: UInt8(7), count: 32))
        let groupKey = PastaEncoding.base64URLEncode(Array(repeating: UInt8(9), count: 32))
        let encrypted = try PastaCrypto.encryptBytesClip(BytesClipEncryptionInput(
            accountId: configuration.accountId,
            routingId: configuration.routingId,
            originDeviceId: configuration.deviceId,
            bytes: [80, 97, 115, 116, 97],
            payloadKind: "file",
            mime: "application/octet-stream",
            groupKey: groupKey,
            clipId: "clip_download",
            createdAt: 1782475200002,
            nonce: PastaEncoding.base64URLEncode(Array(repeating: UInt8(6), count: 24)),
            metadata: ClipMetadata(name: "from-ios.bin")
        ))
        let stored = StoredClip(
            seq: 12,
            clipId: encrypted.clipId,
            originDeviceId: encrypted.originDeviceId,
            createdAt: encrypted.createdAt,
            expiresAt: encrypted.expiresAt,
            payloadKind: encrypted.payloadKind,
            mime: encrypted.mime,
            byteLen: encrypted.byteLen,
            keyVersion: encrypted.keyVersion,
            nonce: encrypted.nonce,
            aadHash: encrypted.aadHash,
            ciphertext: "",
            storageKind: "r2",
            payloadId: "payload_download",
            r2Key: "spaces/\(configuration.routingId)/clips/\(encrypted.clipId)/payload_download",
            metadata: encrypted.metadata
        )
        let client = PastaAPIClient(session: Self.mockSession { request in
            XCTAssertEqual(request.httpMethod, "GET")
            XCTAssertEqual(request.url?.path, "/v1/files/clip_download")
            XCTAssertEqual(request.value(forHTTPHeaderField: "pasta-body-sha256"), PastaEncoding.sha256Base64URL(""))
            XCTAssertNotNil(request.value(forHTTPHeaderField: "pasta-signature"))
            return try Self.jsonResponse(
                request: request,
                statusCode: 200,
                body: FileClipFixture(clip: stored, ciphertext: encrypted.ciphertext)
            )
        })

        let downloaded = try await client.downloadFile(
            clipId: encrypted.clipId,
            configuration: configuration,
            groupKey: groupKey,
            signingPrivateKey: signing.privateKey
        )

        XCTAssertEqual(downloaded.bytes, [80, 97, 115, 116, 97])
        XCTAssertEqual(downloaded.metadata?.name, "from-ios.bin")
        XCTAssertEqual(downloaded.suggestedFileName, "from-ios.bin")
    }

    func testTemporaryFileStoreStagesSanitizedNameAndCleansUp() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("PastaCoreTests-\(UUID().uuidString)", isDirectory: true)
        let store = try PastaTemporaryFileStore(directory: directory)
        let staged = try store.stageFile(bytes: [1, 2, 3], suggestedName: "../unsafe/name.txt")
        XCTAssertEqual(staged.deletingLastPathComponent(), directory)
        XCTAssertEqual(staged.lastPathComponent, "name.txt")
        XCTAssertTrue(FileManager.default.fileExists(atPath: staged.path))
        try store.cleanup()
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.path))
    }

    private static let testConfiguration = PastaDeviceConfiguration(
        endpoint: URL(string: "https://pasta.example")!,
        accountId: "acct_test",
        routingId: "space_test",
        deviceId: "dev_test",
        deviceName: "iPhone",
        verifyPublicKey: "verify_public",
        wrapPublicKey: "wrap_public",
        keyVersion: 1
    )

    private static func mockSession(_ handler: @escaping (URLRequest) throws -> (HTTPURLResponse, Data)) -> URLSession {
        PastaMockURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [PastaMockURLProtocol.self]
        return URLSession(configuration: configuration)
    }

    private static func jsonResponse<T: Encodable>(
        request: URLRequest,
        statusCode: Int,
        body: T
    ) throws -> (HTTPURLResponse, Data) {
        let response = HTTPURLResponse(
            url: request.url!,
            statusCode: statusCode,
            httpVersion: nil,
            headerFields: ["content-type": "application/json"]
        )!
        return (response, try JSONEncoder().encode(body))
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

private struct ClipsFixture: Encodable {
    let clips: [StoredClip]
}

private struct ClipFixture: Encodable {
    let clip: StoredClip
}

private struct FileClipFixture: Encodable {
    let clip: StoredClip
    let ciphertext: String
}

private final class PastaMockURLProtocol: URLProtocol {
    nonisolated(unsafe) static var handler: ((URLRequest) throws -> (HTTPURLResponse, Data))?

    override class func canInit(with request: URLRequest) -> Bool {
        true
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        request
    }

    override func startLoading() {
        guard let handler = Self.handler else {
            client?.urlProtocol(self, didFailWithError: PastaMockURLProtocolError.missingHandler)
            return
        }
        do {
            let (response, data) = try handler(request)
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        } catch {
            client?.urlProtocol(self, didFailWithError: error)
        }
    }

    override func stopLoading() {}
}

private enum PastaMockURLProtocolError: Error {
    case missingHandler
}

private extension URLRequest {
    func pastaTestBodyData() -> Data? {
        if let httpBody {
            return httpBody
        }
        guard let stream = httpBodyStream else {
            return nil
        }
        stream.open()
        defer { stream.close() }
        var data = Data()
        var buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable {
            let count = stream.read(&buffer, maxLength: buffer.count)
            if count > 0 {
                data.append(buffer, count: count)
            } else {
                break
            }
        }
        return data.isEmpty ? nil : data
    }
}

private extension StoredClip {
    init(seq: Int, clip: EncryptedClip) {
        self.init(
            seq: seq,
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
            ciphertext: clip.ciphertext,
            storageKind: clip.storageKind,
            payloadId: clip.payloadId,
            r2Key: clip.r2Key,
            metadata: clip.metadata
        )
    }
}

private struct PastaVectors: Decodable {
    let base64Url: Base64Vector
    let stableJson: StableJSONVector
    let signedRequest: SignedRequestVector
    let textClip: TextClipVector
    let bytesClip: BytesClipVector
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

private struct BytesClipVector: Decodable {
    let accountId: String
    let routingId: String
    let groupKey: String
    let bytes: [UInt8]
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
