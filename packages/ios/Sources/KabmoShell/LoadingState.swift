import Foundation

/// What the launch overlay is showing, as a value.
///
/// Pure on purpose: the rules below are the ones that fail silently in a real
/// `WKWebView` (a late progress estimate resurrecting a finished overlay, an
/// error page's own `didFinish` hiding the failure), and a plain Swift test can
/// pin every one of them without a simulator.
///
/// The bar is INDETERMINATE until the web view reports real progress. A
/// determinate bar sitting at 0 is indistinguishable from a stuck one, and the
/// first seconds of a cold start are exactly when the user is deciding whether
/// the app is broken.
public struct LoadingState: Equatable {

  public enum Phase: Equatable {
    case connecting
    case loading
    case done
    case failed
  }

  /// Why a load failed. The overlay maps each to one sentence.
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

  /// A progress frame from the web view.
  ///
  /// Three rules, each a real ordering the platform produces:
  ///
  /// 1. **A frame after `done` or `failed` is ignored.** Progress estimates
  ///    arrive from the web process and can land after the page finished or after
  ///    an error was reported; adopting one would re-open an overlay the user has
  ///    already moved past.
  /// 2. **Progress never moves backwards within a load.** A redirect restarts the
  ///    document, and `estimatedProgress` runs back to a small value; a bar that
  ///    snaps back reads as a stall. A genuine new load starts from `connecting`,
  ///    not from a progress frame.
  /// 3. **A zero frame stays indeterminate.** The first estimate of a load is
  ///    often 0 (or a sliver), and a determinate bar at 0 is the stuck look these
  ///    rules exist to remove.
  public func progressed(_ value: Int) -> LoadingState {
    if phase == .done || phase == .failed { return self }
    let clamped = min(max(value, 0), 100)
    if clamped == 0 && phase == .connecting { return self }
    return LoadingState(phase: .loading, percent: max(percent, clamped), failure: failure)
  }

  /// A fraction from `WKWebView.estimatedProgress`, as whole percent.
  public func progressed(fraction: Double) -> LoadingState {
    // A non-finite estimate is not progress; `Int(nan)` traps in Swift.
    guard fraction.isFinite else { return self }
    return progressed(Int((fraction * 100).rounded()))
  }

  /// The page finished loading.
  ///
  /// A failure is NOT overwritten: a failed main-frame load still calls
  /// `didFinish` for the error page the web view renders, and adopting that would
  /// hide the explanation behind a blank paper screen — the exact silent state the
  /// overlay exists to remove.
  ///
  /// 100% is not a finish. `estimatedProgress` reaches 1.0 before `didFinish`,
  /// and the server's shell is still fetching the client bundle at that point, so
  /// only this call closes the overlay.
  public func finished() -> LoadingState {
    phase == .failed ? self : LoadingState(phase: .done, percent: percent, failure: nil)
  }

  /// A main-frame load failed; the overlay stays up with the reason and actions.
  public func failedBecause(_ failure: Failure) -> LoadingState {
    LoadingState(phase: .failed, percent: percent, failure: failure)
  }

  /// Nothing to draw: the overlay starts hidden and returns here.
  public static let done = LoadingState(phase: .done)

  /// A load is about to start, or has started and reported nothing yet.
  public static let connecting = LoadingState(phase: .connecting)

  /// Whether a `didStartProvisionalNavigation` means the user asked for the page
  /// again.
  ///
  /// A page's own reload control calls `location.reload()`, which `WKWebView`
  /// reports as an ordinary navigation — no reload flag reaches the navigation
  /// delegate. What it DOES report is the same URL the web view is already
  /// showing, while a `location.href = '/other'` navigation reports a different
  /// one, so the URL is the only signal there is.
  ///
  /// Only a document that has FINISHED counts. `startLoad` arms the overlay
  /// itself before it calls `load`, and the first `didStartProvisionalNavigation`
  /// of a cold start therefore arrives while the web view still shows the previous
  /// document's address — treating that as a reload would restart the state
  /// machine's own arm.
  ///
  /// The comparison is on the FULL URL: a query or hash change is a navigation to
  /// a different view, not a re-fetch.
  public static func isDocumentReload(startedURL: String?, shownURL: String?, phase: Phase) -> Bool {
    guard phase == .done else { return false }
    guard let startedURL, !startedURL.isEmpty else { return false }
    return startedURL == shownURL
  }

  /// `URLError.Code`, as one of our own reasons.
  ///
  /// `URLError` is Foundation rather than UIKit, so this stays testable on a plain
  /// Mac — which is the whole reason the mapping lives here instead of in the
  /// navigation delegate.
  public static func failure(for code: URLError.Code) -> Failure {
    switch code {
    case .cannotFindHost, .dnsLookupFailed:
      return .hostLookup
    case .cannotConnectToHost, .networkConnectionLost, .notConnectedToInternet:
      return .connect
    case .timedOut:
      return .timeout
    case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
         .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid, .clientCertificateRejected:
      return .ssl
    default:
      return .other
    }
  }
}
