/**
 * @license
 * SPDX-License-Identifier: MIT
 */

// What a URL the user typed may become, and what it may not.

use kabmo_desktop::store::{normalise_url, port_of, server_id_port, server_id_value, ServerKind};

use crate::support::Runner;

pub fn cases(r: &mut Runner) {
    r.group("normalise_url");
    r.check(
        "host:port gains http",
        normalise_url("192.168.1.10:3000").ok().as_deref() == Some("http://192.168.1.10:3000"),
    );
    r.check(
        "https is kept",
        normalise_url("https://kabmo.example.com").ok().as_deref()
            == Some("https://kabmo.example.com"),
    );
    r.check(
        "a trailing slash is the root",
        normalise_url("  http://10.0.0.2:8080/  ").ok().as_deref() == Some("http://10.0.0.2:8080"),
    );
    // A base path is refused rather than dropped: the client asks for /api/... at
    // the domain root, so a page served from /kabmo/ would load and then fail
    // every request.
    r.throws("a base path is refused", || {
        normalise_url("https://host/kabmo/").is_err()
    });
    r.throws("a non-http scheme is refused", || {
        normalise_url("ftp://host").is_err()
    });
    r.throws("credentials in the url are refused", || {
        normalise_url("http://user:pass@host:3000").is_err()
    });
    r.throws("an empty value is refused", || normalise_url("   ").is_err());

    r.group("server_id");
    r.check(
        "local ids are keyed by port",
        server_id_port(ServerKind::Managed, 3001) == "local:3001",
    );
    r.check(
        "remote ids are keyed by url",
        server_id_value(ServerKind::Remote, "http://nas:8443") == "remote:http://nas:8443",
    );
    r.check(
        "a local id names its port",
        port_of("local:3001") == Some(3001) && port_of("remote:http://nas:8443").is_none(),
    );
}
