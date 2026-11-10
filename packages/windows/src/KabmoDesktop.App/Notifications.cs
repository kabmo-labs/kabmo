/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * System notifications for the console: a run finished, an agent is blocked on
 * an answer, or a run failed.
 *
 * The console decides WHEN one is sent (three preferences, all off by default);
 * this file owns HOW Windows draws it. An unpackaged WPF app cannot rely on a
 * toast registration in the Start menu, so the notification goes through a
 * notification-area icon — which Windows 10+ presents as a toast in the Action
 * Center, with the standard "notifications from apps" setting still governing
 * whether it is shown.
 */

using System.Drawing;
using System.Windows;
using System.Windows.Forms;

using KabmoDesktop;

namespace KabmoDesktop.App;

public sealed class NotificationHost : IDisposable
{
    private readonly ShellWindow _window;
    private NotifyIcon? _tray;
    /// <summary>The session the banner on screen belongs to.</summary>
    private string _lastSessionId = "";

    public NotificationHost(ShellWindow window) => _window = window;

    /// <summary>Post one notification, replacing the earlier balloon.</summary>
    public void Show(string? title, string? body, string? sessionId)
    {
        // One balloon is on screen at a time, so the click target is the last
        // notification posted.
        _lastSessionId = sessionId ?? "";
        var tray = Tray();
        tray.BalloonTipTitle = NotificationText.Title(title);
        tray.BalloonTipText = body ?? "";
        tray.BalloonTipIcon = ToolTipIcon.None;
        tray.ShowBalloonTip(6000);
    }

    public void Dispose()
    {
        _tray?.Dispose();
        _tray = null;
    }

    private NotifyIcon Tray() => _tray ??= CreateTray();

    private NotifyIcon CreateTray()
    {
        // The exe's own icon, so the banner and the tray entry look like the app
        // the user launched. `ExtractAssociatedIcon` is unavailable for a single
        // file publish with no icon resource, hence the system fallback.
        Icon icon;
        try
        {
            icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? "")
                ?? SystemIcons.Application;
        }
        catch
        {
            icon = SystemIcons.Application;
        }

        var tray = new NotifyIcon
        {
            Icon = icon,
            Text = "Kabmo",
            Visible = true,
        };
        // A click on the banner brings the shell forward instead of doing nothing.
        tray.BalloonTipClicked += (_, _) => Activate();
        return tray;
    }

    private void Activate()
    {
        _window.Show();
        if (_window.WindowState == WindowState.Minimized) _window.WindowState = WindowState.Normal;
        _window.Activate();
        // The click has to LAND on the session, not merely bring the shell
        // forward. The page routes it through `window.__kabmoOpenSession`, which
        // moves the URL the whole console reads.
        if (_lastSessionId.Length == 0) return;
        var script = OpenSessionScript.For(_lastSessionId);
        if (_window.WebView.CoreWebView2 is { } core)
        {
            _ = core.ExecuteScriptAsync(script);
        }
    }
}
