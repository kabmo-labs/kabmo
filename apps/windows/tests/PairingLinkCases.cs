/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pasted pairing link.
 *
 * The refusals are the point: a link to some other page on the same server would
 * load a page that never sets a cookie, and the user would be left on a console
 * that still asks for a password. The deep link is refused on purpose — its origin
 * lives inside the encoded payload, which this deliberately does not decode.
 *
 * The same cases exist in `apps/macos/Tests/PairingLinkTests.swift`,
 * `apps/ios/Tests/PairingLinkTests.swift` and
 * `apps/android/…/PairingLinkTest.kt`.
 */

using KabmoDesktop;

namespace KabmoDesktopTests;

static class PairingLinkCases
{
    public static void Run(Action<string, bool> check, Action<string> group)
    {
        group("PairingLink — accepted");

        check("an https pairing link yields its origin",
            PairingLink.OriginOf("https://laptop.tailnet.ts.net/pair#eyJ2IjoxfQ")
                == "https://laptop.tailnet.ts.net");
        check("a non-default port is kept",
            PairingLink.OriginOf("http://192.168.18.79:3000/pair#abc") == "http://192.168.18.79:3000");
        check("a trailing slash on the path is tolerated",
            PairingLink.OriginOf("https://kabmo.example.com/pair/#abc") == "https://kabmo.example.com");

        group("PairingLink — refused");

        check("a page that is not the pairing page is refused",
            PairingLink.OriginOf("https://kabmo.example.com/settings#abc") is null);
        check("the bare origin is refused",
            PairingLink.OriginOf("https://kabmo.example.com/") is null);
        check("the deep link is refused because its origin is inside the payload",
            PairingLink.OriginOf("kabmo://connect?v=1&p=eyJ2IjoxfQ") is null);
        check("an empty string is refused", PairingLink.OriginOf("") is null);
        check("whitespace is refused", PairingLink.OriginOf("   ") is null);
        check("a non-http scheme is refused", PairingLink.OriginOf("ftp://host/pair#x") is null);

        group("PairingLink — the hint agrees with the parser");
        check("a pairing link looks like one", PairingLink.LooksLikePairingLink("https://host/pair#x"));
        check("another page does not", !PairingLink.LooksLikePairingLink("https://host/other#x"));
    }
}
