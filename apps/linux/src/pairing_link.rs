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
 * The same rules exist in `apps/macos/Sources/KabmoDesktop/PairingLink.swift`,
 * `apps/ios/Sources/KabmoShell/PairingLink.swift`,
 * `apps/windows/src/KabmoDesktop/PairingLink.cs` and
 * `apps/android/…/PairingLink.kt`: a link one shell accepts and another
 * refuses is two products, the same reason `normalise_url` is duplicated.
 */

/// The origin of a pasted pairing link, or `None` when it is not one.
pub fn origin_of(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }

    // Split by hand rather than with a URL crate: the shell has no dependencies
    // beyond GTK/WebKit, and the shape accepted here is narrow — scheme, host,
    // optional port, and the `/pair` path.
    let (scheme, rest) = trimmed.split_once("://")?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }

    // The authority ends at the first `/`, `?` or `#`.
    let authority_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let authority = &rest[..authority_end];
    if authority.is_empty() {
        return None;
    }

    let path_and_rest = &rest[authority_end..];
    let path_end = path_and_rest.find(['?', '#']).unwrap_or(path_and_rest.len());
    let path = path_and_rest[..path_end].trim_matches('/');
    // The path must be the pairing page. A link to some other page on the same
    // server is not a pairing link, and loading it would leave the user on a page
    // that never sets a cookie.
    if path != "pair" {
        return None;
    }

    Some(format!("{scheme}://{authority}"))
}

/// Whether `raw` looks like a pairing link at all, for the field's own hint.
pub fn looks_like_pairing_link(raw: &str) -> bool {
    origin_of(raw).is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_origin_of_an_https_link() {
        assert_eq!(
            origin_of("https://laptop.tailnet.ts.net/pair#eyJ2IjoxfQ").as_deref(),
            Some("https://laptop.tailnet.ts.net")
        );
    }

    #[test]
    fn keeps_a_non_default_port() {
        assert_eq!(
            origin_of("http://192.168.18.79:3000/pair#abc").as_deref(),
            Some("http://192.168.18.79:3000")
        );
    }

    #[test]
    fn tolerates_a_trailing_slash_on_the_path() {
        assert_eq!(
            origin_of("https://kabmo.example.com/pair/#abc").as_deref(),
            Some("https://kabmo.example.com")
        );
    }

    #[test]
    fn refuses_a_page_that_is_not_the_pairing_page() {
        assert_eq!(origin_of("https://kabmo.example.com/settings#abc"), None);
        assert_eq!(origin_of("https://kabmo.example.com/"), None);
    }

    #[test]
    fn refuses_the_deep_link() {
        assert_eq!(origin_of("kabmo://connect?v=1&p=eyJ2IjoxfQ"), None);
    }

    #[test]
    fn refuses_what_is_not_a_url() {
        assert_eq!(origin_of(""), None);
        assert_eq!(origin_of("   "), None);
        assert_eq!(origin_of("ftp://host/pair#x"), None);
    }
}
