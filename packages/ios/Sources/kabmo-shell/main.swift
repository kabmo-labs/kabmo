#if canImport(UIKit)
import UIKit

/// The program's entry point.
///
/// `UIApplicationMain` with an explicit delegate CLASS, rather than the
/// `@UIApplicationMain`/`@main` attribute on `AppDelegate`: SwiftPM's executable
/// target needs a `main.swift` for a top-level entry point, and the attribute
/// cannot be used in a file named `main.swift`. Naming the class here is the same
/// thing the attribute expands to.
///
/// The whole file is guarded by `#if canImport(UIKit)` so the package still builds
/// on macOS, where the shell is meaningless: `swift build` there produces a binary
/// that explains itself and exits, and the LOGIC target — which is what the tests
/// exercise — is unaffected.
UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(AppDelegate.self))
#else
import Foundation

/// A macOS build of an iOS application. `packages/ios/README.md` says why this
/// target exists at all: it keeps `swift build` meaningful on a developer's Mac
/// (the logic target and its tests compile and run), while the application itself
/// only makes sense against the iOS SDK.
FileHandle.standardError.write(
  Data("kabmo-shell is an iOS application. Build it with scripts/build-ipa.sh, or open the package in Xcode.\n".utf8)
)
exit(0)
#endif
