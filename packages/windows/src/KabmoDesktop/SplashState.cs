/**
 * @license
 * SPDX-License-Identifier: MIT
 */

namespace KabmoDesktop;

/// <summary>
/// What the launch splash is showing, as a value.
///
/// The same four phases and the same five failure reasons as the Android, iOS and
/// macOS shells, because the four surfaces answer one question and a user who moves
/// between them should not have to read a different sentence. Pure on purpose:
/// every rule below is an ordering WebView2 really produces, and each one fails as
/// a splash that is stuck, missing or lying — none of which throws.
///
/// The bar is INDETERMINATE until a real estimate arrives. A determinate bar
/// sitting at 0 is indistinguishable from a stuck one, and the first seconds of a
/// cold start are exactly when the user decides whether the app is broken.
/// </summary>
public sealed class SplashState : IEquatable<SplashState>
{
    public enum SplashPhase
    {
        /// <summary>The load has begun and reported nothing yet.</summary>
        Connecting,
        /// <summary>A real estimate has arrived.</summary>
        Loading,
        /// <summary>The page finished. The only phase that draws nothing.</summary>
        Done,
        /// <summary>The main frame failed; the splash stays up with the reason.</summary>
        Failed,
    }

    /// <summary>Why a load failed. <see cref="Sentence()"/> maps each to one line.</summary>
    public enum SplashFailure
    {
        HostLookup,
        Connect,
        Timeout,
        Ssl,
        Other,
    }

    public SplashPhase Phase { get; }
    public int Percent { get; }
    public SplashFailure? Failure { get; }

    public SplashState(SplashPhase phase, int percent = 0, SplashFailure? failure = null)
    {
        Phase = phase;
        Percent = percent;
        Failure = failure;
    }

    /// <summary><c>Done</c> is the only state that draws nothing.</summary>
    public bool Visible => Phase != SplashPhase.Done;

    /// <summary>No progress has been reported yet, so the bar has no meaningful value.</summary>
    public bool Indeterminate => Phase == SplashPhase.Connecting;

    public static SplashState Done { get; } = new(SplashPhase.Done);
    public static SplashState Connecting { get; } = new(SplashPhase.Connecting);

    /// <summary>
    /// Fold one progress report into the state.
    ///
    /// Three rules, each a real ordering:
    ///
    /// 1. <b>A frame after <c>Done</c> or <c>Failed</c> is ignored.</b> Reports
    ///    arrive from the web process and can land after the page finished or after
    ///    an error was reported; adopting one would re-open a splash the user moved
    ///    past.
    /// 2. <b>Progress never moves backwards within a load.</b> A redirect restarts
    ///    the document and the estimate runs back to a small value; a bar that snaps
    ///    back reads as a stall. A genuine new load starts from <c>Connecting</c>,
    ///    not from a report.
    /// 3. <b>A zero report stays indeterminate.</b> The first report of a load is
    ///    often 0, which would draw the stuck-at-zero bar rules 1 and 3 exist to
    ///    avoid.
    /// </summary>
    public SplashState Progressed(int value)
    {
        if (Phase == SplashPhase.Done || Phase == SplashPhase.Failed) return this;
        var clamped = Math.Clamp(value, 0, 100);
        if (clamped == 0 && Phase == SplashPhase.Connecting) return this;
        return new SplashState(SplashPhase.Loading, Math.Max(Percent, clamped), Failure);
    }

    /// <summary>
    /// The page finished loading.
    ///
    /// A failure is NOT overwritten: a failed main-frame load still reports
    /// completion for the error page the webview renders, and adopting that would
    /// hide the explanation behind a blank window — the silent state the splash
    /// exists to remove.
    ///
    /// 100% is not a finish. The estimate reaches 100 before the navigation
    /// completes, and the server is still fetching the client bundle at that point,
    /// so only this call closes the splash.
    /// </summary>
    public SplashState Finished() =>
        Phase == SplashPhase.Failed ? this : new SplashState(SplashPhase.Done, Percent);

    /// <summary>A main-frame load failed; the splash stays up with the reason and Retry.</summary>
    public SplashState FailedBecause(SplashFailure failure) =>
        new(SplashPhase.Failed, Percent, failure);

    /// <summary>
    /// Whether a navigation that just started is the user asking for the page again.
    ///
    /// The console's own Reload control calls <c>location.reload()</c>, which
    /// WebView2 reports as an ordinary navigation — no reload flag reaches the
    /// host. What it DOES report is the same address the webview already shows,
    /// while a <c>location.href = '/other'</c> navigation reports a different one,
    /// so the URL is the only signal there is.
    ///
    /// Only a document that has FINISHED counts. <c>Navigate</c> arms the splash
    /// itself before it calls the webview, and the first navigation of a cold start
    /// therefore arrives while the webview still shows the previous document's
    /// address — treating that as a reload would restart the state machine's own
    /// arm.
    ///
    /// The comparison is on the FULL URL: a query or hash change is a navigation to
    /// a different view, not a re-fetch.
    /// </summary>
    public static bool IsDocumentReload(string? started, string? shown, SplashPhase phase) =>
        phase == SplashPhase.Done && !string.IsNullOrEmpty(started) && started == shown;

    /// <summary>The one line of prose for a state, stated here so it is testable.</summary>
    public string Sentence() => Phase switch
    {
        SplashPhase.Connecting => "Connecting to the server…",
        SplashPhase.Loading => $"Loading the console… {Percent}%",
        SplashPhase.Failed => SentenceFor(Failure ?? SplashFailure.Other),
        _ => "",
    };

    /// <summary>
    /// One sentence per reason. The failure cases are what the user needs to tell
    /// apart — a server that is off, a wrong address and an untrusted certificate
    /// all look identical behind a blank window.
    /// </summary>
    public static string SentenceFor(SplashFailure failure) => failure switch
    {
        SplashFailure.HostLookup =>
            "The server address could not be found. Check the host and that this machine is on the same network.",
        SplashFailure.Connect => "Could not connect. Check that Kabmo is running and the port is right.",
        SplashFailure.Timeout => "The server did not answer in time. It may still be starting.",
        SplashFailure.Ssl => "The certificate is not trusted. Check the server address and its certificate.",
        _ => "The console could not be loaded. Retry, or check the server address.",
    };

    public bool Equals(SplashState? other) =>
        other is not null && other.Phase == Phase && other.Percent == Percent && other.Failure == Failure;

    public override bool Equals(object? obj) => Equals(obj as SplashState);

    public override int GetHashCode() => HashCode.Combine(Phase, Percent, Failure);
}
