import Foundation
import KabmoShell

/// The launch overlay's state machine.
///
/// Every rule here is an ordering the platform actually produces, and each one
/// fails as a stuck or missing overlay rather than as an exception — which is why
/// they are pinned without a simulator. `WKNavigationDelegate`'s callbacks are:
/// `didStartProvisionalNavigation`, a stream of `estimatedProgress`, then `didFinish`,
/// and a failed main-frame load adds `didFailProvisionalNavigation` and STILL fires
/// `didFinish` for the error page the web view renders.
enum LoadingStateTests {
  static func run() {
    Harness.group("LoadingState — the bar")

    Harness.check("starts hidden, so a console already up draws nothing", !LoadingState.done.visible)
    Harness.check("connecting is visible", LoadingState.connecting.visible)
    Harness.check("connecting is indeterminate", LoadingState.connecting.indeterminate)

    let first = LoadingState.connecting.progressed(35)
    Harness.equal("first real progress becomes determinate", first.phase, .loading)
    Harness.equal("…with its own percent", first.percent, 35)
    Harness.check("…and no longer indeterminate", !first.indeterminate)

    // The web view's first estimate is often 0 or a sliver. Adopting it draws a
    // determinate bar at 0 — the "stuck" look the overlay removes.
    let zero = LoadingState.connecting.progressed(0)
    Harness.check("zero progress stays indeterminate", zero.indeterminate)
    Harness.equal("…at 0", zero.percent, 0)

    // A redirect restarts the document and `estimatedProgress` runs backwards. A
    // bar that snaps back reads as a stall.
    Harness.equal("progress never moves backwards", LoadingState.connecting.progressed(100).progressed(10).percent, 100)
    Harness.equal("progress is clamped at the top", LoadingState.connecting.progressed(140).percent, 100)
    Harness.equal("progress is clamped at the bottom", LoadingState.connecting.progressed(-5).percent, 0)

    Harness.group("LoadingState — finish and failure")

    let finished = LoadingState.connecting.progressed(80).finished()
    Harness.check("finished hides the overlay", !finished.visible)
    Harness.equal("…and is done", finished.phase, .done)

    // A compositor estimate can land after the page finished; adopting it would
    // re-open an overlay the user has already moved past.
    let done = LoadingState.connecting.finished()
    Harness.equal("progress after finished is ignored", done.progressed(40).phase, .done)
    Harness.equal("…and keeps the percent it had", done.progressed(40).percent, done.percent)

    // The web view renders an error page and then calls `didFinish`. Hiding the
    // overlay there leaves a blank paper screen with no reason.
    let failed = LoadingState.connecting.failedBecause(.connect)
    let afterErrorPage = failed.finished()
    Harness.equal("a failure survives the error page's own didFinish", afterErrorPage.phase, .failed)
    Harness.equal("…with its reason", afterErrorPage.failure, .connect)
    Harness.check("…and stays visible", afterErrorPage.visible)
    Harness.equal("progress after a failure is ignored", failed.progressed(60).phase, .failed)

    // `didStartProvisionalNavigation` begins every document. Re-using the previous
    // state left a reload's bar pinned at the finished load's 100%.
    let reload = LoadingState.connecting
    Harness.check("a new load starts indeterminate", reload.indeterminate)
    Harness.equal("…at 0", reload.percent, 0)

    Harness.group("LoadingState — a fraction from the web view")

    Harness.equal("0.42 becomes 42%", LoadingState.connecting.progressed(fraction: 0.42).percent, 42)
    Harness.equal("a sliver stays indeterminate", LoadingState.connecting.progressed(fraction: 0.001).percent, 0)
    Harness.check(
      "…and indeterminate",
      LoadingState.connecting.progressed(fraction: 0.001).indeterminate
    )
    // `Int(nan)` traps in Swift, so a non-finite estimate must not reach it.
    Harness.equal("NaN is not progress", LoadingState.connecting.progressed(fraction: .nan).phase, .connecting)
    Harness.equal("infinity is not progress", LoadingState.connecting.progressed(fraction: .infinity).phase, .connecting)

    Harness.group("LoadingState — what a reload is")

    let shown = "http://192.168.1.20:3000/"

    // The page's own Reload control calls `location.reload()`, which `WKWebView`
    // reports as an ordinary navigation — the same URL is the only signal.
    Harness.check(
      "the address already on screen is a reload",
      LoadingState.isDocumentReload(startedURL: shown, shownURL: shown, phase: .done)
    )
    Harness.check(
      "a navigation to another address is not a reload",
      !LoadingState.isDocumentReload(
        startedURL: "http://192.168.1.20:3000/?sessionId=abc",
        shownURL: shown,
        phase: .done
      )
    )
    Harness.check(
      "the same path on another origin is not a reload",
      !LoadingState.isDocumentReload(
        startedURL: "http://192.168.1.20:3001/",
        shownURL: shown,
        phase: .done
      )
    )

    // `startLoad` arms the overlay itself before it calls `load`, so the first
    // `didStartProvisionalNavigation` of a cold start arrives with the PREVIOUS
    // document's address latched. Treating that as a reload would restart the arm it
    // just made.
    Harness.check(
      "an unfinished load is never a reload",
      !LoadingState.isDocumentReload(startedURL: shown, shownURL: shown, phase: .connecting)
    )
    Harness.check(
      "…nor while it is loading",
      !LoadingState.isDocumentReload(startedURL: shown, shownURL: shown, phase: .loading)
    )
    Harness.check(
      "a failed load is not a reload",
      !LoadingState.isDocumentReload(startedURL: shown, shownURL: shown, phase: .failed)
    )
    Harness.check(
      "no started URL is never a reload",
      !LoadingState.isDocumentReload(startedURL: nil, shownURL: shown, phase: .done)
    )

    Harness.group("LoadingState — error codes")

    Harness.equal("host lookup", LoadingState.failure(for: .cannotFindHost), .hostLookup)
    Harness.equal("DNS", LoadingState.failure(for: .dnsLookupFailed), .hostLookup)
    Harness.equal("refused connection", LoadingState.failure(for: .cannotConnectToHost), .connect)
    Harness.equal("offline", LoadingState.failure(for: .notConnectedToInternet), .connect)
    Harness.equal("timeout", LoadingState.failure(for: .timedOut), .timeout)
    Harness.equal("untrusted certificate", LoadingState.failure(for: .serverCertificateUntrusted), .ssl)
    Harness.equal("expired certificate", LoadingState.failure(for: .serverCertificateHasBadDate), .ssl)
    Harness.equal("anything else", LoadingState.failure(for: .badURL), .other)
  }
}
