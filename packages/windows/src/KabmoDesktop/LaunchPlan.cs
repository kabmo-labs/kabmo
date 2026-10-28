/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How to start a local server on this machine, and the process tree it gets.
 *
 * Split from `Supervisor.cs` (the lifecycle) because these are two questions
 * with different answers per platform: WHICH program to run is a lookup, and HOW
 * to own it is a job object here and a process group on macOS.
 */

using System.Diagnostics;
using System.Runtime.InteropServices;

namespace KabmoDesktop;

/// <summary>
/// How to start a local server on this machine.
///
/// Three shapes, in the order that keeps the app self-contained first:
/// 1. the **bundled** server inside the app (`Resources\server\kabmo.exe`);
/// 2. `kabmo` on `PATH` (`.cmd` or `.exe`), the CLI a user already has;
/// 3. `bun` plus a source checkout's CLI, for development.
/// </summary>
public sealed record LaunchPlan(string Program, IReadOnlyList<string> Arguments, string? WorkingDirectory, bool IsCli)
{
    public static LaunchPlan Resolve()
    {
        var bundled = Path.Combine(AppContext.BaseDirectory, "server", "kabmo.exe");
        if (File.Exists(bundled)) return new LaunchPlan(bundled, Array.Empty<string>(), Path.GetDirectoryName(bundled), false);

        if (Which("kabmo.cmd") is string shim) return new LaunchPlan(shim, new[] { "serve" }, null, true);
        if (Which("kabmo.exe") is string exe) return new LaunchPlan(exe, new[] { "serve" }, null, true);

        if (Which("bun.exe") is string bun)
        {
            var local = Path.Combine(Environment.CurrentDirectory, "src", "cli", "kabmo.js");
            if (File.Exists(local))
            {
                return new LaunchPlan(bun, new[] { local, "serve" }, Environment.CurrentDirectory, true);
            }
        }

        throw new ServerException(
            "No Kabmo server to start. Install the CLI (`bun add -g @kabmo-labs/kabmo`) or connect to a remote server.");
    }

    /**
     * A PATH lookup, plus the usual install locations.
     *
     * A GUI-launched app inherits a minimal PATH, which is why `~/.bun/bin` and
     * the two Program Files roots are probed explicitly — the same fallback the
     * macOS shell's `which` carries, for the same reason.
     */
    public static string? Which(string name)
    {
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var candidate = Path.Combine(dir, name);
            if (File.Exists(candidate)) return candidate;
        }

        var home = SystemPaths.HomeDirectory();
        var extras = new[]
        {
            Path.Combine(home, ".bun", "bin"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "bun"),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
        };
        foreach (var dir in extras)
        {
            if (dir.Length == 0) continue;
            var candidate = Path.Combine(dir, name);
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}

/**
 * The Windows analogue of the POSIX process group.
 *
 * One job per spawned server, so Stop ends the whole tree in one call — and so a
 * server that crashed cannot leave a PTY shell behind. Deliberately WITHOUT
 * `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`: that would kill the children the moment
 * this process died, and the adoption path (a force-quit leaves the servers
 * answering, the next launch records them as its own) is a feature the macOS
 * shell has too.
 */
internal static class JobObject
{
    private static readonly Dictionary<int, nint> Handles = new();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern nint CreateJobObjectW(nint attributes, string? name);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(nint job, nint process);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool TerminateJobObject(nint job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(nint handle);

    /**
     * Put `process` in a job of its own.
     *
     * No limits are set: `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` would end the
     * children the moment this process died, and the adoption path depends on
     * them OUTLIVING a force-quit.
     */
    public static void Assign(Process process)
    {
        try
        {
            var job = CreateJobObjectW(0, null);
            if (job == 0) return;
            if (!AssignProcessToJobObject(job, process.Handle))
            {
                CloseHandle(job);
                return;
            }
            lock (Handles) Handles[process.Id] = job;
        }
        catch
        {
            // No job: Terminate falls back to the tree walk.
        }
    }

    public static void Terminate(int pid)
    {
        nint job;
        lock (Handles)
        {
            if (!Handles.Remove(pid, out job)) job = 0;
        }
        if (job != 0)
        {
            TerminateJobObject(job, 1);
            CloseHandle(job);
            return;
        }
        // No job handle (an assignment failure, or a process that outlived it):
        // fall back to the tree walk.
        try
        {
            using var killer = Process.Start(new ProcessStartInfo
            {
                FileName = "taskkill",
                Arguments = $"/pid {pid} /t /f",
                CreateNoWindow = true,
                UseShellExecute = false,
            });
            killer?.WaitForExit(5000);
        }
        catch
        {
            try { Process.GetProcessById(pid).Kill(); } catch { /* already gone */ }
        }
    }

    public static void Release(int pid)
    {
        nint job;
        lock (Handles)
        {
            if (!Handles.Remove(pid, out job)) return;
        }
        CloseHandle(job);
    }
}
