import CryptoKit
import Foundation
import Security

public enum PastaEncodingError: Error, Equatable {
    case invalidBase64URL
    case invalidUTF8
}

public enum PastaEncoding {
    public static func bytes(_ value: String) -> [UInt8] {
        Array(value.utf8)
    }

    public static func string(_ bytes: [UInt8]) throws -> String {
        guard let value = String(bytes: bytes, encoding: .utf8) else {
            throw PastaEncodingError.invalidUTF8
        }
        return value
    }

    public static func base64URLEncode(_ bytes: [UInt8]) -> String {
        Data(bytes).base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    public static func base64URLDecode(_ value: String) throws -> [UInt8] {
        let remainder = value.count % 4
        let padding = remainder == 0 ? "" : String(repeating: "=", count: 4 - remainder)
        let base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/") + padding
        guard let data = Data(base64Encoded: base64) else {
            throw PastaEncodingError.invalidBase64URL
        }
        return Array(data)
    }

    public static func randomBytes(count: Int) throws -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = SecRandomCopyBytes(kSecRandomDefault, count, &bytes)
        if status != errSecSuccess {
            throw PastaCryptoError.randomFailed
        }
        return bytes
    }

    public static func randomBase64URL(byteCount: Int = 18) throws -> String {
        base64URLEncode(try randomBytes(count: byteCount))
    }

    public static func sha256Base64URL(_ value: String) -> String {
        sha256Base64URL(Array(value.utf8))
    }

    public static func sha256Base64URL(_ bytes: [UInt8]) -> String {
        let digest = SHA256.hash(data: Data(bytes))
        return base64URLEncode(Array(digest))
    }

    public static func stableJSONString<T: Encodable>(_ value: T) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(value)
        guard let text = String(data: data, encoding: .utf8) else {
            throw PastaEncodingError.invalidUTF8
        }
        return text
    }

    public static func canonicalRequest(_ parts: SignedRequestParts) -> String {
        [
            PastaCore.signingVersion,
            parts.method.uppercased(),
            parts.pathWithQuery,
            String(parts.timestamp),
            parts.nonce,
            parts.bodyHash
        ].joined(separator: "\n")
    }
}
