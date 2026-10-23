// @license
// SPDX-License-Identifier: Apache-2.0

//! Where a navigation goes: inside this window, or out to the system browser.
//!
//! The macOS shell's `NavigationPolicy` and the Windows shell's, restated here
//! because the three share no runtime — and pinned by the same cases, so they
//! cannot disagree about what leaves.
//!
//! The Linux shell already had this decision, but only as `same_origin` inside
//! `main.rs`, where the rules suite could not reach it (the suite links the
//! library, not the binary). It lives here now, which is what makes the cases in
//! `rules/navigation.rs` possible at all.
//!
//! The one the update control needed: the console's desktop offer links the
//! RELEASE PAGE on github.com — every desktop artifact is per-architecture, so
//! the server cannot name one file — and that is another origin.

/// Where a navigation goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NavigationTarget {
    /// Load it in this window.
    Inside,
    /// Hand it to the system browser.
    External,
}

/// The schemes that are DOCUMENT content rather than destinations.
///
/// `about:blank` is what a popup frame is before it navigates, `blob:` and
/// `data:` are documents the page built, and `javascript:` is a link handler.
/// Handing any of them to `xdg-open` would open nothing and — because the
/// decision ignores the navigation — break the navigation that needed them.
const INTERNAL_SCHEMES: [&str; 4] = ["about", "blob", "data", "javascript"];

/// The decision for a navigation from `here` to `there`.
///
/// A destination with no scheme is INTERNAL: it is a relative reference, and
/// resolving it is the web view's job.
pub fn decide(here: Option<&str>, there: Option<&str>) -> NavigationTarget {
    let Some(there) = there else {
        return NavigationTarget::Inside;
    };
    if there.is_empty() {
        return NavigationTarget::Inside;
    }

    let Some(scheme) = scheme_of(there) else {
        return NavigationTarget::Inside;
    };
    if INTERNAL_SCHEMES.contains(&scheme.as_str()) {
        return NavigationTarget::Inside;
    }

    // A scheme with no page behind it: the system owns it.
    if scheme != "http" && scheme != "https" {
        return NavigationTarget::External;
    }

    // A page with no comparable origin — the first load of a window, a frame
    // before its document exists — stays.
    match (here.and_then(origin_of), origin_of(there)) {
        (Some(a), Some(b)) => {
            if a == b {
                NavigationTarget::Inside
            } else {
                NavigationTarget::External
            }
        }
        _ => NavigationTarget::Inside,
    }
}

/// Whether two URLs share an origin, for a caller that only needs the test.
pub fn same_origin(here: &str, there: &str) -> bool {
    decide(Some(here), Some(there)) == NavigationTarget::Inside
}

/// `scheme://host[:port]`, with a DEFAULT port spelled without it.
pub fn origin_of(url: &str) -> Option<String> {
    let scheme = scheme_of(url)?;
    if scheme != "http" && scheme != "https" {
        return None;
    }

    let after_scheme = url.split_once("://")?.1;
    let authority = after_scheme
        .split(['/', '?', '#'])
        .next()
        .unwrap_or(after_scheme);
    if authority.is_empty() {
        return None;
    }

    // A userinfo segment (`user:pass@host`) is not part of the origin.
    let host_port = authority.rsplit_once('@').map_or(authority, |(_, rest)| rest);
    if host_port.is_empty() {
        return None;
    }

    let (host, port) = match host_port.split_once(':') {
        Some((host, port)) => (host, Some(port)),
        None => (host_port, None),
    };
    if host.is_empty() {
        return None;
    }

    let default_port = if scheme == "https" { "443" } else { "80" };
    let host = host.to_lowercase();
    match port {
        None | Some("") => Some(format!("{}://{}", scheme, host)),
        Some(p) if p == default_port => Some(format!("{}://{}", scheme, host)),
        Some(p) => Some(format!("{}://{}:{}", scheme, host, p)),
    }
}

/// The lowercased scheme, or `None` when there is none.
///
/// Two shapes, because both are real destinations: `https://host/x` (with `//`)
/// and `mailto:someone@example.test` (without). A colon with anything but a
/// scheme before it — `192.168.1.20:3000` — is a host and port.
fn scheme_of(url: &str) -> Option<String> {
    if let Some((scheme, _)) = url.split_once("://") {
        return if scheme.is_empty() {
            None
        } else {
            Some(scheme.to_lowercase())
        };
    }

    let (scheme, _) = url.split_once(':')?;
    let mut characters = scheme.chars();
    if !characters.next()?.is_alphabetic() {
        return None;
    }
    if !scheme
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '+' || c == '-' || c == '.')
    {
        return None;
    }
    Some(scheme.to_lowercase())
}
