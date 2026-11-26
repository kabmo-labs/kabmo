// @license
// SPDX-License-Identifier: MIT

//! Where a link goes, pinned without a display.
//!
//! Every case here fails SILENTLY in the app: a link that replaces the console
//! leaves the user with no way back, and a same-origin navigation sent to
//! `xdg-open` breaks the console's own routing. Neither throws.
//!
//! The one the update control needed: the console's desktop offer links the
//! RELEASE PAGE on github.com — every desktop artifact is per-architecture, so
//! the server cannot name one file — and that is another origin.
//!
//! The cases are the macOS and Windows suites', restated: the three shells share
//! no runtime, so the same table in each is what keeps them from disagreeing.

use kabmo_desktop::navigation::{decide, decide_for, origin_of, same_origin, NavigationFrame, NavigationTarget};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("navigation — inside the console");
    r.check(
        "a same-origin path stays",
        decide(Some("http://127.0.0.1:3000/s/abc"), Some("http://127.0.0.1:3000/api/health"))
            == NavigationTarget::Inside,
    );
    r.check(
        "a host written in another case is the same origin",
        same_origin("http://KABMO.test/", "http://kabmo.test/x"),
    );
    r.check(
        "the default port is the same origin as its absence",
        same_origin("https://kabmo.test/", "https://kabmo.test:443/x"),
    );
    r.check(
        "a relative reference stays, because the web view resolves it",
        decide(Some("http://kabmo.test/a/b"), Some("/c")) == NavigationTarget::Inside,
    );
    r.check(
        "no destination stays",
        decide(Some("http://kabmo.test/"), None) == NavigationTarget::Inside,
    );

    r.group("navigation — out to the browser");
    // The update offer's own link: a desktop artifact is per-architecture, so the
    // console answers the RELEASE PAGE.
    r.check(
        "the release page leaves",
        decide(
            Some("http://127.0.0.1:3000/"),
            Some("https://github.com/kabmo-labs/kabmo/releases/tag/v0.7.0"),
        ) == NavigationTarget::External,
    );
    r.check(
        "another host leaves",
        decide(Some("http://kabmo.test/"), Some("http://elsewhere.test/")) == NavigationTarget::External,
    );
    r.check(
        "another PORT is another origin",
        decide(Some("http://127.0.0.1:3000/"), Some("http://127.0.0.1:3001/")) == NavigationTarget::External,
    );
    r.check(
        "another scheme leaves",
        decide(Some("https://kabmo.test/"), Some("http://kabmo.test/")) == NavigationTarget::External,
    );
    r.check(
        "mailto leaves",
        decide(Some("http://kabmo.test/"), Some("mailto:someone@example.test")) == NavigationTarget::External,
    );

    r.group("navigation — document content stays");
    // A popup frame is `about:blank` before it navigates, and handing that to
    // `xdg-open` would break the OAuth handshake.
    r.check(
        "about:blank stays",
        decide(None, Some("about:blank")) == NavigationTarget::Inside,
    );
    r.check(
        "a data: document stays",
        decide(Some("http://kabmo.test/"), Some("data:text/plain,hi")) == NavigationTarget::Inside,
    );
    r.check(
        "a javascript: handler stays",
        decide(Some("http://kabmo.test/"), Some("javascript:void(0)")) == NavigationTarget::Inside,
    );

    r.group("navigation — the origin itself");
    r.check(
        "an http origin",
        origin_of("http://127.0.0.1:3000/x").as_deref() == Some("http://127.0.0.1:3000"),
    );
    r.check(
        "a default port is spelled without it",
        origin_of("https://kabmo.test/x").as_deref() == Some("https://kabmo.test"),
    );
    r.check(
        "a userinfo segment is not the host",
        origin_of("https://u:p@kabmo.test/x").as_deref() == Some("https://kabmo.test"),
    );
    r.check("no scheme is no origin", origin_of("/x/y").is_none());
    r.check("no host is no origin", origin_of("http:///x").is_none());
    r.check(
        "a non-http scheme has no comparable origin",
        origin_of("mailto:x@y.test").is_none(),
    );
    r.check(
        "a host and port with no scheme is no origin",
        origin_of("192.168.1.20:3000").is_none(),
    );

    r.group("navigation — an embedded frame never leaves");
    // The user browser panel is an `<iframe>`. Its cross-origin loads must stay in
    // the frame: sending them to `xdg-open` made the panel unable to browse.
    r.check(
        "a cross-origin page in an iframe stays",
        decide_for(
            Some("http://127.0.0.1:3000/"),
            Some("http://127.0.0.1:5173/"),
            Some(NavigationFrame::Subframe),
        ) == NavigationTarget::Inside,
    );
    r.check(
        "a mailto: in an iframe stays, because a frame is not a place to leave from",
        decide_for(
            Some("http://kabmo.test/"),
            Some("mailto:x@y.test"),
            Some(NavigationFrame::Subframe),
        ) == NavigationTarget::Inside,
    );
    r.check(
        "a popup is left to the create handler",
        decide_for(
            Some("http://kabmo.test/"),
            Some("https://example.test/"),
            Some(NavigationFrame::NewWindow),
        ) == NavigationTarget::Inside,
    );
    r.check(
        "the same cross-origin URL in the MAIN frame still leaves",
        decide_for(
            Some("http://127.0.0.1:3000/"),
            Some("http://127.0.0.1:5173/"),
            Some(NavigationFrame::Main),
        ) == NavigationTarget::External,
    );

    r.group("navigation — an engine that cannot name the frame");
    // WebKitGTK before 2.56 reports nothing about the frame: measured on 2.52.6,
    // a subframe load is byte-identical to a document load. The direction taken
    // there is stated in `decide_for`: keep pages, still leave for a scheme no
    // frame can render.
    r.check(
        "an http(s) navigation stays when the frame is unknown",
        decide_for(None, Some("http://elsewhere.test/"), None) == NavigationTarget::Inside,
    );
    r.check(
        "a relative reference stays when the frame is unknown",
        decide_for(Some("http://kabmo.test/a"), Some("/b"), None) == NavigationTarget::Inside,
    );
    r.check(
        "a mailto: still leaves when the frame is unknown",
        decide_for(Some("http://kabmo.test/"), Some("mailto:x@y.test"), None)
            == NavigationTarget::External,
    );
    r.check(
        "a document scheme stays when the frame is unknown",
        decide_for(None, Some("about:blank"), None) == NavigationTarget::Inside,
    );
}
