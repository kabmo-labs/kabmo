/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The window's lifetime: the store, the child servers, and the webview's own
 * setup.
 *
 * Split from `Program.cs` so the entry point is four lines of app wiring and
 * this file is the lifecycle — the same split the macOS shell makes between
 * `main.swift`'s `@main` and `AppDelegate`.
 */

using System.Diagnostics;
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
    /// <summary>What the splash is showing. The view only draws it.</summary>
    private SplashState _splashState = SplashState.Done;
    /// <summary>Guards a second close while the shutdown pass is running.</summary>
    private bool _shuttingDown;
    /// <summary>Set once the shutdown pass is done, so its own Close() passes.</summary>
    private bool _allowClose;
    /// <summary>The address the webview has FINISHED on, latched on completion.</summary>
    private string? _shownUrl;
    /// <summary>
    /// The files the OS handed over that the page has not taken yet.
    ///
    /// Filled from the COMMAND LINE, which is how Windows delivers a document:
    /// the installer registers the association against this executable and the
    /// shell passes `"%1"`, so a double-click is a launch that carries a path.
    /// </summary>
    private readonly OpenPathQueue _opened = new();
    /// <summary>True once a page has completed a navigation, so a flush is worth it.</summary>
    private bool _pageReady;
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

    /// <summary>
    /// The architecture this binary was BUILT for, in the console's vocabulary.
    ///
    /// Read from the runtime rather than the OS: an x64 build on an Arm machine
    /// runs under emulation, and it is the x64 artifact that replaces it without
    /// changing how it runs. `ProcessArchitecture` answers exactly that.
    /// </summary>
    private static readonly string ShellArch =
        System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture
            == System.Runtime.InteropServices.Architecture.Arm64
            ? "arm64"
            : "x64";

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
        RenderSplash(SplashState.Connecting);

        // Captured before the window exists: a launch BY document has the path on
        // argv and nothing else, and reading it here means the first navigation
        // completion can hand it over instead of it arriving a reload late.
        _opened.Add(LaunchPaths.From(Environment.GetCommandLineArgs()));

        _window.Loaded += (_, _) => _ = StartAsync();
        // Stop the children on the way out, without parking the UI thread.
        //
        // The previous shape was `_supervisor.StopAllAsync().Wait(6s)` inside
        // `Closed`. It did not deadlock — every await in the library is
        // `ConfigureAwait(false)`, so nothing queues behind the wait — but it
        // still FROZE the window for the whole shutdown: a child that ignores
        // the job kill costs the full 40 x 50 ms budget, which the user sees as
        // a hung app on the way out.
        //
        // `Closing` is the cancellable hook, so it is the one that can defer:
        // cancel the close, run the stop off the UI thread, then close for real
        // and let `ShutdownMode.OnMainWindowClose` end the process. `Closed`
        // cannot defer anything — by then WPF is already tearing the app down.
        _window.Closing += (_, args) =>
        {
            // ONE handler, deliberately. Two handlers would be two votes on one
            // flag: WPF lets any handler clear `Cancel` that another set, so a
            // second `if (_allowClose) args.Cancel = false` would un-cancel the
            // deferred close and the window would vanish before the children
            // were stopped.
            if (_allowClose) return;
            args.Cancel = true;
            if (_shuttingDown) return;
            _shuttingDown = true;
            _ = Task.Run(async () =>
            {
                try
                {
                    await _supervisor.StopAllAsync().ConfigureAwait(false);
                }
                catch
                {
                    // A failed stop must not keep the app alive; the store's
                    // recorded pids are what the next launch adopts.
                }
                finally
                {
                    // Close on the dispatcher — the window is WPF's.
                    await _window.Dispatcher.InvokeAsync(() =>
                    {
                        _allowClose = true;
                        _window.Close();
                    });
                }
            });
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
            RenderSplash(SplashState.Connecting.FailedBecause(SplashState.SplashFailure.Other));
            _splash.SetDetail(
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
        core.NavigationStarting += (_, args) => OnNavigationStarting(args);
        core.NavigationCompleted += (_, args) => OnNavigationCompleted(args);
        core.ProcessFailed += (_, _) =>
        {
            RenderSplash(SplashState.Connecting.FailedBecause(SplashState.SplashFailure.Other));
            _splash.SetDetail("The webview process stopped.");
        };

        var info = new ShellInfo(
            Platform: "windows",
            ShellVersion: ShellVersion,
            OverlayTitlebar: true,
            // The page draws minimise / maximise / close: the webview is an HWND,
            // so nothing the shell renders can sit on top of it.
            WindowControls: true)
        {
            // Every desktop artifact is per-architecture, so the console cannot
            // name one without this — the offer would degrade to a release page.
            Arch = ShellArch,
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(Bridge.BootstrapScript(info));

        _store = new ServerStore(
            new SystemDeps(_supervisor),
            PersistedStore.Read,
            PersistedStore.Write);

        // The palette the console reported on a PREVIOUS launch, so the splash is
        // already the right colour before anything loads.
        _splash.ApplyPalette(_store.Palette());

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
        _shownUrl = null;
        StartLoad(parsed.ToString());
    }

    /// <summary>
    /// Begin a load with the splash up.
    ///
    /// The state is armed BEFORE the navigation, because the navigation can
    /// complete on the same tick (a cached document): arming afterwards would let
    /// the completion land on the previous state and leave the splash hidden.
    /// </summary>
    private void StartLoad(string url)
    {
        RenderSplash(SplashState.Connecting);
        _window.WebView.CoreWebView2?.Navigate(url);
    }

    /// <summary>
    /// A navigation is starting. Two things are decided here, and neither is a
    /// state the shell can ask for afterwards.
    ///
    /// 1. **A RELOAD re-opens the splash.** The console's own Reload control calls
    ///    <c>location.reload()</c>, which replaces the page with a blank document
    ///    while the bundle is re-fetched; leaving the splash hidden there made the
    ///    header's button look like it did nothing. WebView2 reports this
    ///    explicitly as <see cref="CoreWebView2NavigationKind.Reload"/>, so no URL
    ///    comparison is needed here — unlike macOS and iOS, whose delegates have no
    ///    such flag.
    /// 2. **Nothing else re-opens it.** A later in-app navigation (the login submit
    ///    is one) must not flash the splash over a console that is already up.
    /// </summary>
    private void OnNavigationStarting(CoreWebView2NavigationStartingEventArgs args)
    {
        if (args.IsRedirected) return;

        // Where the navigation GOES is decided before the splash question: a link
        // to another origin leaves for the system browser, and cancelling it here
        // is the only place that is possible. Without this every link replaced the
        // console — a trap for the update control the console draws (a desktop
        // offer links the RELEASE PAGE, since every desktop artifact is
        // per-architecture) and already wrong for the release notes, the social
        // links and every citation in a chat.
        var here = _window.WebView.CoreWebView2?.Source;
        if (NavigationPolicy.Decide(here, args.Uri) == NavigationTarget.External)
        {
            args.Cancel = true;
            OpenExternally(args.Uri);
            return;
        }

        if (args.NavigationKind == CoreWebView2NavigationKind.Reload)
        {
            RenderSplash(SplashState.Connecting);
        }
    }

    /// <summary>Hand a URL to the system's default handler.</summary>
    ///
    /// `UseShellExecute` is what makes a URL work at all: without it
    /// `Process.Start` tries to execute the string as a program. A failure is
    /// swallowed — there is nothing else to do with a URL nothing can open, and
    /// the navigation is already cancelled.
    private static void OpenExternally(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // Nothing can open it. The console is still on screen, which is the
            // better outcome than replacing it with a dead page.
        }
    }

    private void OnNavigationCompleted(CoreWebView2NavigationCompletedEventArgs args)
    {
        // A failed main-frame load keeps the splash with the reason, rather than
        // leaving a blank window with nothing on screen to explain it.
        if (!args.IsSuccess)
        {
            var failure = FailureFor(args.WebErrorStatus);
            RenderSplash(_splashState.FailedBecause(failure));
            _splash.SetDetail(DescribeFailure(args.WebErrorStatus));
            return;
        }
        // Latched for the next reload decision, and the splash closes only HERE:
        // the navigation completing is the first moment the document is real.
        _shownUrl = _window.WebView.CoreWebView2?.Source;
        RenderSplash(_splashState.Finished());
        // A page can take the files the OS handed over only once it exists. The
        // launch batch was queued in the constructor, from the command line, and
        // this is the first moment there is a document to hand it to.
        _pageReady = true;
        _ = FlushOpenPathsAsync();
        // The console has painted, so `window.__kabmoPalette()` answers the ACTIVE
        // theme. Stored for the next cold start — the only launch where the splash
        // has no page to ask — and applied to the live splash too, because a theme
        // changed in Settings is exactly the case where the stored palette is
        // stale and the splash it describes is on screen.
        _ = ReadPaletteAsync();
    }

    /// <summary>
    /// Hand the queued files to the page.
    ///
    /// `ExecuteScriptAsync` and not the bridge: the page's handler is a plain
    /// function (`window.__kabmoOpenPaths`), and the answer carries nothing this
    /// side needs — the console reports its own refusals, which is the only place
    /// a sentence about a file can be read.
    /// </summary>
    private async Task FlushOpenPathsAsync()
    {
        if (!_pageReady || _opened.IsEmpty) return;
        var core = _window.WebView.CoreWebView2;
        if (core is null) return;
        var paths = _opened.Take();
        if (paths.Count == 0) return;
        try
        {
            await core.ExecuteScriptAsync(OpenPathsScript.For(paths));
        }
        catch (Exception)
        {
            // A webview that went away mid-script: the paths are lost, which is
            // the same outcome as a page that never loaded.
        }
    }

    /// <summary>
    /// Ask the page which palette it is painting, and keep the answer.
    ///
    /// The property is installed by `src/client/lib/native/palette.ts` before the
    /// first render, so it exists by the time a navigation completes. An older
    /// build answers `null`, the parse returns null, and the stored palette is
    /// left exactly as it was rather than replaced with a colour no theme chose.
    /// </summary>
    private async Task ReadPaletteAsync()
    {
        var core = _window.WebView.CoreWebView2;
        if (core is null || _store is null) return;
        try
        {
            var result = await core.ExecuteScriptAsync("window.__kabmoPalette ? window.__kabmoPalette() : null");
            // WebView2 answers a JS string as JSON — a quoted string — so it is
            // unwrapped here rather than in the parser.
            var wire = System.Text.Json.JsonSerializer.Deserialize<string?>(result);
            var next = ShellPalette.Parse(wire);
            if (next is null) return;
            await _store.SetPaletteAsync(wire);
            _splash.ApplyPalette(next);
        }
        catch (Exception)
        {
            // A page that navigated away mid-script, or a webview that went away:
            // the stored palette is still the previous one, which is correct.
        }
    }

    /// <summary>
    /// Draw a state, and keep the webview hidden until there is something to show.
    ///
    /// A WebView2 is a child HWND, and WPF's composition cannot paint over one: a
    /// splash left visible in the visual tree would be drawn behind the webview and
    /// never seen. Hiding the webview is the only way to cover it, and it is why
    /// the splash is not simply a `Panel` with a higher `Panel.ZIndex`.
    /// </summary>
    private void RenderSplash(SplashState state)
    {
        _splashState = state;
        _splash.Render(state);
        _window.WebView.Visibility = state.Visible ? Visibility.Hidden : Visibility.Visible;
    }

    /// <summary>Why the load failed, in this shell's own vocabulary.</summary>
    private static SplashState.SplashFailure FailureFor(CoreWebView2WebErrorStatus status) => status switch
    {
        CoreWebView2WebErrorStatus.HostNameNotResolved => SplashState.SplashFailure.HostLookup,
        CoreWebView2WebErrorStatus.CannotConnect
            or CoreWebView2WebErrorStatus.ServerUnreachable
            or CoreWebView2WebErrorStatus.ConnectionAborted
            or CoreWebView2WebErrorStatus.ConnectionReset
            or CoreWebView2WebErrorStatus.Disconnected => SplashState.SplashFailure.Connect,
        CoreWebView2WebErrorStatus.Timeout => SplashState.SplashFailure.Timeout,
        CoreWebView2WebErrorStatus.ClientCertificateContainsErrors
            or CoreWebView2WebErrorStatus.CertificateCommonNameIsIncorrect => SplashState.SplashFailure.Ssl,
        _ => SplashState.SplashFailure.Other,
    };

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
                        arch = ShellArch,
                        overlayTitlebar = true,
                        windowControls = true,
                    };

                // Install a newer build of this app, then quit so the installer
                // can replace the running exe.
                //
                // The ANSWER is sent before the shutdown: `Bridge.OnMessage` awaits
                // this method and only then executes the reply script, so closing
                // the window here would kill the answer and leave the console
                // spinning over an update that worked. The shutdown is therefore
                // scheduled, not performed inline.
                case "update_apply":
                {
                    var url = Text(parameters, "url");
                    var version = Text(parameters, "version");
                    var message = await new ShellUpdater().ApplyAsync(url, version, ShellArch, ShellVersion);
                    // DELAYED, not immediate: `Bridge.OnMessage` awaits this
                    // method and only then evaluates the reply script, so a close
                    // posted now would race the answer and the console would keep
                    // a spinner over an update that worked.
                    _ = Task.Delay(600).ContinueWith(
                        _ => _host._window.Dispatcher.Invoke(() => _host._window.Close()),
                        TaskScheduler.Default);
                    return new { success = true, version, message, relaunching = true };
                }

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
