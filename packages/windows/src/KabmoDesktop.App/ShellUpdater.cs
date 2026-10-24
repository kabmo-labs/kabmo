/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Downloading, checking and running a newer Kabmo installer over this one.
 *
 * The RULES live in `KabmoDesktop.ShellUpdate` (pure, `net8.0`, no Win32) and are
 * pinned by the rules suite. This file is the part that touches the disk and
 * `Process.Start`, which needs the Windows target and is therefore separated: the
 * rules can be tested on any machine, and the sequence here is one straight line
 * a reader can check against Inno's own documented flags.
 *
 * ## Why the app QUITS rather than installing in place
 *
 * Inno replaces `Kabmo.exe` on disk, and this process has that file open and
 * mapped. Windows will not overwrite a running image, so the installer is started
 * with `/CLOSEAPPLICATIONS` and this process terminates itself once the installer
 * is up: the installer is a separate process, so it outlives the app it is
 * replacing. That is also why the answer to the console is sent BEFORE the quit —
 * a page whose shell vanished mid-request would keep a spinner over an update that
 * worked.
 *
 * ## What the download is checked for
 *
 * `ShellUpdate.Refusal` covers the URL, the file name (which carries the
 * architecture), and the version. The one thing it cannot check is the
 * installer's own `AppId`, because that lives inside the PE resource — and Inno
 * checks it for us: an installer built for a different product installs that
 * product rather than replacing this one, which is why the name and host checks
 * exist to keep us from ever handing it one.
 */

using System.Diagnostics;
using System.IO;
using System.Net.Http;

namespace KabmoDesktop.App;

public sealed class ShellUpdater
{
    private static readonly HttpClient Client = new() { Timeout = TimeSpan.FromMinutes(5) };

    /// <summary>
    /// Fetch and launch the installer, and answer what was started.
    /// </summary>
    ///
    /// The caller sends this answer to the console and then shuts the app down; a
    /// failure is thrown with a sentence, which the bridge turns into the reply
    /// the page shows.
    public async Task<string> ApplyAsync(string url, string version, string arch, string installedVersion)
    {
        var fileName = FileNameOf(url);
        var refusal = ShellUpdate.Refusal(url, fileName, version, installedVersion, arch);
        if (refusal is not null) throw new ServerException(refusal);

        var directory = Path.Combine(Path.GetTempPath(), "Kabmo", "update", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(directory);
        var target = Path.Combine(directory, fileName!);

        await using (var stream = await Client.GetStreamAsync(url))
        await using (var file = File.Create(target))
        {
            await stream.CopyToAsync(file);
        }

        // A PE executable starts with `MZ`. An HTML error page saved under an
        // `.exe` name is the common failure of a download that was refused with a
        // 200, and running it would produce a Windows error box about a file that
        // is not an application.
        if (!LooksLikeExecutable(target))
        {
            throw new ServerException("The download is not a Kabmo installer.");
        }

        var started = Process.Start(new ProcessStartInfo(target, ShellUpdate.InstallerArguments())
        {
            // The installer is a separate process on purpose: it has to outlive
            // this app, which is about to exit so its own exe can be replaced.
            UseShellExecute = false,
        });
        if (started is null) throw new ServerException("The installer could not be started.");

        return $"Kabmo {version} is being installed — the window will reopen.";
    }

    /// <summary>The last path segment of a URL, query string excluded.</summary>
    private static string? FileNameOf(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)) return null;
        var name = Path.GetFileName(uri.AbsolutePath);
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    /// <summary>Whether a file starts with the DOS/PE header.</summary>
    private static bool LooksLikeExecutable(string path)
    {
        try
        {
            using var stream = File.OpenRead(path);
            Span<byte> header = stackalloc byte[2];
            return stream.Read(header) == 2 && header[0] == (byte)'M' && header[1] == (byte)'Z';
        }
        catch (IOException)
        {
            return false;
        }
    }
}
