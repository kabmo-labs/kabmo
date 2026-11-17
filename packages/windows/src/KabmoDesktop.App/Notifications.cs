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
 *
 * ## The sound
 *
 * A balloon tip has no "play this file" slot, so `NotifyIcon.ShowBalloonTip`
 * always plays Windows' own notification sound. That is why this file talks to
 * `Shell_NotifyIcon` directly: `NIIF_NOSOUND` suppresses the platform tone, and
 * `PlaySound` plays the Kabmo chime the other shells carry. The two cues stay
 * distinct — a climbing chime for `finish`/`error`, a falling one for `ask` —
 * and `kind` selects which.
 *
 * The chimes are embedded in this assembly from `packages/notification-sound/`
 * and written to `%TEMP%` once (rewritten when the bytes differ, so an updated
 * exe does not keep playing the previous cue). `SND_NODEFAULT` means a missing
 * file is silence rather than the system beep.
 */

using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

using KabmoDesktop;

namespace KabmoDesktop.App;

public sealed class NotificationHost : IDisposable
{
    private const int WM_USER = 0x0400;
    private const int WM_TRAYICON = WM_USER + 1;
    private const int NIN_BALLOONUSERCLICK = 0x0405;

    private const uint NIM_ADD = 0;
    private const uint NIM_MODIFY = 1;
    private const uint NIM_DELETE = 2;

    private const uint NIF_MESSAGE = 0x00000001;
    private const uint NIF_ICON = 0x00000002;
    private const uint NIF_TIP = 0x00000004;
    private const uint NIF_INFO = 0x00000010;

    private const uint NIIF_NOSOUND = 0x00000010;

    private const uint SND_FILENAME = 0x00020000;
    private const uint SND_ASYNC = 0x00000001;
    private const uint SND_NODEFAULT = 0x00000002;

    private readonly ShellWindow _window;
    private readonly HwndSource _source;
    private readonly HwndSourceHook _hook;
    private readonly Icon _icon;
    private readonly bool _ownsIcon;
    private NOTIFYICONDATA _data;
    private bool _added;
    /// <summary>The session the banner on screen belongs to.</summary>
    private string _lastSessionId = "";

    public NotificationHost(ShellWindow window)
    {
        _window = window;
        var hwnd = new WindowInteropHelper(window).EnsureHandle();
        _source = HwndSource.FromHwnd(hwnd)
            ?? throw new InvalidOperationException("The window has no message source.");
        _hook = WndProc;
        _source.AddHook(_hook);

        var extracted = ExtractIcon();
        _ownsIcon = extracted is not null;
        _icon = extracted ?? SystemIcons.Application;

        _data = new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = hwnd,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = WM_TRAYICON,
            hIcon = _icon.Handle,
            szTip = "Kabmo",
            szInfo = "",
            szInfoTitle = "",
            guidItem = Guid.Empty,
        };
        _added = Shell_NotifyIcon(NIM_ADD, ref _data);
        // A previous process that crashed can leave the icon registered; adding
        // again fails, but modifying the existing entry still works.
        if (!_added) _added = Shell_NotifyIcon(NIM_MODIFY, ref _data);
    }

    /// <summary>Post one notification, replacing the earlier balloon.</summary>
    public void Show(string? title, string? body, string? kind, string? sessionId)
    {
        // One balloon is on screen at a time, so the click target is the last
        // notification posted.
        _lastSessionId = sessionId ?? "";
        _data.uFlags = NIF_INFO;
        _data.szInfoTitle = Clip(NotificationText.Title(title), 63);
        _data.szInfo = Clip(body ?? "", 255);
        // The platform tone is what this replaces: the Kabmo chime is played
        // below, and hearing both would be two sounds for one banner.
        _data.dwInfoFlags = NIIF_NOSOUND;
        _data.uTimeoutOrVersion = 6000;
        Shell_NotifyIcon(NIM_MODIFY, ref _data);
        PlayChime(kind);
    }

    public void Dispose()
    {
        if (_added) Shell_NotifyIcon(NIM_DELETE, ref _data);
        _added = false;
        try { _source.RemoveHook(_hook); } catch { /* the source may already be gone */ }
        if (_ownsIcon) _icon.Dispose();
    }

    private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
    {
        if (msg != WM_TRAYICON) return IntPtr.Zero;
        // The low word of lParam is the notification-area event; only a click
        // on the balloon has an action.
        if (((int)lParam.ToInt64() & 0xFFFF) == NIN_BALLOONUSERCLICK) Activate();
        handled = true;
        return IntPtr.Zero;
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

    private static string Clip(string text, int max) => text.Length <= max ? text : text[..max];

    private static Icon? ExtractIcon()
    {
        try
        {
            // The exe's own icon, so the banner and the tray entry look like the
            // app the user launched. Unavailable for a single-file publish with
            // no icon resource, hence the system fallback.
            return Icon.ExtractAssociatedIcon(Environment.ProcessPath ?? "");
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Play the chime for `kind`, suppressing the system's own notification tone.
    ///
    /// The WAVs are embedded resources, written to `%TEMP%` once and rewritten
    /// when the bytes differ — an updated exe must not keep playing the previous
    /// cue from the old file. `SND_NODEFAULT` keeps a missing file silent rather
    /// than turning it into the system beep.
    /// </summary>
    private static void PlayChime(string? kind)
    {
        var path = ChimePath(NotificationChime.FileNameFor(kind));
        if (path is null) return;
        PlaySound(path, IntPtr.Zero, SND_FILENAME | SND_ASYNC | SND_NODEFAULT);
    }

    private static string? ChimePath(string name)
    {
        try
        {
            using var source = typeof(NotificationHost).Assembly.GetManifestResourceStream(name);
            if (source is null) return null;
            using var buffer = new MemoryStream();
            source.CopyTo(buffer);
            var bytes = buffer.ToArray();

            var directory = Path.Combine(Path.GetTempPath(), "Kabmo");
            Directory.CreateDirectory(directory);
            var path = Path.Combine(directory, name);
            if (!File.Exists(path) || !File.ReadAllBytes(path).AsSpan().SequenceEqual(bytes))
            {
                File.WriteAllBytes(path, bytes);
            }
            return path;
        }
        catch
        {
            // A read-only temp dir must not cost the banner itself.
            return null;
        }
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uTimeoutOrVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(uint dwMessage, ref NOTIFYICONDATA lpData);

    [DllImport("winmm.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool PlaySound(string? pszSound, IntPtr hmod, uint fdwSound);
}
