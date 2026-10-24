/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The self-update's rules, pinned without Windows.
 *
 * Every case here is a way an update could install the wrong thing, and NONE of
 * them throws in the app: a wrong host allowlist downloads from anywhere, a
 * missing architecture test runs the other build's installer, a wrong comparison
 * downgrades the app. The download and the installer launch need Windows and a
 * network; these rules need neither, which is why they live in the library.
 *
 * The cases are the macOS suite's where the question is the same (hosts, version
 * comparison), restated because the two shells share no runtime.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class ShellUpdateCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        group("ShellUpdate — where a download may come from");

        check(
            "a release asset on github.com",
            ShellUpdate.IsTrustedDownload(
                "https://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/Kabmo-0.3.0-win-x64-setup.exe"));
        check(
            "the CDN host GitHub redirects an asset to",
            ShellUpdate.IsTrustedDownload("https://objects.githubusercontent.com/github-production-release-asset/x/y"));
        check(
            "release-assets.githubusercontent.com",
            ShellUpdate.IsTrustedDownload("https://release-assets.githubusercontent.com/x"));
        check(
            "plain http is refused, because the bytes decide what gets installed",
            !ShellUpdate.IsTrustedDownload("http://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/x.exe"));
        check(
            "another host is refused, even over https",
            !ShellUpdate.IsTrustedDownload("https://example.com/Kabmo.exe"));
        check(
            "a host that merely CONTAINS a trusted name is refused",
            !ShellUpdate.IsTrustedDownload("https://github.com.example.com/Kabmo.exe"));
        check(
            "an empty URL is refused",
            !ShellUpdate.IsTrustedDownload(null) && !ShellUpdate.IsTrustedDownload("  "));

        group("ShellUpdate — which installer this machine may run");

        check(
            "the x64 installer on an x64 machine",
            ShellUpdate.IsInstallerFor("Kabmo-0.3.0-win-x64-setup.exe", "x64"));
        check(
            "the Arm64 installer on an Arm machine",
            ShellUpdate.IsInstallerFor("Kabmo-0.3.0-win-arm64-setup.exe", "arm64"));
        check(
            "the OTHER architecture is refused, because it would install a build that cannot run natively",
            !ShellUpdate.IsInstallerFor("Kabmo-0.3.0-win-arm64-setup.exe", "x64"));
        check(
            "a plain .exe that is not the installer is refused",
            !ShellUpdate.IsInstallerFor("Kabmo.exe", "x64"));
        check(
            "a .zip is refused: only the installer owns the upgrade semantics",
            !ShellUpdate.IsInstallerFor("Kabmo-0.3.0-win-x64.zip", "x64"));
        check(
            "an absent name is refused",
            !ShellUpdate.IsInstallerFor(null, "x64"));

        group("ShellUpdate — the version comparison");

        check("a higher patch is newer", ShellUpdate.IsNewer("0.3.1", "0.3.0"));
        check("a higher minor is newer", ShellUpdate.IsNewer("0.4.0", "0.3.9"));
        check("a higher major is newer", ShellUpdate.IsNewer("1.0.0", "0.9.9"));
        check("the same version is not newer", !ShellUpdate.IsNewer("0.3.0", "0.3.0"));
        check("an older version is not newer", !ShellUpdate.IsNewer("0.2.9", "0.3.0"));
        check("a prerelease suffix is ignored, as the console ignores it", ShellUpdate.IsNewer("0.3.1-beta.2", "0.3.0"));
        check("a leading v is ignored", ShellUpdate.IsNewer("v0.3.1", "0.3.0"));
        check("a non-numeric segment counts as 0 rather than throwing", !ShellUpdate.IsNewer("0.3.x", "0.3.0"));
        check("a shorter version compares against a longer one without throwing", !ShellUpdate.IsNewer("0.3", "0.3.0"));
        check("an empty installed version makes any real version newer", ShellUpdate.IsNewer("0.3.0", ""));

        group("ShellUpdate — what may be installed");

        const string goodUrl = "https://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/Kabmo-0.3.1-win-x64-setup.exe";
        const string goodName = "Kabmo-0.3.1-win-x64-setup.exe";

        check(
            "a newer installer from the release page",
            ShellUpdate.Refusal(goodUrl, goodName, "0.3.1", "0.3.0", "x64") is null);
        check(
            "an untrusted host is refused",
            ShellUpdate.Refusal("https://example.com/" + goodName, goodName, "0.3.1", "0.3.0", "x64") is not null);
        check(
            "the other architecture is refused",
            ShellUpdate.Refusal(goodUrl, goodName, "0.3.1", "0.3.0", "arm64") is not null);
        check(
            "a file that is not the installer is refused",
            ShellUpdate.Refusal(goodUrl, "Kabmo.exe", "0.3.1", "0.3.0", "x64") is not null);
        check(
            "the same build is refused, because that is not an update",
            ShellUpdate.Refusal(goodUrl, goodName, "0.3.0", "0.3.0", "x64") is not null);
        check(
            "an OLDER build is refused, because installing it would be a downgrade",
            ShellUpdate.Refusal(goodUrl, goodName, "0.2.0", "0.3.0", "x64") is not null);
        check(
            "a missing published version is refused",
            ShellUpdate.Refusal(goodUrl, goodName, "", "0.3.0", "x64") is not null);

        group("ShellUpdate — the installer's argument line");

        var arguments = ShellUpdate.InstallerArguments();
        check("silent, so no wizard appears over the console", arguments.Contains("/SILENT"));
        check("no message boxes, which nobody is there to dismiss", arguments.Contains("/SUPPRESSMSGBOXES"));
        check("never reboots the machine", arguments.Contains("/NORESTART"));
        check(
            "closes the running app, which is the only way its exe can be replaced",
            arguments.Contains("/CLOSEAPPLICATIONS"));
        check(
            "no 'ready to install' prompt, because the user already answered in the console",
            arguments.Contains("/SP-"));
        check(
            "no language override, which would ignore the system locale",
            !arguments.Contains("/LANG"));
    }
}
