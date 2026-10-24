/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The rules a Windows self-update obeys, as pure values.
 *
 * Kept in the library (not in `KabmoDesktop.App`) for the reason `SplashState`
 * and `NavigationPolicy` are: `KabmoDesktop` is `net8.0` and carries no Win32, so
 * every rule below is testable on any machine — including the macOS box this was
 * written on. Each one fails SILENTLY in a real run: a wrong host allowlist
 * downloads from anywhere, a wrong file test runs something that is not an
 * installer, a wrong version comparison downgrades the app.
 *
 * ## What this CAN and CANNOT promise
 *
 * The published installer is UNSIGNED (Authenticode needs a certificate bound to
 * a publisher identity), so these checks are integrity, not authenticity: they
 * catch a truncated download, an HTML error page saved as `.exe`, and an
 * installer whose own metadata names another product. They do NOT prove the bytes
 * came from this project. Two things bound the damage meanwhile — HTTPS from a
 * GitHub host, and Inno's own refusal to run an installer whose `AppId` is not
 * the one this app was installed by. Authenticode is what would make this an
 * authenticity check, and that is a pipeline change.
 *
 * ## Why the INSTALLER and not a file swap
 *
 * Inno already owns the upgrade semantics: a stable `AppId` is what makes an
 * install an UPGRADE rather than a second copy beside the first, and
 * `/CLOSEAPPLICATIONS` is how it replaces a running exe. Re-implementing that
 * here would be a second, worse installer — one that cannot write to
 * `Program Files`, cannot register the uninstaller, and would leave the Start-menu
 * entry pointing at a path it guessed.
 */

using System.Text.RegularExpressions;

namespace KabmoDesktop;

public static class ShellUpdate
{
    /// <summary>
    /// The executable a published installer carries.
    ///
    /// Used as a NAME test only: the real check is that the downloaded bytes are
    /// a PE executable and that Inno accepts them. A file that merely ends in
    /// `.exe` is not proof of anything, which is why the extension is not the
    /// only rule below.
    /// </summary>
    public const string InstallerSuffix = "-setup.exe";

    /// <summary>
    /// Hosts a self-update may download from.
    ///
    /// GitHub serves a release asset from `github.com` (a redirect) and then from
    /// a CDN host, so both are listed. It is an ALLOWLIST rather than a scheme
    /// test because a console is a network service: a compromised or merely
    /// misconfigured one must not be able to point this app at an arbitrary host.
    /// </summary>
    public static readonly string[] TrustedHosts =
    {
        "github.com",
        "objects.githubusercontent.com",
        "release-assets.githubusercontent.com",
    };

    /// <summary>Whether a URL is something this shell will download from.</summary>
    public static bool IsTrustedDownload(string? urlString)
    {
        if (string.IsNullOrWhiteSpace(urlString)) return false;
        if (!Uri.TryCreate(urlString, UriKind.Absolute, out var uri)) return false;
        if (!string.Equals(uri.Scheme, Uri.UriSchemeHttps, StringComparison.OrdinalIgnoreCase)) return false;
        var host = uri.Host.ToLowerInvariant();
        return Array.Exists(TrustedHosts, trusted => string.Equals(trusted, host, StringComparison.Ordinal));
    }

    /// <summary>
    /// Whether a downloaded name is the installer this shell runs.
    ///
    /// The architecture is part of the assertion, not a detail: running the other
    /// architecture's installer on an Arm machine installs a build that needs
    /// emulation, and on an x64 machine an Arm build simply refuses to start.
    /// </summary>
    public static bool IsInstallerFor(string? fileName, string arch)
    {
        if (string.IsNullOrWhiteSpace(fileName)) return false;
        return Regex.IsMatch(
            fileName,
            $@"^Kabmo-\d+\.\d+\.\d+-win-{Regex.Escape(arch)}{Regex.Escape(InstallerSuffix)}$",
            RegexOptions.IgnoreCase);
    }

    /// <summary>Whether <paramref name="candidate"/> is strictly newer than <paramref name="installed"/>.</summary>
    ///
    /// Numeric dotted segments only, ignoring a prerelease suffix — the same
    /// comparison the console makes (`src/shared/lib/updates/semver.ts`) and the
    /// macOS shell makes, so the three cannot disagree about whether an update
    /// exists. A segment that is not a number counts as 0.
    public static bool IsNewer(string? candidate, string? installed)
    {
        var left = Segments(candidate);
        var right = Segments(installed);
        for (var index = 0; index < Math.Max(left.Count, right.Count); index++)
        {
            var a = index < left.Count ? left[index] : 0;
            var b = index < right.Count ? right[index] : 0;
            if (a != b) return a > b;
        }
        return false;
    }

    private static List<int> Segments(string? version)
    {
        var text = (version ?? string.Empty).Trim();
        if (text.StartsWith('v') || text.StartsWith('V')) text = text[1..];
        var core = text.Split('-')[0];
        return core.Split('.').Select(part => int.TryParse(part, out var value) ? value : 0).ToList();
    }

    /// <summary>
    /// Why an update may not be installed, or null when it may.
    ///
    /// Every refusal is a SENTENCE, because the console prints it: "the download
    /// is not a Kabmo installer" tells a user what happened, and a bare `false`
    /// tells them the update is broken.
    /// </summary>
    public static string? Refusal(string? url, string? fileName, string? publishedVersion, string? installedVersion, string arch)
    {
        if (!IsTrustedDownload(url)) return "That update does not come from Kabmo's release page, so it was not installed.";
        if (!IsInstallerFor(fileName, arch)) return "The download is not a Kabmo installer for this machine.";
        if (string.IsNullOrWhiteSpace(publishedVersion)) return "The update does not declare a version, so it was not installed.";
        if (!IsNewer(publishedVersion, installedVersion))
        {
            return $"The published build ({publishedVersion}) is not newer than the installed one ({installedVersion}).";
        }
        return null;
    }

    /// <summary>The argument line that installs over this copy without a wizard.</summary>
    ///
    /// Four flags, each load-bearing:
    ///
    /// - `/SILENT /SUPPRESSMSGBOXES /NORESTART` — no wizard, no modal, and Inno
    ///   never reboots the machine out from under the user.
    /// - `/CLOSEAPPLICATIONS` — Inno asks a running exe to close. This app IS that
    ///   exe, so it must quit before the installer replaces it; the caller
    ///   terminates, and the installer is a separate process that outlives it.
    /// - `/SP-` — no "This will install…" prompt. The user already answered by
    ///   pressing Update in the console.
    /// - `/LANG` is deliberately NOT passed: the installer carries its own
    ///   languages and picking one here would override the user's system locale.
    public static string InstallerArguments() =>
        "/SILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /SP-";
}
