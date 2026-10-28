/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where the shell's own list lives.
 *
 * Beside the app's config, NEVER inside the data directory: `%USERPROFILE%\.kabmo`
 * is shared with the CLI and holds the database, the auth hash and the run
 * records, and a shell that wrote its own bookkeeping there would make
 * `kabmo status` and this app disagree about which files belong to whom.
 *
 * `%APPDATA%` is the per-user roaming folder Explorer and a shortcut both
 * resolve without a shell — the same reason `SystemPaths.DataDirectory` uses
 * `GetFolderPath` rather than reading `%USERPROFILE%`.
 */

using System.Text.Json;

namespace KabmoDesktop;

public static class PersistedStore
{
    /// <summary>Indented on top of the wire's own options: a file a human may open.</summary>
    private static readonly JsonSerializerOptions Options =
        new(WireFormat.Options) { WriteIndented = true };

    public static string StateFilePath()
    {
        var roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        // The app's own name, the same one the executable carries: a folder a
        // user finds under %APPDATA% should be one they can connect to the app
        // they installed.
        return Path.Combine(roaming, "Kabmo", "servers.json");
    }

    public static PersistedState? Read()
    {
        try
        {
            var path = StateFilePath();
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<PersistedState>(File.ReadAllBytes(path), Options);
        }
        catch
        {
            return null;
        }
    }

    public static void Write(PersistedState state)
    {
        try
        {
            var path = StateFilePath();
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllBytes(path, JsonSerializer.SerializeToUtf8Bytes(state, Options));
        }
        catch
        {
            // A read-only profile must not take the window down: the list is a
            // convenience over the servers themselves.
        }
    }
}
