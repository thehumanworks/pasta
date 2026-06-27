import Foundation

public enum PastaFileError: Error, Equatable {
    case unsafeFileName
}

public struct PastaDownloadedFileClip: Equatable, Sendable {
    public let clip: StoredClip
    public let bytes: [UInt8]
    public let metadata: ClipMetadata?
    public let suggestedFileName: String

    public init(clip: StoredClip, bytes: [UInt8], metadata: ClipMetadata?, suggestedFileName: String) {
        self.clip = clip
        self.bytes = bytes
        self.metadata = metadata
        self.suggestedFileName = suggestedFileName
    }
}

public enum PastaFileNames {
    public static func sanitized(_ name: String?, fallback: String = "output.bin") -> String {
        let raw = (name?.isEmpty == false ? name : nil) ?? fallback
        let last = raw.split(whereSeparator: { $0 == "/" || $0 == "\\" }).last.map(String.init) ?? fallback
        let replaced = last
            .replacingOccurrences(of: "\0", with: "")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if replaced == "." || replaced == ".." || replaced.isEmpty {
            return fallback
        }
        return replaced
    }

    public static func exportName(metadataName: String?, payloadKind: String, mime: String) -> String {
        let fallback = defaultOutputName(payloadKind: payloadKind, mime: mime)
        var name = sanitized(metadataName, fallback: fallback)
        if mime == PastaCore.directoryBundleMIME, !name.lowercased().hasSuffix(".zip") {
            name += ".zip"
        }
        return name
    }

    public static func defaultOutputName(payloadKind: String, mime: String) -> String {
        if mime == PastaCore.directoryBundleMIME {
            return "output-directory.zip"
        }
        if payloadKind == "image" {
            return "output.\(extensionForMime(mime))"
        }
        return "output.\(extensionForMime(mime))"
    }

    public static func extensionForMime(_ mime: String) -> String {
        switch mime.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "image/png":
            return "png"
        case "image/jpeg", "image/jpg":
            return "jpg"
        case "image/gif":
            return "gif"
        case "image/heic":
            return "heic"
        case "application/pdf":
            return "pdf"
        case "application/zip", PastaCore.directoryBundleMIME:
            return "zip"
        case "text/plain":
            return "txt"
        default:
            return "bin"
        }
    }
}

public final class PastaTemporaryFileStore {
    public let directory: URL
    private let fileManager: FileManager

    public init(
        directory: URL = FileManager.default.temporaryDirectory.appendingPathComponent("PastaExport-\(UUID().uuidString)", isDirectory: true),
        fileManager: FileManager = .default
    ) throws {
        self.directory = directory
        self.fileManager = fileManager
        try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    public func stageFile(bytes: [UInt8], suggestedName: String?, fallbackName: String = "output.bin") throws -> URL {
        let filename = PastaFileNames.sanitized(suggestedName, fallback: fallbackName)
        let url = directory.appendingPathComponent(filename, isDirectory: false)
        try Data(bytes).write(to: url, options: [.atomic])
        return url
    }

    public func cleanup() throws {
        if fileManager.fileExists(atPath: directory.path) {
            try fileManager.removeItem(at: directory)
        }
    }
}
