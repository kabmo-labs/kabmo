/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shapes the server list is made of, and the address rules that guard them.
 *
 * Split from `Store.cs` (the actions) for the reason the Swift port splits its
 * types from its actor: a reader asking "what is a ServerEntry" and a reader
 * asking "what does Stop actually do" are two different questions.
 */

using System.Text.Json.Serialization;

namespace KabmoDesktop;

public enum ServerKind
{
    Remote,
    Managed,
}

/// <summary>One server the shell remembers.</summary>
public sealed record StoredServer
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public string Url { get; init; } = "";
    public ServerKind Kind { get; init; }
    public int? Port { get; init; }
}

/// <summary>A server as the panel draws it.</summary>
public sealed record ServerEntry
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public string Url { get; init; } = "";
    public ServerKind Kind { get; init; }
    public int? Port { get; init; }
    public bool Running { get; init; }
    /// <summary>This shell started it, as opposed to a server found on the machine.</summary>
    public bool Owned { get; init; }
    public string? Version { get; init; }
    public string? Mode { get; init; }
    public int? Pid { get; init; }
    public string? StartedAt { get; init; }
    /// <summary><c>stored</c> for the list, <c>record</c> for a local instance found on disk.</summary>
    public string Source { get; init; } = "stored";
}

public sealed record ServersState
{
    public IReadOnlyList<ServerEntry> Entries { get; init; } = Array.Empty<ServerEntry>();
    /// <summary>Local instances this shell did NOT start — a `kabmo serve`, a dev server.</summary>
    public IReadOnlyList<ServerEntry> Detected { get; init; } = Array.Empty<ServerEntry>();
    public string? ActiveId { get; init; }
    public string? ActiveUrl { get; init; }
}

/// <summary>What is persisted between launches.</summary>
public sealed record PersistedState
{
    public IReadOnlyList<StoredServer> Entries { get; init; } = Array.Empty<StoredServer>();
    public string? ActiveId { get; init; }

    /**
     * `local:<port>` → the pid THIS shell spawned.
     *
     * The record of an adoption. A shell that is force-quit leaves its children
     * running, and the next launch must be able to stop them — but it must NOT
     * take over a server the user started in a terminal. Only a pid written here
     * is ours, so this map is the whole difference between "an orphan of mine"
     * and "not mine".
     */
    public IReadOnlyDictionary<string, int> Spawned { get; init; } =
        new Dictionary<string, int>();

    /**
     * The palette the console last reported, as a wire.
     *
     * Stored beside the server list because it belongs to this shell's own state,
     * and read on the FIRST frame: the splash is drawn before any page exists, so
     * this is the only colour available at launch. Optional, so a `servers.json`
     * written by an older build still decodes.
     */
    public string? Palette { get; init; }
}

public sealed record Health
{
    public string? Version { get; init; }
    public string? Mode { get; init; }
    public int? Pid { get; init; }
    public string? StartedAt { get; init; }
}

/// <summary>The side effects, injected.</summary>
public interface IServerDeps
{
    Task<Health?> ProbeAsync(string url);
    Task<IReadOnlyList<ServerEntry>> DetectAsync();
    /// <summary>Start a local server; <c>pid</c> is null when the port was already served.</summary>
    Task<StartResult> StartAsync(int port);
    Task StopAsync(string id);
}

public sealed record StartResult(string Id, string Url, int? Pid);

public sealed class ServerException : Exception
{
    public ServerException(string message) : base(message) { }
}

/// <summary>
/// `http(s)://host[:port]` — no path, no credentials, no query.
///
/// A base path is REFUSED rather than dropped: the client is same-origin
/// relative, so a page served from `https://host/kabmo/` would ask `/api/...` at
/// the domain root and fail every request after loading successfully. The
/// Android shell refuses it for the same reason.
/// </summary>
public static class ServerAddress
{
    public static string Normalise(string raw)
    {
        var trimmed = (raw ?? "").Trim();
        if (trimmed.Length == 0) throw new ServerException("Enter a server address.");

        var withScheme = trimmed.Contains("://", StringComparison.Ordinal) ? trimmed : "http://" + trimmed;
        string scheme;
        if (withScheme.StartsWith("https://", StringComparison.Ordinal)) scheme = "https";
        else if (withScheme.StartsWith("http://", StringComparison.Ordinal)) scheme = "http";
        else throw new ServerException("Only http:// and https:// addresses are supported.");

        var rest = withScheme[(scheme.Length + 3)..];
        var slash = rest.IndexOf('/');
        var authority = slash < 0 ? rest : rest[..slash];
        var path = slash < 0 ? "" : rest[slash..];

        if (authority.Length == 0) throw new ServerException("That address is not a host and port.");
        if (authority.Contains('@') || authority.Contains('?') || authority.Contains('#'))
        {
            throw new ServerException("That address is not a host and port.");
        }
        if (path.Length > 0 && path != "/")
        {
            throw new ServerException("Use the server's root address — a base path is not supported.");
        }
        return $"{scheme}://{authority}";
    }

    public static string Id(ServerKind kind, string value) =>
        kind == ServerKind.Remote ? $"remote:{value}" : $"local:{value}";

    public static string Id(ServerKind kind, int port) =>
        kind == ServerKind.Remote ? $"remote:{port}" : $"local:{port}";
}
