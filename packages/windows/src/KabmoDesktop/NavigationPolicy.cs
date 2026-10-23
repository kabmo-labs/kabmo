/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Where a navigation goes: inside this window, or out to the system browser.
 *
 * The Windows shell had no navigation policy either — `NavigationStarting` was
 * wired for the splash and nothing decided where a link pointed, so every link
 * replaced the console. That is a trap for the update control the console draws
 * (a desktop offer links the RELEASE PAGE, since every desktop artifact is
 * per-architecture) and it was already wrong for the release notes, the social
 * links and every citation in a chat.
 *
 * The rules are the macOS shell's `NavigationPolicy`, restated in C# because the
 * two shells share no runtime — and pinned by the same cases, so the two cannot
 * disagree about what leaves.
 */

namespace KabmoDesktop;

public enum NavigationTarget
{
    /// <summary>Load it in this window.</summary>
    Inside,

    /// <summary>Hand it to the system browser.</summary>
    External,
}

public static class NavigationPolicy
{
    /// <summary>
    /// The schemes that are DOCUMENT content rather than destinations.
    ///
    /// `about:blank` is what a popup frame is before it navigates, `blob:` and
    /// `data:` are documents the page built, and `javascript:` is a link handler.
    /// Handing any of them to the shell would open nothing and — because the
    /// decision cancels — break the navigation that needed them.
    /// </summary>
    private static readonly HashSet<string> InternalSchemes =
        new(StringComparer.Ordinal) { "about", "blob", "data", "javascript" };

    /// <summary>The decision for a navigation from <paramref name="current"/> to <paramref name="destination"/>.</summary>
    public static NavigationTarget Decide(string? current, string? destination)
    {
        if (string.IsNullOrEmpty(destination)) return NavigationTarget.Inside;

        var scheme = SchemeOf(destination);
        if (scheme is null) return NavigationTarget.Inside;
        if (InternalSchemes.Contains(scheme)) return NavigationTarget.Inside;

        // A scheme with no page behind it: the system owns it. `mailto:` and
        // `tel:` are the two a chat citation really produces.
        if (scheme != "http" && scheme != "https") return NavigationTarget.External;

        // A page with no comparable origin — the first load of a window, a frame
        // before its document exists — stays.
        var here = OriginOf(current);
        var there = OriginOf(destination);
        if (here is null || there is null) return NavigationTarget.Inside;

        return string.Equals(here, there, StringComparison.Ordinal) ? NavigationTarget.Inside : NavigationTarget.External;
    }

    /// <summary>`scheme://host[:port]`, with a DEFAULT port spelled without it.</summary>
    public static string? OriginOf(string? url)
    {
        if (string.IsNullOrEmpty(url)) return null;
        var scheme = SchemeOf(url);
        if (scheme != "http" && scheme != "https") return null;

        var afterScheme = url[(url.IndexOf("://", StringComparison.Ordinal) + 3)..];
        var authority = afterScheme.Split('/', '?', '#')[0];
        if (authority.Length == 0) return null;

        // A userinfo segment (`user:pass@host`) is not part of the origin.
        var at = authority.LastIndexOf('@');
        var hostPort = at >= 0 ? authority[(at + 1)..] : authority;
        if (hostPort.Length == 0) return null;

        var colon = hostPort.IndexOf(':');
        var host = (colon >= 0 ? hostPort[..colon] : hostPort).ToLowerInvariant();
        if (host.Length == 0) return null;

        var port = colon >= 0 ? hostPort[(colon + 1)..] : "";
        var defaultPort = scheme == "https" ? "443" : "80";
        if (port.Length == 0 || port == defaultPort) return $"{scheme}://{host}";

        return $"{scheme}://{host}:{port}";
    }

    /// <summary>The lowercased scheme, or null when there is none.</summary>
    ///
    /// Two shapes, because both are real destinations: `https://host/x` (with
    /// `//`) and `mailto:someone@example.test` (without). A colon with anything
    /// but a scheme before it — `192.168.1.20:3000` — is a host and port.
    private static string? SchemeOf(string url)
    {
        var separator = url.IndexOf("://", StringComparison.Ordinal);
        if (separator > 0) return url[..separator].ToLowerInvariant();

        var colon = url.IndexOf(':');
        if (colon <= 0) return null;

        var scheme = url[..colon].ToLowerInvariant();
        if (!char.IsLetter(scheme[0])) return null;
        foreach (var character in scheme)
        {
            if (!char.IsLetterOrDigit(character) && character != '+' && character != '-' && character != '.')
            {
                return null;
            }
        }
        return scheme;
    }
}
