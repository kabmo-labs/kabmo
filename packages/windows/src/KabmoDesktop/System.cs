/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two things the shell does to the machine: probe a URL, and own a local
 * server process.
 *
 * Separate from `Store.cs`, which holds the RULES. These are the side effects,
 * and they are what a test replaces: a probe is a socket, a start is a child
 * process, and neither belongs inside a test that is checking what the panel
 * decides.
 *
 * Ported from `packages/macos/Sources/KabmoDesktop/System.swift`. One thing
 * does NOT port: the macOS shell spawns a process-GROUP leader and signals the
 * group. Windows has no process groups, so ownership is a JOB OBJECT — the
 * platform's own "this whole tree is mine" handle — and an adopted orphan is
 * ended with `taskkill /t`, which is the same tree walk the CLI uses there.
 */

using System.Net;
using System.Net.Sockets;
using System.Text.Json;

namespace KabmoDesktop;

public static class SystemPaths
{
    /// <summary>How long a freshly spawned local server may take to answer `/api/health`.</summary>
    public static readonly TimeSpan StartTimeout = TimeSpan.FromSeconds(45);

    /// <summary>The probe's own budget. One closed port must not stall a refresh.</summary>
    public static readonly TimeSpan ProbeTimeout = TimeSpan.FromMilliseconds(1500);

    /**
     * `%USERPROFILE%\.kabmo`, or the override, resolved the way
     * `lib/lifecycle/paths.ts` does.
     *
     * `GetFolderPath(UserProfile)` and never `%USERPROFILE%` read directly: a
     * process started without a shell (a shortcut, a scheduled task, Explorer)
     * may have it unset, and an empty value would silently move the data
     * directory to a cwd-relative path — which is how the app and the CLI would
     * end up with two databases.
     */
    public static string DataDirectory()
    {
        var env = Environment.GetEnvironmentVariable("KABMO_DATA_DIR")
            ?? Environment.GetEnvironmentVariable("OMPCHAMBER_DATA_DIR")
            ?? "";
        var over = env.Trim();
        if (over.Length > 0)
        {
            if (over.StartsWith("~/", StringComparison.Ordinal) || over.StartsWith("~\\", StringComparison.Ordinal))
            {
                return Path.Combine(HomeDirectory(), over[2..]);
            }
            return Path.GetFullPath(over);
        }
        return Path.Combine(HomeDirectory(), ".kabmo");
    }

    public static string HomeDirectory() =>
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

    public static string RunDirectory() => Path.Combine(DataDirectory(), "run");
}

public static class HealthProbe
{
    private static readonly HttpClient Client = new()
    {
        // No cache: the panel re-probes on every read, and a cached "running"
        // would outlive the process it describes.
        Timeout = SystemPaths.ProbeTimeout,
    };

    /// <summary>`GET /api/health`, or null when nothing answers on that URL.</summary>
    public static async Task<Health?> ProbeAsync(string url)
    {
        try
        {
            using var request = new HttpRequestMessage(HttpMethod.Get, url.TrimEnd('/') + "/api/health");
            request.Headers.Add("Accept", "application/json");
            using var response = await Client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead);
            if (response.StatusCode != HttpStatusCode.OK) return null;
            await using var body = await response.Content.ReadAsStreamAsync();
            using var document = await JsonDocument.ParseAsync(body);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object) return null;
            // A 200 that is not Kabmo is not a Kabmo: without this, any web server
            // on the port would be offered as a console.
            if (!root.TryGetProperty("ok", out var ok) || ok.ValueKind != JsonValueKind.True) return null;

            return new Health
            {
                Version = Text(root, "version"),
                Mode = Text(root, "mode"),
                Pid = Integer(root, "pid"),
                StartedAt = Text(root, "startedAt"),
            };
        }
        catch
        {
            return null;
        }
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? Integer(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number &&
        value.TryGetInt32(out var number)
            ? number
            : null;
}

public static class Discovery
{
    /**
     * Every live local instance, read from the records the SERVERS write.
     *
     * `<data>/run/<port>.json` is written by the process that owns the port
     * (`lib/lifecycle/instance.ts`), so `kabmo serve` in a terminal, `bun run dev`
     * and a login entry all appear. A record whose process is gone is skipped, and
     * the health probe is the final word — a record can outlive a crash.
     */
    public static async Task<IReadOnlyList<ServerEntry>> DetectAsync()
    {
        var runDir = SystemPaths.RunDirectory();
        if (!Directory.Exists(runDir)) return Array.Empty<ServerEntry>();

        var found = new List<ServerEntry>();
        foreach (var path in Directory.EnumerateFiles(runDir, "*.json"))
        {
            JsonDocument document;
            try
            {
                document = JsonDocument.Parse(await File.ReadAllBytesAsync(path).ConfigureAwait(false));
            }
            catch
            {
                continue;
            }

            using (document)
            {
                var record = document.RootElement;
                if (record.ValueKind != JsonValueKind.Object) continue;

                var port = Integer(record, "port")
                    ?? (int.TryParse(Path.GetFileNameWithoutExtension(path), out var parsed) ? parsed : 0);
                if (port <= 0 || port >= 65536) continue;

                // `0.0.0.0`/`::` are bind-any addresses and cannot be connected to;
                // loopback reaches the same listener.
                var rawHost = Text(record, "host") ?? "127.0.0.1";
                var host = rawHost is "0.0.0.0" or "::" or "[::]" or "" ? "127.0.0.1" : rawHost;
                var url = $"http://{host}:{port}";
                var health = await HealthProbe.ProbeAsync(url).ConfigureAwait(false);
                if (health is null) continue;

                found.Add(new ServerEntry
                {
                    Id = $"local:{port}",
                    Label = $"Local :{port}",
                    Url = url,
                    Kind = ServerKind.Managed,
                    Port = port,
                    Running = true,
                    // A record is never owned: whoever started it still holds it.
                    Owned = false,
                    Version = health.Version,
                    Mode = health.Mode ?? Text(record, "mode"),
                    Pid = health.Pid ?? Integer(record, "pid"),
                    StartedAt = health.StartedAt ?? Text(record, "startedAt"),
                    Source = "record",
                });
            }
        }

        return found.OrderBy(entry => entry.Port ?? 0).ToList();
    }

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    private static int? Integer(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Number &&
        value.TryGetInt32(out var number)
            ? number
            : null;

    /// <summary>A free TCP port on loopback, chosen by binding one and letting it go.</summary>
    public static int FreePort()
    {
        try
        {
            var listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            var port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }
        catch
        {
            return 0;
        }
    }
}

/// <summary>A local server this shell owns.</summary>
public sealed record ManagedServer(string Id, string Url, int Pid);

/// <summary>The port was already served by something this shell does not own.</summary>
public sealed class AlreadyServedException : Exception
{
    public string Id { get; }
    public string Url { get; }

    public AlreadyServedException(string id, string url) : base($"{url} is already served.")
    {
        Id = id;
        Url = url;
    }
}
