/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The injected side effects: the real probe, the real records, the real spawn.
 *
 * One file, because it is the whole adapter between `IServerDeps` (the store's
 * seam) and the library's own functions — the macOS shell's `SystemDeps` struct
 * carries the same four members.
 */

namespace KabmoDesktop.App;

public sealed class SystemDeps : IServerDeps
{
    private readonly Supervisor _supervisor;

    public SystemDeps(Supervisor supervisor) => _supervisor = supervisor;

    public Task<Health?> ProbeAsync(string url) => HealthProbe.ProbeAsync(url);

    public Task<IReadOnlyList<ServerEntry>> DetectAsync() => Discovery.DetectAsync();

    public async Task<StartResult> StartAsync(int port)
    {
        try
        {
            var managed = await _supervisor.StartAsync(port);
            return new StartResult(managed.Id, managed.Url, managed.Pid);
        }
        catch (AlreadyServedException already)
        {
            // Something else serves the port. Reported with NO pid, which is what
            // keeps the panel from offering Stop for a process this shell did not
            // spawn.
            return new StartResult(already.Id, already.Url, null);
        }
    }

    public Task StopAsync(string id) => _supervisor.StopAsync(id);
}
