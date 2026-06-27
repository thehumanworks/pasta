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
    targets: [
        .target(name: "PastaCore"),
        .testTarget(name: "PastaCoreTests", dependencies: ["PastaCore"])
    ]
)
