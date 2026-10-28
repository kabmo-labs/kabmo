/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window: a borderless frame whose page IS the title bar.
 *
 * `WindowStyle = None` + a `WindowChrome` with `CaptionHeight = 0` and
 * `UseAeroCaptionButtons = false` gives:
 *
 * 1. **the resize border** — `WindowChrome` answers `WM_NCHITTEST` for the edges
 *    and the corners, and corrects the maximised geometry, which a bare
 *    `WindowStyle.None` window does not (it covers the taskbar);
 * 2. **no caption band** — the page draws it, and the page decides what is a
 *    drag handle (`data-drag-region` + `app-region: drag`, which WebView2 turns
 *    into `HTCAPTION` once `IsNonClientRegionSupportEnabled` is on);
 * 3. **no system caption buttons** — the page draws those too
 *    (`WindowControls`), because the webview is an HWND and a WPF element
 *    cannot be painted on top of it.
 *
 * Three things are deliberately NOT re-implemented here, because Windows does
 * them better than a hand-written copy: edge/corner resize and the maximised
 * inset (WindowChrome), and the system menu on right-click of a drag region
 * (WebView2's non-client support). Snap Layouts on the maximise button is the
 * one behaviour a page-drawn control genuinely loses, and it is stated in
 * `packages/windows/README.md` rather than papered over.
 */

using System.Windows;
using System.Windows.Controls;
using System.Windows.Shell;
using Microsoft.Web.WebView2.Wpf;

namespace KabmoDesktop.App;

public sealed class ShellWindow : Window
{
    /// <summary>The surface the shell layers the webview and the splash on.</summary>
    public Grid Root { get; }

    public WebView2 WebView { get; }

    public ShellWindow()
    {
        // The app's name, and the ONLY place it is written for the window.
        // A borderless window draws no title bar, so this is not visible — but it
        // is what Alt+Tab, Task Manager, the taskbar's jump list and a screen
        // reader report, and every one of those is wrong if it reads the project
        // name instead.
        Title = "Kabmo";
        Width = 1280;
        Height = 860;
        MinWidth = 720;
        MinHeight = 480;
        WindowStartupLocation = WindowStartupLocation.CenterScreen;
        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.CanResize;
        UseLayoutRounding = true;

        WindowChrome.SetWindowChrome(this, new WindowChrome
        {
            CaptionHeight = 0,
            ResizeBorderThickness = new Thickness(6),
            GlassFrameThickness = new Thickness(0),
            CornerRadius = new CornerRadius(0),
            // The page draws the buttons; the system must not draw a second set.
            UseAeroCaptionButtons = false,
        });

        // `WebView2`, NOT `WebView2CompositionControl`.
        //
        // The composition control is the newer one (it composes with WPF instead
        // of hosting an HWND), and it would fix the airspace problem this shell
        // works around by hiding the webview behind the splash. It does NOT
        // support non-client regions, so `app-region: drag` is ignored there and
        // the window becomes unmovable by its own header — the exact failure the
        // macOS shell was rewritten to fix. If it is ever adopted, the drag has
        // to be re-implemented by hand in the same change.
        WebView = new WebView2
        {
            HorizontalAlignment = HorizontalAlignment.Stretch,
            VerticalAlignment = VerticalAlignment.Stretch,
        };
        Root = new Grid();
        Root.Children.Add(WebView);
        Content = Root;
    }
}
