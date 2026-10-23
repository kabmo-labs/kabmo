/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 What the launch splash is showing, as a value.

 The same four phases and the same five failure reasons as the Android and iOS
 shells (`LoadingState`), because the three surfaces answer one question and a
 user who moves between them should not have to read a different sentence. Pure
 on purpose: every rule below is an ordering `WKWebView` really produces, and each
 one fails as a splash that is stuck, missing or lying — none of which throws.

 The bar is INDETERMINATE until a real estimate arrives. A determinate bar sitting
 at 0 is indistinguishable from a stuck one, and the first seconds of a cold start
 are exactly when the user decides whether the app is broken.
 */

import Foundation

public struct SplashState: Equatable {

  public enum Phase: Equatable {
    /// The load has begun and reported nothing yet.
    case connecting
    /// A real estimate has arrived.
    case loading
    /// The page finished. The only phase that draws nothing.
    case done
    /// The main frame failed; the splash stays up with the reason.
    case failed
  }

  /// Why a load failed. `sentence(for:)` maps each to one line of prose.
  public enum Failure: Equatable {
    case hostLookup
    case connect
    case timeout
    case ssl
    case other
  }

  public let phase: Phase
  public let percent: Int
  public let failure: Failure?

  public init(phase: Phase, percent: Int = 0, failure: Failure? = nil) {
    self.phase = phase
    self.percent = percent
    self.failure = failure
  }

  /// `done` is the only state that draws nothing.
  public var visible: Bool { phase != .done }

  /// No progress has been reported yet, so the bar has no meaningful value.
  public var indeterminate: Bool { phase == .connecting }

  public static let done = SplashState(phase: .done)
  public static let connecting = SplashState(phase: .connecting)

  /// Fold one `estimatedProgress` estimate into the state.
  ///
  /// Three rules, each a real ordering:
  ///
  /// 1. **A frame after `done` or `failed` is ignored.** Estimates arrive from
  ///    the web process and can land after the page finished or after an error
  ///    was reported; adopting one would re-open a splash the user moved past.
  /// 2. **Progress never moves backwards within a load.** A redirect restarts
  ///    the document and `estimatedProgress` runs back to a small value; a bar
  ///    that snaps back reads as a stall. A genuine new load starts from
  ///    `connecting`, not from an estimate.
  /// 3. **A zero estimate stays indeterminate.** The first estimate of a load is
  ///    often 0, which would draw the stuck-at-zero bar rules 1 and 3 exist to
  ///    avoid.
  public func progressed(_ value: Int) -> SplashState {
    if phase == .done || phase == .failed { return self }
    let clamped = min(max(value, 0), 100)
    if clamped == 0 && phase == .connecting { return self }
    return SplashState(phase: .loading, percent: max(percent, clamped), failure: failure)
  }

  /// `WKWebView.estimatedProgress` is a fraction; `Int(nan)` traps in Swift.
  public func progressed(fraction: Double) -> SplashState {
    guard fraction.isFinite else { return self }
    return progressed(Int((fraction * 100).rounded()))
  }

  /// The page finished loading.
  ///
  /// A failure is NOT overwritten: a failed main-frame load still calls
  /// `didFinish` for the error page the web view renders, and adopting that would
  /// hide the explanation behind a blank paper window — the silent state the
  /// splash exists to remove.
  ///
  /// 100% is not a finish. `estimatedProgress` reaches 1.0 before `didFinish`,
  /// and the server is still fetching the client bundle at that point, so only
  /// this call closes the splash.
  public func finished() -> SplashState {
    phase == .failed ? self : SplashState(phase: .done, percent: percent)
  }

  /// A main-frame load failed; the splash stays up with the reason and Retry.
  public func failedBecause(_ failure: Failure) -> SplashState {
    SplashState(phase: .failed, percent: percent, failure: failure)
  }

  /// Whether a navigation that just started is the user asking for the page
  /// again.
  ///
  /// The console's own Reload control calls `location.reload()`, which WebKit
  /// reports as an ordinary navigation — no reload flag reaches the delegate.
  /// What it DOES report is the same address the web view already shows, while a
  /// `location.href = '/other'` navigation reports a different one, so the URL is
  /// the only signal there is.
  ///
  /// Only a document that has FINISHED counts. `load` arms the splash itself
  /// before it calls `load`, and the first `didStartProvisionalNavigation` of a
  /// cold start therefore arrives while the web view still shows the previous
  /// document's address — treating that as a reload would restart the state
  /// machine's own arm.
  ///
  /// The comparison is on the FULL URL: a query or hash change is a navigation to
  /// a different view, not a re-fetch.
  public static func isDocumentReload(started: String?, shown: String?, phase: Phase) -> Bool {
    guard phase == .done else { return false }
    guard let started, !started.isEmpty else { return false }
    return started == shown
  }

  /// The one line of prose for a state. Stated here rather than in the view so
  /// the wording is testable and cannot drift between the phases.
  public func sentence() -> String {
    switch phase {
    case .connecting:
      return "Connecting to the server…"
    case .loading:
      return "Loading the console… \(percent)%"
    case .failed:
      return Self.sentence(for: failure ?? .other)
    case .done:
      return ""
    }
  }

  /// One sentence per reason. The failure cases are what the user needs to tell
  /// apart — a server that is off, a wrong address and an untrusted certificate
  /// all look identical behind a blank window.
  public static func sentence(for failure: Failure) -> String {
    switch failure {
    case .hostLookup:
      return "The server address could not be found. Check the host and that this machine is on the same network."
    case .connect:
      return "Could not connect. Check that Kabmo is running and the port is right."
    case .timeout:
      return "The server did not answer in time. It may still be starting."
    case .ssl:
      return "The certificate is not trusted. Check the server address and its certificate."
    case .other:
      return "The console could not be loaded. Retry, or check the server address."
    }
  }

  /// `URLError.Code`, as one of our own reasons.
  ///
  /// Foundation rather than AppKit, so the mapping is testable without a window
  /// server — which is the whole reason it lives here and not in the delegate.
  public static func failure(for error: Error) -> Failure {
    let code = (error as NSError).code
    if code == NSURLErrorCancelled { return .other }
    switch URLError.Code(rawValue: code) {
    case .cannotFindHost, .dnsLookupFailed:
      return .hostLookup
    case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
      return .connect
    case .timedOut:
      return .timeout
    case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
         .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid,
         .clientCertificateRejected:
      return .ssl
    default:
      return .other
    }
  }
}
