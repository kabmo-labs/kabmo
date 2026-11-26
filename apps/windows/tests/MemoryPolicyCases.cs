/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * What the webview's memory target should be while the window is not on screen.
 *
 * Both failure modes are silent. Never applied, a minimised shell holds the whole
 * render tree for as long as it is left there — measured on this console's WebKit
 * build: 817 MB of physical footprint for one long session, against a 12.6 MB JS
 * heap, so none of it is garbage the page could collect. Applied too eagerly, the
 * engine sheds what it needs and the console stutters the moment the window comes
 * back.
 *
 * WPF reports the two ways of leaving the screen SEPARATELY — a window minimised
 * to the taskbar keeps `IsVisible == true`, and one hidden with `Hide()` keeps
 * `WindowState == Normal` — which is why both are inputs here rather than one.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class MemoryPolicyCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        group("MemoryPolicy");

        check("an on-screen window keeps its normal budget",
            MemoryPolicy.TargetFor(minimized: false, visible: true) == WebViewMemoryTarget.Normal);

        check("a minimised window sheds memory",
            MemoryPolicy.TargetFor(minimized: true, visible: true) == WebViewMemoryTarget.Low);

        check("a hidden window sheds memory",
            MemoryPolicy.TargetFor(minimized: false, visible: false) == WebViewMemoryTarget.Low);

        check("a hidden AND minimised window is still Low",
            MemoryPolicy.TargetFor(minimized: true, visible: false) == WebViewMemoryTarget.Low);
    }
}
