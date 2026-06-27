import XCTest
@testable import PastaCore

final class PastaCoreBootstrapTests: XCTestCase {
    func testBootstrapConstantsMatchNativeIOSContract() {
        XCTAssertEqual(PastaCore.bootstrapVersion, "0.1.0-ios-bootstrap")
        XCTAssertEqual(PastaCore.directoryBundleMIME, "application/vnd.pasta.directory+zip")
        XCTAssertEqual(PastaCore.appGroupIdentifier, "group.com.thehumanworks.pasta")
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
}
