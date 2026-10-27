/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Owning a local server process on Windows.
 *
 * The macOS shell spawns a process-GROUP leader and signals the group. Windows
 * has no process groups, so ownership is a JOB OBJECT — the platform's own
 * "this whole tree is mine" handle — and an adopted orphan (a previous run of
 * this shell left it behind) is ended with `taskkill /t /f`, the same tree walk
 * the CLI uses on this platform.
 *
 * Split from `System.cs` for the same reason the Swift port splits
 * `System.swift` from the window: the probe and the record reader are one
 * question, the child process is another.
 */

using System.Diagnostics;

namespace KabmoDesktop;

/**
 * The local servers this shell started, plus the pids it adopted after a restart.
 *
 * A managed server is assigned to a JOB OBJECT at spawn, so Stop ends the whole
 * tree — which takes the PTY shells and plugin children with it instead of
 * orphaning them. An ADOPTED server (a previous run of this shell left it
 * behind) has no handle to re-open, so it is ended with `taskkill /t /f`: the
 * tree walk the CLI itself uses on this platform.
 */
public sealed class Supervisor
{
    private readonly object _gate = new();
    private readonly Dictionary<string, ManagedServer> _children = new(StringComparer.Ordinal);
    private readonly Dictionary<string, int> _adopted = new(StringComparer.Ordinal);

    public bool Owns(string id)
    {
        lock (_gate) return _children.ContainsKey(id) || _adopted.ContainsKey(id);
    }

    public void Adopt(string id, int pid)
    {
        lock (_gate)
        {
            if (!_children.ContainsKey(id)) _adopted[id] = pid;
        }
    }

    public async Task<ManagedServer> StartAsync(int port)
    {
        var id = $"local:{port}";
        var url = $"http://127.0.0.1:{port}";
        if (await HealthProbe.ProbeAsync(url).ConfigureAwait(false) is not null)
        {
            // Something already serves this port. It is NOT ours to claim: a server
            // the user started in a terminal answers here too, and handing back a
            // pid would make the panel offer Stop for a process this shell never
            // spawned.
            throw new AlreadyServedException(id, url);
        }

        lock (_gate)
        {
            if (_children.ContainsKey(id))
            {
                throw new ServerException($"A local server is already starting on port {port}.");
            }
        }

        var launch = LaunchPlan.Resolve();
        var data = SystemPaths.DataDirectory();
        Directory.CreateDirectory(data);
        var logPath = Path.Combine(data, $"desktop-{port}.log");
        var log = new StreamWriter(new FileStream(logPath, FileMode.Append, FileAccess.Write, FileShare.ReadWrite))
        {
            AutoFlush = true,
        };

        var arguments = new List<string>(launch.Arguments) { "--port", port.ToString(), "--host", "127.0.0.1" };
        // `--foreground` keeps the server a CHILD of this process rather than
        // detaching into a daemon the shell could never stop.
        if (launch.IsCli) arguments.Add("--foreground");

        var process = Spawn(launch, arguments, log);
        var managed = new ManagedServer(id, url, process.Id);
        lock (_gate) _children[id] = managed;

        var deadline = DateTime.UtcNow + SystemPaths.StartTimeout;
        while (DateTime.UtcNow < deadline)
        {
            if (await HealthProbe.ProbeAsync(url).ConfigureAwait(false) is not null) return managed;
            if (process.HasExited)
            {
                lock (_gate) _children.Remove(id);
                JobObject.Release(process.Id);
                log.Dispose();
                throw new ServerException($"The local server exited during startup. See {logPath}.");
            }
            await Task.Delay(150).ConfigureAwait(false);
        }

        await StopAsync(id).ConfigureAwait(false);
        throw new ServerException(
            $"The local server did not answer on port {port} within {SystemPaths.StartTimeout.TotalSeconds:0}s.");
    }

    /// <summary>Stop one managed server, and everything in its job.</summary>
    public async Task StopAsync(string id)
    {
        int? adopted;
        ManagedServer? managed;
        lock (_gate)
        {
            _adopted.Remove(id, out var adoptedPid);
            adopted = adoptedPid;
            _children.Remove(id, out managed);
        }

        if (adopted is int adoptedPidValue)
        {
            await KillTreeAsync(adoptedPidValue).ConfigureAwait(false);
            return;
        }
        if (managed is null) return;

        // Terminating the job ends every process the server created — the PTY
        // shells and the plugin children included.
        JobObject.Terminate(managed.Pid);
        await WaitForExitAsync(managed.Pid).ConfigureAwait(false);
    }

    public async Task StopAllAsync()
    {
        string[] ids;
        lock (_gate) ids = _children.Keys.Concat(_adopted.Keys).Distinct().ToArray();
        foreach (var id in ids) await StopAsync(id).ConfigureAwait(false);
    }

    private static async Task WaitForExitAsync(int pid)
    {
        for (var i = 0; i < 40; i++)
        {
            if (!IsAlive(pid)) return;
            await Task.Delay(50).ConfigureAwait(false);
        }
    }

    /// <summary>`taskkill /t /f` — the tree walk for a process we hold no handle to.</summary>
    private static async Task KillTreeAsync(int pid)
    {
        try
        {
            using var killer = Process.Start(new ProcessStartInfo
            {
                FileName = "taskkill",
                Arguments = $"/pid {pid} /t /f",
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (killer is not null)
            {
                // BOUNDED, because this runs on the QUIT path (`Closing` →
                // `StopAllAsync`) and an unbounded wait there is an app that cannot
                // be closed — the "must be killed from Task Manager" shape.
                // `taskkill` is a separate process, so its own hang is not ours to
                // inherit: the pids this stop could not reach stay recorded, and the
                // next launch adopts them.
                var wait = killer.WaitForExitAsync();
                var finished = await Task.WhenAny(wait, Task.Delay(5000)).ConfigureAwait(false);
                if (finished == wait)
                {
                    // Observed here so a failed wait cannot surface later as an
                    // unobserved task exception.
                    try { await wait.ConfigureAwait(false); } catch { }
                }
            }
        }
        catch
        {
            // `taskkill` missing loses the tree kill, not the stop.
            try
            {
                Process.GetProcessById(pid).Kill();
            }
            catch
            {
                // Already gone.
            }
        }
        await WaitForExitAsync(pid).ConfigureAwait(false);
    }

    public static bool IsAlive(int pid)
    {
        try
        {
            using var process = Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }

    /**
     * Spawn the child with no window, its output going to the log, and put it in
     * a job object of its own.
     *
     * `.cmd`/`.bat` shims (the npm/bun global install on Windows) cannot be
     * executed directly by CreateProcess, so those go through `cmd.exe /c` — the
     * same rule Bun applies to a shebang script on POSIX.
     */
    private static Process Spawn(LaunchPlan launch, IReadOnlyList<string> arguments, StreamWriter log)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = launch.Program,
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = launch.WorkingDirectory ?? Environment.CurrentDirectory,
        };
        foreach (var argument in arguments) startInfo.ArgumentList.Add(argument);

        if (launch.Program.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase) ||
            launch.Program.EndsWith(".bat", StringComparison.OrdinalIgnoreCase))
        {
            var command = string.Join(" ", new[] { Quote(launch.Program) }.Concat(arguments.Select(Quote)));
            startInfo.FileName = "cmd.exe";
            startInfo.Arguments = $"/c {command}";
            startInfo.ArgumentList.Clear();
        }

        var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
        process.Start();
        // The child's stdin is closed: a server that inherited the console would
        // block on a read nobody can answer.
        try { process.StandardInput.Close(); } catch { /* nothing to close */ }

        process.OutputDataReceived += (_, line) => { if (line.Data is not null) log.WriteLine(line.Data); };
        process.ErrorDataReceived += (_, line) => { if (line.Data is not null) log.WriteLine(line.Data); };
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        JobObject.Assign(process);
        return process;
    }

    private static string Quote(string value) =>
        value.Contains(' ') || value.Contains('"') ? $"\"{value.Replace("\"", "\\\"")}\"" : value;
}
