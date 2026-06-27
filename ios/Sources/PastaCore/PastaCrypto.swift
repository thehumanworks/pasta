import Clibsodium
import CryptoKit
import Foundation
import Sodium

public enum PastaCryptoError: Error, Equatable {
    case randomFailed
    case invalidKey
    case invalidToken
    case invalidGrant
    case cryptoFailed
    case unsupportedPayloadKind
    case aadMismatch
}

public struct PastaKeyPair: Equatable, Sendable {
    public let privateKey: String
    public let publicKey: String
}

public struct PastaDeviceKeyMaterial: Equatable, Sendable {
    public let signing: PastaKeyPair
    public let wrapping: PastaKeyPair
}

public struct TextClipEncryptionInput: Equatable, Sendable {
    public let accountId: String
    public let routingId: String
    public let originDeviceId: String
    public let plaintext: String
    public let groupKey: String
    public let keyVersion: Int
    public let clipId: String?
    public let createdAt: Int64?
    public let expiresAt: Int64?
    public let nonce: String?

    public init(
        accountId: String,
        routingId: String,
        originDeviceId: String,
        plaintext: String,
        groupKey: String,
        keyVersion: Int = 1,
        clipId: String? = nil,
        createdAt: Int64? = nil,
        expiresAt: Int64? = nil,
        nonce: String? = nil
    ) {
        self.accountId = accountId
        self.routingId = routingId
        self.originDeviceId = originDeviceId
        self.plaintext = plaintext
        self.groupKey = groupKey
        self.keyVersion = keyVersion
        self.clipId = clipId
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.nonce = nonce
    }
}

public enum PastaCrypto {

    public static func generateGroupKey() throws -> String {
        PastaEncoding.base64URLEncode(try PastaEncoding.randomBytes(count: 32))
    }

    public static func generateSigningKeyPair(seed: [UInt8]? = nil) throws -> PastaKeyPair {
        let seedBytes = try seed ?? PastaEncoding.randomBytes(count: Sodium().sign.SeedBytes)
        guard let keyPair = Sodium().sign.keyPair(seed: seedBytes) else {
            throw PastaCryptoError.invalidKey
        }
        return PastaKeyPair(
            privateKey: PastaEncoding.base64URLEncode(seedBytes),
            publicKey: PastaEncoding.base64URLEncode(keyPair.publicKey)
        )
    }

    public static func generateWrappingKeyPair(seed: [UInt8]? = nil) throws -> PastaKeyPair {
        let privateKey = try seed.map { try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data($0)) }
            ?? Curve25519.KeyAgreement.PrivateKey()
        return PastaKeyPair(
            privateKey: PastaEncoding.base64URLEncode(Array(privateKey.rawRepresentation)),
            publicKey: PastaEncoding.base64URLEncode(Array(privateKey.publicKey.rawRepresentation))
        )
    }

    public static func generateDeviceKeyMaterial() throws -> PastaDeviceKeyMaterial {
        PastaDeviceKeyMaterial(signing: try generateSigningKeyPair(), wrapping: try generateWrappingKeyPair())
    }

    public static func signCanonicalRequest(parts: SignedRequestParts, privateKey: String) throws -> String {
        let seed = try PastaEncoding.base64URLDecode(privateKey)
        guard let keyPair = Sodium().sign.keyPair(seed: seed),
              let signature = Sodium().sign.signature(
                message: PastaEncoding.bytes(PastaEncoding.canonicalRequest(parts)),
                secretKey: keyPair.secretKey
              )
        else {
            throw PastaCryptoError.invalidKey
        }
        return PastaEncoding.base64URLEncode(signature)
    }

    public static func encryptTextClip(_ input: TextClipEncryptionInput) throws -> EncryptedClip {
        let plaintextBytes = PastaEncoding.bytes(input.plaintext)
        let nonce = try input.nonce.map(PastaEncoding.base64URLDecode)
        let clipId = try input.clipId ?? "clip_\(PastaEncoding.randomBase64URL(byteCount: 16))"
        let createdAt = input.createdAt ?? Int64(Date().timeIntervalSince1970 * 1000)
        let aad = ClipAAD(
            accountId: input.accountId,
            routingId: input.routingId,
            clipId: clipId,
            originDeviceId: input.originDeviceId,
            createdAt: createdAt,
            payloadKind: "text",
            mime: PastaCore.textMime,
            byteLen: plaintextBytes.count,
            keyVersion: input.keyVersion
        )
        let aadBytes = PastaEncoding.bytes(try PastaEncoding.stableJSONString(aad))
        let groupKey = try PastaEncoding.base64URLDecode(input.groupKey)
        let encrypted: (authenticatedCipherText: Bytes, nonce: Bytes)?
        if let nonce {
            encrypted = encryptWithNonce(message: plaintextBytes, key: groupKey, nonce: nonce, additionalData: aadBytes)
        } else {
            encrypted = Sodium().aead.xchacha20poly1305ietf.encrypt(
                message: plaintextBytes,
                secretKey: groupKey,
                additionalData: aadBytes
            )
        }
        guard let encrypted else { throw PastaCryptoError.cryptoFailed }
        return EncryptedClip(
            clipId: clipId,
            originDeviceId: input.originDeviceId,
            createdAt: createdAt,
            expiresAt: input.expiresAt,
            payloadKind: "text",
            mime: PastaCore.textMime,
            byteLen: plaintextBytes.count,
            keyVersion: input.keyVersion,
            nonce: PastaEncoding.base64URLEncode(encrypted.nonce),
            aadHash: clipAADHash(aad),
            ciphertext: PastaEncoding.base64URLEncode(encrypted.authenticatedCipherText)
        )
    }

    public static func decryptTextClip(
        groupKey: String,
        accountId: String,
        routingId: String,
        clip: EncryptedClip
    ) throws -> String {
        guard clip.payloadKind == "text" else { throw PastaCryptoError.unsupportedPayloadKind }
        let aad = aadForClip(accountId: accountId, routingId: routingId, clip: clip)
        guard clipAADHash(aad) == clip.aadHash else { throw PastaCryptoError.aadMismatch }
        guard let decrypted = Sodium().aead.xchacha20poly1305ietf.decrypt(
            authenticatedCipherText: try PastaEncoding.base64URLDecode(clip.ciphertext),
            secretKey: try PastaEncoding.base64URLDecode(groupKey),
            nonce: try PastaEncoding.base64URLDecode(clip.nonce),
            additionalData: PastaEncoding.bytes(try PastaEncoding.stableJSONString(aad))
        ) else {
            throw PastaCryptoError.cryptoFailed
        }
        return try PastaEncoding.string(decrypted)
    }

    public static func wrapGroupKey(
        groupKey: String,
        senderPrivateKey: String,
        senderPublicKey: String,
        recipientPublicKey: String,
        nonce: String? = nil
    ) throws -> String {
        let nonceBytes = try nonce.map(PastaEncoding.base64URLDecode) ?? PastaEncoding.randomBytes(count: 24)
        let key = try deriveWrapKey(privateKey: senderPrivateKey, ownPublicKey: senderPublicKey, peerPublicKey: recipientPublicKey)
        guard let encrypted = encryptWithNonce(
            message: try PastaEncoding.base64URLDecode(groupKey),
            key: key,
            nonce: nonceBytes,
            additionalData: PastaEncoding.bytes("pasta.group-key-wrap.v1")
        ) else {
            throw PastaCryptoError.cryptoFailed
        }
        let envelope = WrappedGroupKeyEnvelope(
            v: 1,
            alg: "X25519-HKDF-SHA256-XChaCha20-Poly1305",
            senderWrapPublicKey: senderPublicKey,
            nonce: PastaEncoding.base64URLEncode(encrypted.nonce),
            ciphertext: PastaEncoding.base64URLEncode(encrypted.authenticatedCipherText)
        )
        return try PastaEncoding.stableJSONString(envelope)
    }

    public static func unwrapGroupKey(wrappedGroupKey: String, recipientPrivateKey: String, recipientPublicKey: String) throws -> String {
        let envelope = try JSONDecoder().decode(WrappedGroupKeyEnvelope.self, from: Data(PastaEncoding.bytes(wrappedGroupKey)))
        let key = try deriveWrapKey(
            privateKey: recipientPrivateKey,
            ownPublicKey: recipientPublicKey,
            peerPublicKey: envelope.senderWrapPublicKey
        )
        guard let groupKey = Sodium().aead.xchacha20poly1305ietf.decrypt(
            authenticatedCipherText: try PastaEncoding.base64URLDecode(envelope.ciphertext),
            secretKey: key,
            nonce: try PastaEncoding.base64URLDecode(envelope.nonce),
            additionalData: PastaEncoding.bytes("pasta.group-key-wrap.v1")
        ) else {
            throw PastaCryptoError.cryptoFailed
        }
        return PastaEncoding.base64URLEncode(groupKey)
    }

    public static func aadForClip(accountId: String, routingId: String, clip: EncryptedClip) -> ClipAAD {
        ClipAAD(
            accountId: accountId,
            routingId: routingId,
            clipId: clip.clipId,
            originDeviceId: clip.originDeviceId,
            createdAt: clip.createdAt,
            payloadKind: clip.payloadKind,
            mime: clip.mime,
            byteLen: clip.byteLen,
            keyVersion: clip.keyVersion
        )
    }

    public static func clipAADHash(_ aad: ClipAAD) -> String {
        (try? PastaEncoding.sha256Base64URL(PastaEncoding.stableJSONString(aad))) ?? ""
    }

    public static func parseJoinGrantToken(_ token: String) throws -> JoinGrantToken {
        let parts = token.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard parts.count == 6, parts[0] == "pasta_join_v1" else { throw PastaCryptoError.invalidToken }
        let endpoint = try PastaEncoding.string(PastaEncoding.base64URLDecode(parts[1]))
        guard let url = URL(string: endpoint), !parts[2].isEmpty, !parts[3].isEmpty, !parts[4].isEmpty, !parts[5].isEmpty else {
            throw PastaCryptoError.invalidToken
        }
        return JoinGrantToken(endpoint: url, accountId: parts[2], grantId: parts[3], redeemSecret: parts[4], sealSecret: parts[5])
    }

    public static func parseJoinGrantTokenFromUserInput(_ input: String) throws -> JoinGrantToken {
        guard let token = extractJoinGrantToken(from: input) else { throw PastaCryptoError.invalidToken }
        return try parseJoinGrantToken(token)
    }

    public static func extractJoinGrantToken(from input: String) -> String? {
        let pattern = #"pasta_join_v1(?:\.[A-Za-z0-9_-]+){5}"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
        let range = NSRange(input.startIndex..<input.endIndex, in: input)
        guard let match = expression.firstMatch(in: input, range: range),
              let tokenRange = Range(match.range, in: input)
        else {
            return nil
        }
        return String(input[tokenRange])
    }

    public static func openJoinGrant(sealedGroupKey: String, accountId: String, grantId: String, sealSecret: String) throws -> String {
        let parsed = try JSONDecoder().decode(SealedJoinGrant.self, from: Data(PastaEncoding.bytes(sealedGroupKey)))
        guard parsed.v == 1, parsed.aad.accountId == accountId, parsed.aad.grantId == grantId else {
            throw PastaCryptoError.invalidGrant
        }
        let key = deriveJoinGrantSealKey(accountId: accountId, grantId: grantId, sealSecret: sealSecret)
        let aad = try PastaEncoding.stableJSONString(parsed.aad)
        guard let opened = Sodium().aead.xchacha20poly1305ietf.decrypt(
            authenticatedCipherText: try PastaEncoding.base64URLDecode(parsed.ciphertext),
            secretKey: key,
            nonce: try PastaEncoding.base64URLDecode(parsed.nonce),
            additionalData: PastaEncoding.bytes(aad)
        ) else {
            throw PastaCryptoError.cryptoFailed
        }
        return PastaEncoding.base64URLEncode(opened)
    }

    private static func deriveJoinGrantSealKey(accountId: String, grantId: String, sealSecret: String) -> [UInt8] {
        let input = SymmetricKey(data: Data((try? PastaEncoding.base64URLDecode(sealSecret)) ?? []))
        let salt = Data(PastaEncoding.bytes("pasta-join-seal-salt-v1\u{0}\(accountId)\u{0}\(grantId)"))
        let info = Data(PastaEncoding.bytes("pasta-join-seal-v1"))
        let key = HKDF<SHA256>.deriveKey(inputKeyMaterial: input, salt: salt, info: info, outputByteCount: 32)
        return bytes(from: key)
    }

    private static func deriveWrapKey(privateKey: String, ownPublicKey: String, peerPublicKey: String) throws -> [UInt8] {
        let ownPublic = try PastaEncoding.base64URLDecode(ownPublicKey)
        let peerPublic = try PastaEncoding.base64URLDecode(peerPublicKey)
        let first: [UInt8]
        let second: [UInt8]
        if PastaEncoding.base64URLEncode(ownPublic) < PastaEncoding.base64URLEncode(peerPublic) {
            first = ownPublic
            second = peerPublic
        } else {
            first = peerPublic
            second = ownPublic
        }
        let privateKey = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: Data(PastaEncoding.base64URLDecode(privateKey)))
        let publicKey = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: Data(peerPublic))
        let shared = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
        let info = Data(PastaEncoding.bytes("pasta.wrap.info.v1") + first + second)
        let key = shared.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: Data(PastaEncoding.bytes("pasta.wrap.salt.v1")),
            sharedInfo: info,
            outputByteCount: 32
        )
        return bytes(from: key)
    }

    private static func bytes(from key: SymmetricKey) -> [UInt8] {
        key.withUnsafeBytes { buffer in
            Array(buffer)
        }
    }

    private static func encryptWithNonce(message: [UInt8], key: [UInt8], nonce: [UInt8], additionalData: [UInt8]) -> (authenticatedCipherText: Bytes, nonce: Bytes)? {
        let aead = Sodium().aead.xchacha20poly1305ietf
        guard key.count == aead.KeyBytes,
              nonce.count == aead.NonceBytes
        else { return nil }
        var cipherText = Bytes(repeating: 0, count: message.count + aead.ABytes)
        var cipherTextLength: UInt64 = 0
        let status = crypto_aead_xchacha20poly1305_ietf_encrypt(
            &cipherText,
            &cipherTextLength,
            message,
            UInt64(message.count),
            additionalData,
            UInt64(additionalData.count),
            nil,
            nonce,
            key
        )
        guard status == 0 else { return nil }
        return (cipherText, nonce)
    }
}

private struct SealedJoinGrant: Codable {
    let v: Int
    let alg: String?
    let aad: JoinGrantAAD
    let nonce: String
    let ciphertext: String
}

private struct WrappedGroupKeyEnvelope: Codable {
    let v: Int
    let alg: String
    let senderWrapPublicKey: String
    let nonce: String
    let ciphertext: String
}

private struct JoinGrantAAD: Codable {
    let accountId: String
    let grantId: String
    let keyVersion: Int
    let deviceTtlMs: Int64?
    let tokenExpiresAt: Int64
    let maxUses: Int
}
