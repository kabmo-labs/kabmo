/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The origin a pasted pairing link points at.
 *
 * The shell does NOT parse the pairing payload. It loads the link in its own web
 * view and lets the server's `/pair` page redeem it — that page already decodes
 * the payload, posts the claim, and the cookie it receives lands in THIS app's
 * cookie store, which is the whole point. A second parser here would be a second
 * place for the payload format to drift.
 *
 * So the only thing this needs to answer is "which server is this link for",
 * because that is what the shell stores and what it must load.
 *
 * The same rules exist in `packages/macos/Sources/KabmoDesktop/PairingLink.swift`,
 * `packages/ios/Sources/KabmoShell/PairingLink.swift` and
 * `packages/android/…/PairingLink.kt`: a link one shell accepts and another
 * refuses is two products, the same reason `ServerAddress.Normalise` is
 * duplicated.
 */

namespace KabmoDesktop;

public static class PairingLink
{
    /// <summary>The origin of a pasted pairing link, or null when it is not one.</summary>
    public static string? OriginOf(string? raw)
    {
        var trimmed = raw?.Trim();
        if (string.IsNullOrEmpty(trimmed)) return null;
        if (!Uri.TryCreate(trimmed, UriKind.Absolute, out var parsed)) return null;

        var scheme = parsed.Scheme.ToLowerInvariant();
        if (scheme != "http" && scheme != "https") return null;
        if (string.IsNullOrEmpty(parsed.Host)) return null;

        // The path must be the pairing page. A link to some other page on the same
        // server is not a pairing link, and loading it would leave the user on a
        // page that never sets a cookie.
        var path = parsed.AbsolutePath.Trim('/');
        if (path != "pair") return null;

        return parsed.IsDefaultPort
            ? $"{scheme}://{parsed.Host}"
            : $"{scheme}://{parsed.Host}:{parsed.Port}";
    }

    /// <summary>Whether <paramref name="raw"/> looks like a pairing link at all.</summary>
    public static bool LooksLikePairingLink(string? raw) => OriginOf(raw) is not null;
}
