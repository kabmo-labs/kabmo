/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Where a link goes, pinned without a window.
 *
 * Every case here fails SILENTLY in the app: a link that replaces the console
 * leaves the user with no way back, and a same-origin navigation sent to the
 * system browser breaks the console's own routing. Neither throws.
 *
 * The one the update control needed: the console's desktop offer links the
 * RELEASE PAGE on github.com, which is another origin, and before this the click
 * replaced Kabmo with the release page inside the window.
 *
 * The cases are the macOS suite's, restated — the two shells share no runtime, so
 * the same table in both is what keeps them from disagreeing about what leaves.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class NavigationPolicyCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        group("NavigationPolicy — inside the console");

        check(
            "a same-origin path stays",
            NavigationPolicy.Decide("http://127.0.0.1:3000/s/abc", "http://127.0.0.1:3000/api/health") == NavigationTarget.Inside);
        check(
            "a host written in another case is the same origin",
            NavigationPolicy.Decide("http://KABMO.test/", "http://kabmo.test/x") == NavigationTarget.Inside);
        check(
            "the default port is the same origin as its absence",
            NavigationPolicy.Decide("https://kabmo.test/", "https://kabmo.test:443/x") == NavigationTarget.Inside);
        check(
            "a relative reference stays, because the web view resolves it",
            NavigationPolicy.Decide("http://kabmo.test/a/b", "/c") == NavigationTarget.Inside);
        check(
            "no destination stays",
            NavigationPolicy.Decide("http://kabmo.test/", null) == NavigationTarget.Inside);

        group("NavigationPolicy — out to the browser");

        // The update offer's own link: a desktop artifact is per-architecture, so
        // the console answers the RELEASE PAGE.
        check(
            "the release page leaves",
            NavigationPolicy.Decide(
                "http://127.0.0.1:3000/",
                "https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0") == NavigationTarget.External);
        check(
            "another host leaves",
            NavigationPolicy.Decide("http://kabmo.test/", "http://elsewhere.test/") == NavigationTarget.External);
        check(
            "another PORT is another origin",
            NavigationPolicy.Decide("http://127.0.0.1:3000/", "http://127.0.0.1:3001/") == NavigationTarget.External);
        check(
            "another scheme leaves",
            NavigationPolicy.Decide("https://kabmo.test/", "http://kabmo.test/") == NavigationTarget.External);
        check(
            "mailto leaves",
            NavigationPolicy.Decide("http://kabmo.test/", "mailto:someone@example.test") == NavigationTarget.External);

        group("NavigationPolicy — document content stays");

        // A popup frame is `about:blank` before it navigates, and handing that to
        // the shell would break the OAuth handshake.
        check(
            "about:blank stays",
            NavigationPolicy.Decide(null, "about:blank") == NavigationTarget.Inside);
        check(
            "a data: document stays",
            NavigationPolicy.Decide("http://kabmo.test/", "data:text/plain,hi") == NavigationTarget.Inside);
        check(
            "a javascript: handler stays",
            NavigationPolicy.Decide("http://kabmo.test/", "javascript:void(0)") == NavigationTarget.Inside);

        group("NavigationPolicy — the origin itself");

        check("an http origin", NavigationPolicy.OriginOf("http://127.0.0.1:3000/x") == "http://127.0.0.1:3000");
        check("a default port is spelled without it", NavigationPolicy.OriginOf("https://kabmo.test/x") == "https://kabmo.test");
        check("a userinfo segment is not the host", NavigationPolicy.OriginOf("https://u:p@kabmo.test/x") == "https://kabmo.test");
        check("no scheme is no origin", NavigationPolicy.OriginOf("/x/y") is null);
        check("no host is no origin", NavigationPolicy.OriginOf("http:///x") is null);
        check("a non-http scheme has no comparable origin", NavigationPolicy.OriginOf("mailto:x@y.test") is null);
        check("a host and port with no scheme is no origin", NavigationPolicy.OriginOf("192.168.1.20:3000") is null);
    }
}
