/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's own test runner.
 *
 * A plain console app, not an xunit project, for the same reason the macOS
 * shell's is a plain executable: the rules under test need nothing but the
 * library, and a runner that exits non-zero on a failure is what CI gates on.
 * It runs on ANY machine — including the macOS box this was written on — because
 * `KabmoDesktop` is `net8.0` and carries no Win32.
 *
 * Every case below is a way the panel could LIE, because none of them throws in
 * the app: a row that offers Stop for a process the shell did not start looks
 * exactly like a row that offers it for one it did.
 *
 * Ported from `packages/macos/Tests/main.swift`; the fixtures are the same
 * shapes, so the two suites check the same rules.
 */

using KabmoDesktop;
using KabmoDesktopTests;

var failures = 0;
var checks = 0;

void Check(string label, bool condition)
{
    checks++;
    if (condition)
    {
        Console.WriteLine($"  ok   {label}");
        return;
    }
    failures++;
    Console.WriteLine($"  FAIL {label}");
}

async Task CheckAsync(string label, Func<Task<bool>> body)
{
    bool result;
    try
    {
        result = await body();
    }
    catch (Exception error)
    {
        checks++;
        failures++;
        Console.WriteLine($"  FAIL {label} — threw {error.GetType().Name}: {error.Message}");
        return;
    }
    Check(label, result);
}

void ThrowsError(string label, Action body)
{
    checks++;
    try
    {
        body();
        failures++;
        Console.WriteLine($"  FAIL {label} — did not throw");
    }
    catch (ServerException)
    {
        Console.WriteLine($"  ok   {label}");
    }
    catch (Exception error)
    {
        failures++;
        Console.WriteLine($"  FAIL {label} — threw {error.GetType().Name}");
    }
}

void Group(string name) => Console.WriteLine($"\n{name}");

// ---------------------------------------------------------------- URL rules

Group("ServerAddress.Normalise");
Check("host:port gains http", ServerAddress.Normalise("192.168.1.10:3000") == "http://192.168.1.10:3000");
Check("https is kept", ServerAddress.Normalise("https://kabmo.example.com") == "https://kabmo.example.com");
Check("a trailing slash is the root", ServerAddress.Normalise("  http://10.0.0.2:8080/  ") == "http://10.0.0.2:8080");
// A base path is refused rather than dropped: the client asks for /api/... at the
// domain root, so a page served from /kabmo/ would load and then fail everything.
ThrowsError("a base path is refused", () => ServerAddress.Normalise("https://host/kabmo/"));
ThrowsError("a non-http scheme is refused", () => ServerAddress.Normalise("ftp://host"));
ThrowsError("credentials in the url are refused", () => ServerAddress.Normalise("http://user:pass@host:3000"));
ThrowsError("an empty value is refused", () => ServerAddress.Normalise("   "));

Group("ServerAddress.Id");
Check("local ids are keyed by port", ServerAddress.Id(ServerKind.Managed, 3001) == "local:3001");
Check("remote ids are keyed by url", ServerAddress.Id(ServerKind.Remote, "http://nas:8443") == "remote:http://nas:8443");

// ------------------------------------------------------------------- the store

Group("ServerStore");

await CheckAsync("a stored server reports whether it answers", async () =>
{
    var deps = new FakeDeps();
    deps.Health["http://127.0.0.1:3001"] = new Health { Version = "0.5.3", Mode = "prod", Pid = 42, StartedAt = "t0" };
    var (store, _) = MakeStore(deps, new PersistedState
    {
        Entries = new[]
        {
            new StoredServer { Id = "remote:http://nas:8443", Label = "NAS", Url = "http://nas:8443", Kind = ServerKind.Remote },
            new StoredServer { Id = "local:3001", Label = "Local :3001", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 },
        },
        ActiveId = "local:3001",
    });
    var state = await store.SnapshotAsync();
    return state.Entries.Select(entry => entry.Running).SequenceEqual(new[] { false, true })
        && state.ActiveUrl == "http://127.0.0.1:3001";
});

await CheckAsync("detected servers exclude the ones already stored", async () =>
{
    var deps = new FakeDeps();
    deps.Detected.Add(Entry("local:3001", "http://127.0.0.1:3001", 3001));
    deps.Detected.Add(Entry("local:3000", "http://127.0.0.1:3000", 3000));
    var (store, _) = MakeStore(deps, new PersistedState
    {
        Entries = new[] { new StoredServer { Id = "local:3001", Label = "Mine", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 } },
    });
    var state = await store.SnapshotAsync();
    return state.Detected.Select(entry => entry.Id).SequenceEqual(new[] { "local:3000" });
});

// `owned` is the whole safety property of the Stop button.
await CheckAsync("owned comes from the recorded pid, never from discovery", async () =>
{
    var deps = new FakeDeps();
    deps.Health["http://127.0.0.1:3001"] = new Health();
    deps.Health["http://127.0.0.1:7920"] = new Health();
    var (store, _) = MakeStore(deps, new PersistedState
    {
        Entries = new[]
        {
            new StoredServer { Id = "local:3001", Label = "Spawned", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 },
            new StoredServer { Id = "local:7920", Label = "Hand-started", Url = "http://127.0.0.1:7920", Kind = ServerKind.Managed, Port = 7920 },
        },
        Spawned = new Dictionary<string, int> { ["local:3001"] = 111 },
    });
    var state = await store.SnapshotAsync();
    return state.Entries.Select(entry => entry.Owned).SequenceEqual(new[] { true, false });
});

await CheckAsync("a duplicate url is refused", async () =>
{
    var (store, _) = MakeStore(new FakeDeps(), new PersistedState
    {
        Entries = new[] { new StoredServer { Id = "remote:http://nas:8443", Label = "NAS", Url = "http://nas:8443", Kind = ServerKind.Remote } },
    });
    try
    {
        await store.AddRemoteAsync("Again", "nas:8443");
        return false;
    }
    catch (ServerException)
    {
        return true;
    }
});

await CheckAsync("a successful switch returns the url and is persisted", async () =>
{
    var deps = new FakeDeps();
    deps.Health["http://127.0.0.1:3001"] = new Health();
    deps.Health["http://127.0.0.1:3002"] = new Health();
    var (store, saved) = MakeStore(deps, new PersistedState
    {
        Entries = new[]
        {
            new StoredServer { Id = "local:3001", Label = "One", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 },
            new StoredServer { Id = "local:3002", Label = "Two", Url = "http://127.0.0.1:3002", Kind = ServerKind.Managed, Port = 3002 },
        },
        ActiveId = "local:3001",
    });
    var url = await store.ActivateAsync("local:3002");
    return url == "http://127.0.0.1:3002" && saved.Last?.ActiveId == "local:3002";
});

// Switching to a local server that is DOWN starts it; a remote one is refused.
await CheckAsync("activating a stopped local server starts it", async () =>
{
    var deps = new FakeDeps();
    var (store, _) = MakeStore(deps, new PersistedState
    {
        Entries = new[]
        {
            new StoredServer { Id = "local:3001", Label = "Local :3001", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 },
            new StoredServer { Id = "remote:http://nas:8443", Label = "NAS", Url = "http://nas:8443", Kind = ServerKind.Remote },
        },
    });
    var url = await store.ActivateAsync("local:3001");
    if (url != "http://127.0.0.1:3001" || !deps.Started.SequenceEqual(new[] { 3001 })) return false;

    try
    {
        await store.ActivateAsync("remote:http://nas:8443");
        return false;
    }
    catch (ServerException)
    {
        return true;
    }
});

// A detected server is connectable and is ADOPTED by connecting.
await CheckAsync("a detected server is connectable and adopted", async () =>
{
    var deps = new FakeDeps();
    deps.Health["http://127.0.0.1:7920"] = new Health();
    deps.Detected.Add(Entry("local:7920", "http://127.0.0.1:7920", 7920));
    var (store, saved) = MakeStore(deps, new PersistedState());
    var url = await store.ActivateAsync("local:7920");
    return url == "http://127.0.0.1:7920" && saved.Last?.Entries.Count == 1;
});

// The pid is the whole claim: a port already served records no pid.
await CheckAsync("a port already served records no pid", async () =>
{
    var deps = new FakeDeps { StartPid = null };
    deps.Health["http://127.0.0.1:3001"] = new Health();
    var (store, saved) = MakeStore(deps, new PersistedState());
    await store.StartAsync(3001);
    return saved.Last is { Spawned.Count: 0 };
});

await CheckAsync("starting selects the new server and records the pid", async () =>
{
    var deps = new FakeDeps { StartPid = 4242 };
    var (store, saved) = MakeStore(deps, new PersistedState());
    var started = await store.StartAsync(3007);
    return started.Id == "local:3007"
        && saved.Last?.Spawned.TryGetValue("local:3007", out var pid) == true
        && pid == 4242;
});

await CheckAsync("stopping clears the recorded pid", async () =>
{
    var deps = new FakeDeps { StartPid = 9 };
    deps.Health["http://127.0.0.1:3001"] = new Health();
    var (store, saved) = MakeStore(deps, new PersistedState
    {
        Entries = new[] { new StoredServer { Id = "local:3001", Label = "L", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 } },
        Spawned = new Dictionary<string, int> { ["local:3001"] = 9 },
    });
    await store.StopAsync("local:3001");
    return saved.Last is { Spawned.Count: 0 };
});

// Adoption is limited to the pids this shell recorded, and only while they answer.
await CheckAsync("orphans are only the recorded pids that still answer", async () =>
{
    var deps = new FakeDeps();
    deps.Detected.Add(Entry("local:3001", "http://127.0.0.1:3001", 3001));
    var (store, _) = MakeStore(deps, new PersistedState
    {
        Spawned = new Dictionary<string, int> { ["local:3001"] = 111, ["local:3002"] = 222 },
    });
    var orphans = await store.OrphanedPidsAsync();
    return orphans.Count == 1 && orphans["local:3001"] == 111;
});

await CheckAsync("removing drops the row, the pid and the selection", async () =>
{
    var (store, saved) = MakeStore(new FakeDeps(), new PersistedState
    {
        Entries = new[] { new StoredServer { Id = "local:3001", Label = "L", Url = "http://127.0.0.1:3001", Kind = ServerKind.Managed, Port = 3001 } },
        ActiveId = "local:3001",
        Spawned = new Dictionary<string, int> { ["local:3001"] = 9 },
    });
    await store.RemoveAsync("local:3001");
    return saved.Last is { Entries.Count: 0, ActiveId: null, Spawned.Count: 0 };
});

// ---------------------------------------------------------------- wire format

Group("WireFormat");

// The client compares `entry.kind === 'managed'`. Without the string converter
// this is `1`, every row reads as a remote server, and the Stop button vanishes
// from the servers this window started — a bug with no error anywhere.
var wire = System.Text.Json.JsonSerializer.Serialize(
    new ServersState
    {
        Entries = new[]
        {
            new ServerEntry
            {
                Id = "local:3001", Label = "Local :3001", Url = "http://127.0.0.1:3001",
                Kind = ServerKind.Managed, Port = 3001, Running = true, Owned = true, Source = "stored",
            },
        },
        ActiveId = "local:3001",
    },
    WireFormat.Options);

Check("the kind is a string, not an enum ordinal", wire.Contains("\"kind\":\"managed\""));
Check("the remote kind is spelled out too",
    System.Text.Json.JsonSerializer.Serialize(ServerKind.Remote, WireFormat.Options) == "\"remote\"");
Check("keys are camelCase", wire.Contains("\"activeId\":\"local:3001\""));
Check("an absent field is omitted, not null", !wire.Contains("\"version\""));
Check("a boolean is a JSON boolean", wire.Contains("\"running\":true"));

// ------------------------------------------------------------- paths and state

Group("paths");

Check("the shell's list lives outside the data directory",
    !PersistedStore.StateFilePath().Contains(Path.Combine(".kabmo", "")));
Check("the state file is named servers.json",
    Path.GetFileName(PersistedStore.StateFilePath()) == "servers.json");
// The folder carries the app's NAME, not its project name: a user who finds
// %APPDATA%\Kabmo\servers.json has found the app they installed, while
// %APPDATA%\kabmo-desktop\ is a build detail that outlived the build.
Check("the state folder is the app's name",
    Path.GetFileName(Path.GetDirectoryName(PersistedStore.StateFilePath())) == "Kabmo");
Check("a free port is bindable",
    Discovery.FreePort() is > 0 and < 65536);

Group("LaunchPlan");
// On a machine with no Kabmo install the refusal is the honest answer; on a
// machine with one it resolves. Both are asserted as *a* decision, because the
// point is that it never returns a plan with an empty program.
try
{
    var plan = LaunchPlan.Resolve();
    Check("a resolved launch names a program", plan.Program.Length > 0);
}
catch (ServerException error)
{
    Check("an absent install is refused with a sentence", error.Message.Contains("No Kabmo server to start"));
}

Group("SplashState");

// The launch splash: every ordering below is one WebView2 really produces, and
// each wrong answer is a splash that is stuck, missing or lying — none of which
// throws.
Check("the connecting state is visible and indeterminate",
    SplashState.Connecting.Visible && SplashState.Connecting.Indeterminate);
Check("connecting says what it is doing",
    SplashState.Connecting.Sentence() == "Connecting to the server…");

var splash = SplashState.Connecting;
splash = splash.Progressed(0);
Check("a 0% report says nothing", splash.Indeterminate && splash.Phase == SplashState.SplashPhase.Connecting);
splash = splash.Progressed(42);
Check("a real report becomes determinate",
    splash.Phase == SplashState.SplashPhase.Loading && !splash.Indeterminate && splash.Percent == 42);
Check("the sentence carries the percentage", splash.Sentence() == "Loading the console… 42%");

// A redirect restarts the document: 100 then 10. A bar that snapped back reads as
// a stall, so the maximum wins.
splash = splash.Progressed(100).Progressed(10);
Check("progress never moves backwards within a load", splash.Percent == 100);
Check("100% is not a finish", splash.Phase == SplashState.SplashPhase.Loading);

splash = splash.Finished();
Check("only the load's own end closes the splash",
    splash.Phase == SplashState.SplashPhase.Done && !splash.Visible);
Check("a finished splash draws nothing", splash.Sentence().Length == 0);
Check("a report after the end is ignored",
    splash.Progressed(80).Phase == SplashState.SplashPhase.Done);

// A failed main-frame load still reports completion for the error page the
// webview renders; adopting that would hide the explanation behind a blank window.
var failedSplash = SplashState.Connecting.Progressed(60)
    .FailedBecause(SplashState.SplashFailure.Connect);
Check("a failure keeps the reason on screen",
    failedSplash.Phase == SplashState.SplashPhase.Failed && failedSplash.Visible);
Check("finishing does not overwrite a failure",
    failedSplash.Finished().Phase == SplashState.SplashPhase.Failed);
Check("a report after a failure is ignored",
    failedSplash.Progressed(90).Phase == SplashState.SplashPhase.Failed);
Check("each reason has its own sentence",
    new[]
    {
        SplashState.SentenceFor(SplashState.SplashFailure.HostLookup),
        SplashState.SentenceFor(SplashState.SplashFailure.Connect),
        SplashState.SentenceFor(SplashState.SplashFailure.Timeout),
        SplashState.SentenceFor(SplashState.SplashFailure.Ssl),
        SplashState.SentenceFor(SplashState.SplashFailure.Other),
    }.Distinct().Count() == 5);

Group("SplashState.IsDocumentReload");
Check("a reload is the same address on a finished page",
    SplashState.IsDocumentReload("http://127.0.0.1:3000/", "http://127.0.0.1:3000/",
        SplashState.SplashPhase.Done));
Check("a navigation to another address is not a reload",
    !SplashState.IsDocumentReload("http://127.0.0.1:3000/settings", "http://127.0.0.1:3000/",
        SplashState.SplashPhase.Done));
// The cold start's own navigation arrives while the webview still shows the
// previous document; treating it as a reload would restart the arm just made.
Check("a load that has not finished is never a reload",
    !SplashState.IsDocumentReload("http://127.0.0.1:3000/", "http://127.0.0.1:3000/",
        SplashState.SplashPhase.Connecting));
Check("a missing address is not a reload",
    !SplashState.IsDocumentReload(null, null, SplashState.SplashPhase.Done));

Group("Wordmark");

// `Wordmark.cs` is GENERATED from `public/kabmo-wordmark.svg` by
// `scripts/shell-wordmark.mjs`, so these cases re-derive it from that file: a copy
// that drifted still renders a plausible-looking mark, and only the source can say
// it is the wrong one.
var svgPath = RepoFile("public/kabmo-wordmark.svg");
if (!File.Exists(svgPath))
{
    Check("the README's wordmark SVG is readable", false);
}
else
{
    var svg = File.ReadAllText(svgPath);
    var viewBox = Numbers(svg, @"viewBox=""([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)""");
    Check("the SVG has a four-number viewBox", viewBox.Count == 4);
    if (viewBox.Count == 4)
    {
        Check("the viewport width is the SVG's", Math.Abs(Wordmark.ViewBoxWidth - viewBox[2]) < 0.01);
        Check("the viewport height is the SVG's", Math.Abs(Wordmark.ViewBoxHeight - viewBox[3]) < 0.01);
        Check("the SVG starts above the origin", viewBox[1] < 0);
        Check("the shift is -viewBox.y", Math.Abs(Wordmark.Shift + viewBox[1]) < 0.01);
    }

    var svgPaths = Matches(svg, @"<path\b[^>]*\sd=""([^""]+)""");
    Check("the SVG has five paths", svgPaths.Count == 5);
    for (var index = 0; index < svgPaths.Count && index < Wordmark.Paths.Length; index++)
    {
        // Verbatim: the y shift is applied when the visual is built, so a copy that
        // had already been shifted would be shifted twice and still "look right".
        Check($"path {index} is the SVG's, verbatim", Wordmark.Paths[index] == svgPaths[index]);
    }

    var plate = Numbers(svg,
        @"<rect width=""([\d.]+)"" height=""([\d.]+)"" y=""[-\d.]+"" rx=""([\d.]+)"" fill=""#[0-9a-f]{6}""");
    Check("the plate is the SVG's tile and radius",
        plate.Count == 3
        && Math.Abs(Wordmark.PlateSize - plate[0]) < 0.01
        && Math.Abs(Wordmark.PlateCornerRadius - plate[2]) < 0.01);
    Check("the plate is the SVG's colour", svg.Contains(Wordmark.PlateColor));

    var gradient = Numbers(svg,
        @"<linearGradient[^>]*x1=""([\d.]+)"" y1=""[-\d.]+"" x2=""([\d.]+)"" y2=""[-\d.]+""");
    Check("the gradient runs over the SVG's span",
        gradient.Count == 2
        && Math.Abs(Wordmark.GradientX1 - gradient[0]) < 0.01
        && Math.Abs(Wordmark.GradientX2 - gradient[1]) < 0.01);
    Check("the gradient keeps both stops",
        svg.Contains(Wordmark.GradientStart) && svg.Contains(Wordmark.GradientEnd));
    Check("the mo ink is the SVG's", svg.Contains(Wordmark.WordInk));
    Check("the stroke weight is the SVG's",
        svg.Contains($"stroke-width=\"{Wordmark.StrokeWidth.ToString("0.##", System.Globalization.CultureInfo.InvariantCulture)}\""));
    Check("three strokes are drawn in three inks", Wordmark.StrokeColors.Length == 3);
    // Every path must be a drawable `d` string: a leading moveto is what the WPF
    // splash parses, and a fragment without one is a mark that renders as nothing.
    Check("every path starts with a moveto",
        Wordmark.Paths.All(d => d.TrimStart().StartsWith('M')));
}

// Where a link goes: inside this window, or out to the browser.
NavigationPolicyCases.Run(Check, Group);

Console.WriteLine($"\n{checks - failures}/{checks} checks passed");
return failures == 0 ? 0 : 1;

(ServerStore store, Saved saved) MakeStore(FakeDeps deps, PersistedState? persisted)
{
    var box = new Saved();
    var store = new ServerStore(deps, () => persisted, state => box.All.Add(state));
    return (store, box);
}

/// <summary>
/// A repository file, found by walking up — the same rule the macOS and iOS
/// suites use, so a test that cannot find the shared artwork FAILS rather than
/// skipping (a skipped comparison is a copy nobody is checking).
/// </summary>
string RepoFile(string relative)
{
    var directory = new DirectoryInfo(Directory.GetCurrentDirectory());
    for (var depth = 0; depth < 8 && directory is not null; depth++)
    {
        var candidate = Path.Combine(directory.FullName, relative);
        if (File.Exists(candidate)) return candidate;
        directory = directory.Parent;
    }
    return Path.Combine(Directory.GetCurrentDirectory(), relative);
}

/// <summary>The capture groups of the FIRST match, as numbers.</summary>
List<double> Numbers(string source, string pattern)
{
    var match = System.Text.RegularExpressions.Regex.Match(source, pattern);
    if (!match.Success) return new List<double>();
    return match.Groups.Cast<System.Text.RegularExpressions.Group>()
        .Skip(1)
        .Select(group => double.TryParse(group.Value,
            System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture,
            out var value) ? value : 0)
        .ToList();
}

/// <summary>Every first capture group of every match.</summary>
List<string> Matches(string source, string pattern) =>
    System.Text.RegularExpressions.Regex.Matches(source, pattern)
        .Select(match => match.Groups[1].Value)
        .ToList();

ServerEntry Entry(string id, string url, int? port = null) =>
    new() { Id = id, Label = id, Url = url, Kind = ServerKind.Managed, Port = port, Running = true, Source = "record" };
