/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The doubles the rules suite drives the store with.
 *
 * Types, not local functions, so `Program.cs` stays a sequence of top-level
 * statements — C# requires those to precede every type declaration in the same
 * file, which is what a fixture block in the middle silently breaks.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

// -------------------------------------------------------------------- fixtures

/// <summary>Everything the store needs, without a socket or a child process.</summary>
sealed class FakeDeps : IServerDeps
{
    public Dictionary<string, Health> Health { get; } = new(StringComparer.Ordinal);
    public List<ServerEntry> Detected { get; } = new();
    public List<int> Started { get; } = new();
    public List<string> Stopped { get; } = new();
    public int? StartPid { get; init; } = 4242;

    public Task<Health?> ProbeAsync(string url) =>
        Task.FromResult(Health.TryGetValue(url, out var health) ? health : null);

    public Task<IReadOnlyList<ServerEntry>> DetectAsync() =>
        Task.FromResult<IReadOnlyList<ServerEntry>>(Detected.ToList());

    public Task<StartResult> StartAsync(int port)
    {
        Started.Add(port);
        Health[$"http://127.0.0.1:{port}"] = new Health { Version = "0.5.3", Mode = "prod", Pid = 9, StartedAt = "now" };
        return Task.FromResult(new StartResult($"local:{port}", $"http://127.0.0.1:{port}", StartPid));
    }

    public Task StopAsync(string id)
    {
        Stopped.Add(id);
        var port = id.Replace("local:", "");
        Health.Remove($"http://127.0.0.1:{port}");
        return Task.CompletedTask;
    }
}

sealed class Saved
{
    public List<PersistedState> All { get; } = new();
    public PersistedState? Last => All.Count == 0 ? null : All[^1];
}
