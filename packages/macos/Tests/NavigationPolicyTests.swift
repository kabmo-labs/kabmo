/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 Where a link goes, pinned without a window server.

 Every case here fails SILENTLY in the app: a link that replaces the console
 leaves the user with no way back except ⌘R, and a same-origin navigation sent to
 the system browser breaks the console's own routing. Neither throws.

 The one the update control needed: the console's desktop offer links the RELEASE
 PAGE on github.com, which is another origin, and before this the click replaced
 Kabmo with the release page inside the window.
 */
import Foundation

import KabmoDesktop

func navigationPolicyCases() {
  group("NavigationPolicy — inside the console")

  check(
    "a same-origin path stays",
    NavigationPolicy.decide(from: "http://127.0.0.1:3000/s/abc", to: "http://127.0.0.1:3000/api/health") == .inside
  )
  check(
    "a different path on the same origin stays",
    NavigationPolicy.decide(from: "http://127.0.0.1:3000/", to: "http://127.0.0.1:3000/files/x.ts") == .inside
  )
  check(
    "a host written in another case is the same origin",
    NavigationPolicy.decide(from: "http://KABMO.test/", to: "http://kabmo.test/x") == .inside
  )
  check(
    "the default port is the same origin as its absence",
    NavigationPolicy.decide(from: "https://kabmo.test/", to: "https://kabmo.test:443/x") == .inside
  )
  check(
    "a relative reference stays, because the web view resolves it",
    NavigationPolicy.decide(from: "http://kabmo.test/a/b", to: "/c") == .inside
  )
  check(
    "no destination stays",
    NavigationPolicy.decide(from: "http://kabmo.test/", to: nil) == .inside
  )

  group("NavigationPolicy — out to the browser")

  // The update offer's own link: a desktop artifact is per-architecture, so the
  // console answers the RELEASE PAGE.
  check(
    "the release page leaves",
    NavigationPolicy.decide(
      from: "http://127.0.0.1:3000/",
      to: "https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0"
    ) == .external
  )
  check(
    "another host leaves",
    NavigationPolicy.decide(from: "http://kabmo.test/", to: "http://elsewhere.test/") == .external
  )
  check(
    "another PORT is another origin",
    NavigationPolicy.decide(from: "http://127.0.0.1:3000/", to: "http://127.0.0.1:3001/") == .external
  )
  check(
    "another scheme leaves",
    NavigationPolicy.decide(from: "https://kabmo.test/", to: "http://kabmo.test/") == .external
  )
  check(
    "mailto leaves",
    NavigationPolicy.decide(from: "http://kabmo.test/", to: "mailto:someone@example.test") == .external
  )

  group("NavigationPolicy — the origin itself")

  check("an http origin", NavigationPolicy.origin(of: "http://127.0.0.1:3000/x") == "http://127.0.0.1:3000")
  check("a default port is spelled without it", NavigationPolicy.origin(of: "https://kabmo.test/x") == "https://kabmo.test")
  check("a userinfo segment is not the host", NavigationPolicy.origin(of: "https://u:p@kabmo.test/x") == "https://kabmo.test")
  check("no scheme is no origin", NavigationPolicy.origin(of: "/x/y") == nil)
  check("no host is no origin", NavigationPolicy.origin(of: "http:///x") == nil)
  check("a non-http scheme has no comparable origin", NavigationPolicy.origin(of: "mailto:x@y.test") == nil)

  group("NavigationPolicy — a page with no origin")

  // `about:blank` is what a popup frame is before it navigates. Treating it as
  // "not the console" would send the OAuth handshake out to a browser.
  check(
    "about:blank stays",
    NavigationPolicy.decide(from: nil, to: "about:blank") == .inside
  )
  check(
    "a console with no origin keeps its own links",
    NavigationPolicy.decide(from: nil, to: "http://kabmo.test/x") == .inside
  )
}
