// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "PastaIOS",
    platforms: [
        .iOS(.v17),
        .macOS(.v14)
    ],
    products: [
        .library(name: "PastaCore", targets: ["PastaCore"])
    ],
    dependencies: [
        .package(url: "https://github.com/jedisct1/swift-sodium.git", from: "0.11.0")
    ],
    targets: [
        .target(name: "PastaCore", dependencies: [
            .product(name: "Clibsodium", package: "swift-sodium"),
            .product(name: "Sodium", package: "swift-sodium")
        ]),
        .testTarget(
            name: "PastaCoreTests",
            dependencies: ["PastaCore"],
            resources: [.process("Fixtures")]
        )
    ]
)
