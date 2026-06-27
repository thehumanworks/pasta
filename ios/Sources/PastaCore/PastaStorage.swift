import Foundation
import Security

public enum PastaStorageError: Error, Equatable {
    case appGroupUnavailable
    case keychain(OSStatus)
    case missingSecret(String)
}

public enum PastaSecretName: String, CaseIterable, Sendable {
    case groupKey = "groupKey"
    case signingPrivateKey = "signingPrivateKey"
    case wrappingPrivateKey = "wrappingPrivateKey"
}

public final class PastaKeychainStore {
    private let service: String
    private let accessGroup: String?

    public init(service: String = "Pasta", accessGroup: String? = PastaCore.keychainAccessGroup) {
        self.service = service
        self.accessGroup = accessGroup
    }

    public func set(_ value: String, for name: PastaSecretName) throws {
        var query = baseQuery(name)
        SecItemDelete(query as CFDictionary)
        query[kSecValueData as String] = Data(value.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else { throw PastaStorageError.keychain(status) }
    }

    public func get(_ name: PastaSecretName) throws -> String {
        var query = baseQuery(name)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status != errSecItemNotFound else { throw PastaStorageError.missingSecret(name.rawValue) }
        guard status == errSecSuccess, let data = item as? Data, let value = String(data: data, encoding: .utf8) else {
            throw PastaStorageError.keychain(status)
        }
        return value
    }

    public func deleteAll() {
        for name in PastaSecretName.allCases {
            SecItemDelete(baseQuery(name) as CFDictionary)
        }
    }

    private func baseQuery(_ name: PastaSecretName) -> [String: Any] {
        var query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: name.rawValue
        ]
        if let accessGroup {
            query[kSecAttrAccessGroup as String] = accessGroup
        }
        return query
    }
}

public final class PastaAppGroupStore {
    private let defaults: UserDefaults
    private let configKey = "pasta.device.configuration"
    private let clipsKey = "pasta.keyboard.cachedTextClips"

    public init(appGroupIdentifier: String = PastaCore.appGroupIdentifier) throws {
        guard let defaults = UserDefaults(suiteName: appGroupIdentifier) else {
            throw PastaStorageError.appGroupUnavailable
        }
        self.defaults = defaults
    }

    public init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    public func saveConfiguration(_ configuration: PastaDeviceConfiguration) throws {
        defaults.set(try JSONEncoder().encode(configuration), forKey: configKey)
    }

    public func loadConfiguration() -> PastaDeviceConfiguration? {
        guard let data = defaults.data(forKey: configKey) else { return nil }
        return try? JSONDecoder().decode(PastaDeviceConfiguration.self, from: data)
    }

    public func saveKeyboardClips(_ clips: [PastaKeyboardClip]) throws {
        defaults.set(try JSONEncoder().encode(clips), forKey: clipsKey)
    }

    public func loadKeyboardClips() -> [PastaKeyboardClip] {
        guard let data = defaults.data(forKey: clipsKey),
              let clips = try? JSONDecoder().decode([PastaKeyboardClip].self, from: data)
        else {
            return []
        }
        return clips
    }

    public func clear() {
        defaults.removeObject(forKey: configKey)
        defaults.removeObject(forKey: clipsKey)
    }
}
