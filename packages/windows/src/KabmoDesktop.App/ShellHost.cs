/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The window's lifetime: the store, the child servers, and the webview's own
 * setup.
 *
 * Split from `Program.cs` so the entry point is four lines of app wiring and
 * this file is the lifecycle — the same split the macOS shell makes between
 * `main.swift`'s `@main` and `AppDelegate`.
 */

using System.IO;
using System.Text.Json;
using System.Windows;
using Microsoft.Web.WebView2.Core;

namespace KabmoDesktop.App;

public sealed class ShellHost
{
    private readonly Supervisor _supervisor = new();
    private readonly ShellWindow _window;
    private readonly SplashView _splash;
    private ServerStore? _store;
    /// <summary>
    /// The shell's own version, from the assembly — never a literal beside it.
    ///
    /// The page shows it and compares it against a published build, so a second
    /// copy of the number in this file is a version that drifts from the exe's
    /// own metadata the first time either is bumped.
    /// </summary>
    private static readonly string ShellVersion =
        typeof(ShellHost).Assembly.GetName().Version is { } version
            ? $"{version.Major}.{version.Minor}.{version.Build}"
            : "0.0.0";

    public Window Window => _window;

    public ShellHost()
    {
        _window = new ShellWindow();
        _splash = new SplashView();
        _window.Root.Children.Add(_splash);
        _splash.OnRetry = () => _ = BootAsync();
        // The webview is an HWND, so WPF content layered over it does not
        // render — a visible splash would sit BEHIND it. The splash is shown by
        // hiding the webview, which is the only way to cover an HWND host.
        ShowSplash();

        _window.Loaded += (_, _) => _ = StartAsync();
        _window.Closed += (_, _) =>
        {
            // A child server must not outlive the window that started it. A
            // force-quit cannot be caught, which is why the store records the pids
            // it spawned — the next launch adopts exactly those.
            //
            // Waiting on the UI thread is safe here because the library awaits
            // with `ConfigureAwait(false)` throughout: nothing inside resumes on
            // this thread, so the continuation cannot be queued behind the wait.
            _supervisor.StopAllAsync().Wait(TimeSpan.FromSeconds(6));
        };
    }

    /// <summary>
    /// Start the shell, and report a failure where the user can see it.
    ///
    /// `InitializeAsync` runs from an event handler, so an exception thrown there
    /// has no caller to catch it: the window would sit on "Starting…" forever with
    /// the reason only in a debugger. A missing WebView2 runtime is the common
    /// case (Windows 10 without the Evergreen update).
    /// </summary>
    private async Task StartAsync()
    {
        try
        {
            await InitializeAsync();
        }
        catch (Exception error)
        {
            ShowSplash();
            _splash.ShowFailure(
                $"{error.Message}\n\nThe WebView2 runtime is required. " +
                "Install it from https://developer.microsoft.com/microsoft-edge/webview2/");
        }
    }

    private async Task InitializeAsync()
    {
        // The user data folder defaults to a directory beside the executable,
        // which is read-only under Program Files — the webview then fails to
        // start with an E_ACCESSDENIED nobody can act on. `%LOCALAPPDATA%` is the
        // documented location for it.
        var userData = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Kabmo",
            "webview");
        Directory.CreateDirectory(userData);
        var environment = await CoreWebView2Environment.CreateAsync(null, userData);
        await _window.WebView.EnsureCoreWebView2Async(environment);

        var core = _window.WebView.CoreWebView2;
        // The page draws the title bar, so it must reach the window's top edge and
        // own the context menu of its own header.
        core.Settings.AreDefaultContextMenusEnabled = true;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = true;
        // `app-region: drag` is what makes the page's header a title bar. It takes
        // effect on the NEXT navigation, so it is set before the first load.
        core.Settings.IsNonClientRegionSupportEnabled = true;

        core.WebMessageReceived += (_, args) => Bridge.OnMessage(_window.WebView, new CommandHost(this), args);
        core.NavigationCompleted += (_, args) => OnNavigationCompleted(args);
        core.ProcessFailed += (_, _) =>
        {
            ShowSplash();
            _splash.ShowFailure("The webview process stopped.");
        };

        var info = new ShellInfo(
            Platform: "windows",
            ShellVersion: ShellVersion,
            OverlayTitlebar: true,
            // The page draws minimise / maximise / close: the webview is an HWND,
            // so nothing the shell renders can sit on top of it.
            WindowControls: true);
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.BootstrapScript(info));

        _store = new ServerStore(
            new SystemDeps(_supervisor),
            PersistedStore.Read,
            PersistedStore.Write);

        await BootAsync();
    }

    private async Task BootAsync()
    {
        if (_store is null) return;
        // Adopt what a previous run of THIS shell left behind before anything
        // reads the list, so the panel's Stop can reach it.
        foreach (var (id, pid) in await _store.OrphanedPidsAsync())
        {
            _supervisor.Adopt(id, pid);
        }

        var state = await _store.SnapshotAsync();
        var url = state.ActiveUrl
            ?? state.Detected.FirstOrDefault()?.Url
            ?? state.Entries.FirstOrDefault(entry => entry.Running)?.Url
            ?? "http://127.0.0.1:3000";
        Navigate(url);
    }

    public void Navigate(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var parsed)) return;
        ShowSplash();
        _window.WebView.CoreWebView2?.Navigate(parsed.ToString());
    }

    private void OnNavigationCompleted(CoreWebView2NavigationCompletedEventArgs args)
    {
        if (args.IsSuccess)
        {
            // The splash covers the window only until the first real page paints.
            // A failed load keeps it, with the reason, rather than showing blank.
            HideSplash();
            return;
        }
        _splash.ShowFailure(DescribeFailure(args.WebErrorStatus));
    }

    /// <summary>
    /// Show the launch surface by HIDING the webview.
    ///
    /// A WebView2 is a child HWND, and WPF's composition cannot paint over one:
    /// a splash left visible in the visual tree would be drawn behind the
    /// webview and never seen. Collapsing the webview is the only way to cover
    /// it, and it is why the splash is not simply a `Panel` with a higher
    /// `Panel.ZIndex`.
    /// </summary>
    private void ShowSplash()
    {
        _splash.Visibility = Visibility.Visible;
        _window.WebView.Visibility = Visibility.Hidden;
    }

    private void HideSplash()
    {
        _splash.Visibility = Visibility.Collapsed;
        _window.WebView.Visibility = Visibility.Visible;
    }

    /// <summary>
    /// The failure in words, because WebView2's status is an enum value.
    ///
    /// The common ones are spelled out; the rest report the enum, which is still
    /// better than "the page did not load".
    /// </summary>
    private static string DescribeFailure(CoreWebView2WebErrorStatus status) => status switch
    {
        CoreWebView2WebErrorStatus.HostNameNotResolved => "That host name does not resolve.",
        CoreWebView2WebErrorStatus.ConnectionAborted or CoreWebView2WebErrorStatus.ConnectionReset =>
            "The connection was refused. Is the server running?",
        CoreWebView2WebErrorStatus.CannotConnect => "Could not connect to that address.",
        CoreWebView2WebErrorStatus.Timeout => "The server did not answer in time.",
        CoreWebView2WebErrorStatus.ServerUnreachable => "The server is unreachable.",
        CoreWebView2WebErrorStatus.ClientCertificateContainsErrors or CoreWebView2WebErrorStatus.CertificateCommonNameIsIncorrect =>
            "The server's certificate is not trusted.",
        CoreWebView2WebErrorStatus.Disconnected => "The connection dropped.",
        _ => $"The page did not load ({status}).",
    };

    /// <summary>The commands the page may issue.</summary>
    private sealed class CommandHost : IShellCommandHost
    {
        private readonly ShellHost _host;

        public CommandHost(ShellHost host) => _host = host;

        public async Task<object?> HandleAsync(string method, JsonElement parameters)
        {
            var store = _host._store ?? throw new ServerException("The shell is still starting.");
            switch (method)
            {
                case "desktop_info":
                    return new
                    {
                        platform = "windows",
                        shellVersion = ShellVersion,
                        overlayTitlebar = true,
                        windowControls = true,
                    };

                case "window_minimize":
                    _host._window.WindowState = WindowState.Minimized;
                    return null;

                case "window_maximize":
                    _host._window.WindowState = _host._window.WindowState == WindowState.Maximized
                        ? WindowState.Normal
                        : WindowState.Maximized;
                    return null;

                case "window_close":
                    _host._window.Close();
                    return null;

                case "servers_state":
                    return await store.SnapshotAsync();

                case "servers_add":
                    await store.AddRemoteAsync(Text(parameters, "label"), Text(parameters, "url"));
                    return await store.SnapshotAsync();

                case "servers_remove":
                {
                    var id = Text(parameters, "id");
                    await store.StopAsync(id);
                    await store.RemoveAsync(id);
                    return await store.SnapshotAsync();
                }

                case "servers_activate":
                {
                    var url = await store.ActivateAsync(Text(parameters, "id"));
                    _host.Navigate(url);
                    return await store.SnapshotAsync();
                }

                case "servers_start":
                {
                    var port = Integer(parameters, "port") ?? Discovery.FreePort();
                    var label = Text(parameters, "label");
                    var started = await store.StartAsync(port, label.Length > 0 ? label : null);
                    _host.Navigate(started.Url);
                    return await store.SnapshotAsync();
                }

                case "servers_stop":
                    await store.StopAsync(Text(parameters, "id"));
                    return await store.SnapshotAsync();

                default:
                    throw new ServerException($"Unknown shell command: {method}");
            }
        }

        public void Navigate(string url) => _host.Navigate(url);

        private static string Text(JsonElement parameters, string name) =>
            parameters.ValueKind == JsonValueKind.Object &&
            parameters.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.String
                ? value.GetString() ?? ""
                : "";

        private static int? Integer(JsonElement parameters, string name) =>
            parameters.ValueKind == JsonValueKind.Object &&
            parameters.TryGetProperty(name, out var value) &&
            value.ValueKind == JsonValueKind.Number &&
            value.TryGetInt32(out var number)
                ? number
                : null;
    }
}
