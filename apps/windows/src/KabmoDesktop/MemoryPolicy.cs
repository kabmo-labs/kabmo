/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the webview's memory target should be, given what the window is doing.
 *
 * The console is a single WebView2 holding a long transcript, a code editor and
 * up to eight xterm buffers, so its renderer is the largest thing the shell
 * owns. Measured on the WebKit builds of this same console (macOS shell, same
 * page): 817 MB of physical footprint for one long session, of which the JS heap
 * was 12.6 MB — the rest is the render tree and graphics layers, which the shell
 * cannot free and the engine will not shrink while the window is in front.
 *
 * `CoreWebView2.MemoryUsageTargetLevel` is the one lever WebView2 gives for that,
 * and it is exactly the case documented for it: an app that becomes invisible but
 * must keep scripts and sockets alive. `Low` asks the engine to shed what it can
 * while the page keeps running — which is why this is used instead of
 * `TrySuspendAsync`, that being for a webview that has nothing to keep alive.
 *
 * The rule is here, in the core project, because it is a decision with a silent
 * failure on both sides: too eager and the console stutters on the way back to the
 * foreground, never applied and a minimised shell sits on hundreds of megabytes
 * for as long as it is left there.
 */
namespace KabmoDesktop;

/// <summary>Which memory target the webview should be held at.</summary>
public enum WebViewMemoryTarget
{
    /// <summary>The window is on screen: the engine keeps its normal budget.</summary>
    Normal,

    /// <summary>The window is minimised or hidden: shed what can be rebuilt.</summary>
    Low,
}

public static class MemoryPolicy
{
    /// <summary>
    /// The target for a window that is minimised or not visible.
    ///
    /// Both conditions are checked because WPF reports them separately: a window
    /// minimised to the taskbar keeps `IsVisible == true`, and one hidden with
    /// `Hide()` keeps `WindowState == Normal`.
    /// </summary>
    public static WebViewMemoryTarget TargetFor(bool minimized, bool visible) =>
        minimized || !visible ? WebViewMemoryTarget.Low : WebViewMemoryTarget.Normal;
}
