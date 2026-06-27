import Foundation

public struct SignedRequestParts: Codable, Equatable, Sendable {
    public let method: String
    public let pathWithQuery: String
    public let timestamp: Int64
    public let nonce: String
    public let bodyHash: String

    public init(method: String, pathWithQuery: String, timestamp: Int64, nonce: String, bodyHash: String) {
        self.method = method
        self.pathWithQuery = pathWithQuery
        self.timestamp = timestamp
        self.nonce = nonce
        self.bodyHash = bodyHash
    }
}

public struct ClipAAD: Codable, Equatable, Sendable {
    public let accountId: String
    public let routingId: String
    public let clipId: String
    public let originDeviceId: String
    public let createdAt: Int64
    public let payloadKind: String
    public let mime: String
    public let byteLen: Int
    public let keyVersion: Int
}

public struct EncryptedClipMetadata: Codable, Equatable, Sendable {
    public let nonce: String
    public let ciphertext: String
}

public struct ClipMetadata: Codable, Equatable, Sendable {
    public let name: String?

    public init(name: String? = nil) {
        self.name = name
    }
}

public struct EncryptedClip: Codable, Equatable, Sendable {
    public let clipId: String
    public let originDeviceId: String
    public let createdAt: Int64
    public let expiresAt: Int64?
    public let payloadKind: String
    public let mime: String
    public let byteLen: Int
    public let keyVersion: Int
    public let nonce: String
    public let aadHash: String
    public let ciphertext: String
    public let storageKind: String?
    public let payloadId: String?
    public let r2Key: String?
    public let metadata: EncryptedClipMetadata?

    public init(
        clipId: String,
        originDeviceId: String,
        createdAt: Int64,
        expiresAt: Int64?,
        payloadKind: String,
        mime: String,
        byteLen: Int,
        keyVersion: Int,
        nonce: String,
        aadHash: String,
        ciphertext: String,
        storageKind: String? = nil,
        payloadId: String? = nil,
        r2Key: String? = nil,
        metadata: EncryptedClipMetadata? = nil
    ) {
        self.clipId = clipId
        self.originDeviceId = originDeviceId
        self.createdAt = createdAt
        self.expiresAt = expiresAt
        self.payloadKind = payloadKind
        self.mime = mime
        self.byteLen = byteLen
        self.keyVersion = keyVersion
        self.nonce = nonce
        self.aadHash = aadHash
        self.ciphertext = ciphertext
        self.storageKind = storageKind
        self.payloadId = payloadId
        self.r2Key = r2Key
        self.metadata = metadata
    }
}

public struct StoredClip: Codable, Equatable, Sendable {
    public let seq: Int
    public let clipId: String
    public let originDeviceId: String
    public let createdAt: Int64
    public let expiresAt: Int64?
    public let payloadKind: String
    public let mime: String
    public let byteLen: Int
    public let keyVersion: Int
    public let nonce: String
    public let aadHash: String
    public let ciphertext: String
    public let storageKind: String?
    public let payloadId: String?
    public let r2Key: String?
    public let metadata: EncryptedClipMetadata?

    public var encryptedClip: EncryptedClip {
        EncryptedClip(
            clipId: clipId,
            originDeviceId: originDeviceId,
            createdAt: createdAt,
            expiresAt: expiresAt,
            payloadKind: payloadKind,
            mime: mime,
            byteLen: byteLen,
            keyVersion: keyVersion,
            nonce: nonce,
            aadHash: aadHash,
            ciphertext: ciphertext,
            storageKind: storageKind,
            payloadId: payloadId,
            r2Key: r2Key,
            metadata: metadata
        )
    }
}

public struct PastaDeviceConfiguration: Codable, Equatable, Sendable {
    public let endpoint: URL
    public let accountId: String
    public let routingId: String
    public let deviceId: String
    public let deviceName: String
    public let verifyPublicKey: String
    public let wrapPublicKey: String
    public let keyVersion: Int

    public init(
        endpoint: URL,
        accountId: String,
        routingId: String,
        deviceId: String,
        deviceName: String,
        verifyPublicKey: String,
        wrapPublicKey: String,
        keyVersion: Int
    ) {
        self.endpoint = endpoint
        self.accountId = accountId
        self.routingId = routingId
        self.deviceId = deviceId
        self.deviceName = deviceName
        self.verifyPublicKey = verifyPublicKey
        self.wrapPublicKey = wrapPublicKey
        self.keyVersion = keyVersion
    }
}

public struct PairingGrantRedeemResponse: Codable, Equatable, Sendable {
    public let accountId: String
    public let routingId: String
    public let deviceId: String
    public let sealedGroupKey: String
    public let keyVersion: Int
    public let tokenExpiresAt: Int64
    public let deviceExpiresAt: Int64?
    public let deviceTtlMs: Int64?
    public let maxUses: Int
}

public struct JoinGrantToken: Equatable, Sendable {
    public let endpoint: URL
    public let accountId: String
    public let grantId: String
    public let redeemSecret: String
    public let sealSecret: String
}
