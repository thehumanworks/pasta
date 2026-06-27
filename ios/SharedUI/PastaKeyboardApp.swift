import Foundation
import KeyboardKit
import PastaCore

extension KeyboardApp {
    static var pasta: KeyboardApp {
        KeyboardApp(
            name: "Pasta",
            appGroupId: PastaCore.appGroupIdentifier,
            locales: [.english]
        )
    }
}
