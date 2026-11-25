// swift-tools-version: 5.10
//
// POCKET — platform-independent core.
//
// This package holds the code that does not need Apple frameworks: the timing
// math (`PocketDomain`) and a command-line timing log. The iPad app (SwiftUI +
// AVAudioEngine) will be an Xcode project that depends on this package, so the
// clock math can be tested on any machine, including Linux CI.

import PackageDescription

let package = Package(
    name: "Pocket",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "PocketDomain", targets: ["PocketDomain"]),
        .executable(name: "pocket-timing-log", targets: ["TimingLog"]),
    ],
    targets: [
        .target(
            name: "PocketDomain",
            path: "Domain"
        ),
        .executableTarget(
            name: "TimingLog",
            dependencies: ["PocketDomain"],
            path: "Tools/TimingLog"
        ),
        .testTarget(
            name: "PocketDomainTests",
            dependencies: ["PocketDomain"],
            path: "Tests/DomainTests"
        ),
    ]
)
