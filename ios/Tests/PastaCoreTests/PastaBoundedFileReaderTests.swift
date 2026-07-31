import Foundation
import XCTest
@testable import PastaCore

final class PastaBoundedFileReaderTests: XCTestCase {
    func testReadBytesAcceptsAFileAtTheLimit() throws {
        let bytes = Array(repeating: UInt8(7), count: 128 * 1024 + 3)
        let url = try makeTemporaryFile(bytes: bytes)
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertEqual(
            try PastaBoundedFileReader.readBytes(at: url, maximumByteCount: bytes.count),
            bytes
        )
    }

    func testReadBytesRejectsAFileBeforeReadingPastTheLimit() throws {
        let url = try makeTemporaryFile(bytes: [1, 2, 3])
        defer { try? FileManager.default.removeItem(at: url) }

        XCTAssertThrowsError(
            try PastaBoundedFileReader.readBytes(at: url, maximumByteCount: 2)
        ) { error in
            XCTAssertEqual(
                error as? PastaFileError,
                .fileTooLarge(maximumByteCount: 2)
            )
        }
    }

    private func makeTemporaryFile(bytes: [UInt8]) throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("PastaBoundedFileReaderTests-\(UUID().uuidString)")
        try Data(bytes).write(to: url, options: .atomic)
        return url
    }
}
