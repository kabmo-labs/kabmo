// @license
// SPDX-License-Identifier: Apache-2.0

//! The rules a Linux self-update obeys, as pure values.
//!
//! Kept out of the download and the swap for the reason `splash` is out of
//! `splash_view`: every rule below fails SILENTLY in a real run — a wrong host
//! allowlist downloads from anywhere, a wrong ELF check runs the other
//! architecture's build, a wrong comparison downgrades the app — and the rules
//! suite can pin all of them with no display, no network and no AppImage.
//!
//! ## What this CAN and CANNOT promise
//!
//! An AppImage is UNSIGNED, so these checks are integrity, not authenticity: they
//! catch a truncated download, an HTML error page saved as a binary, and the other
//! architecture's build. They do NOT prove the bytes came from this project. Two
//! things bound the damage meanwhile — HTTPS from a GitHub host, and the fact that
//! the file is only ever installed at the path of the image ALREADY running, so a
//! wrong download breaks this app rather than replacing something else.
//!
//! ## Why an AppImage and nothing else
//!
//! `.deb` and `.rpm` need root and a package manager, so a shell cannot install
//! them; the update says so and offers the release page instead. An AppImage is ONE
//! file, and replacing a file is something a process can do — the running image
//! keeps its inode, so the swap is safe while this window is on screen.

use std::path::{Path, PathBuf};

/// The architecture this binary was built for, in the console's vocabulary.
///
/// A compile-time answer: an x86_64 build running under emulation on an Arm
/// machine is still the x86_64 artifact that should replace it.
pub fn arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

/// The asset spelling of an architecture (`x86_64`, not `x64`).
pub fn asset_arch(arch: &str) -> &'static str {
    if arch == "arm64" {
        "arm64"
    } else {
        "x86_64"
    }
}

/// The ELF `e_machine` value for an architecture.
pub const EM_X86_64: u16 = 62;
pub const EM_AARCH64: u16 = 183;

/// Hosts a self-update may download from.
///
/// GitHub serves a release asset from `github.com` (a redirect) and then from a
/// CDN host, so both are listed. It is an ALLOWLIST rather than a scheme test
/// because a console is a network service: a compromised or merely misconfigured
/// one must not be able to point this app at an arbitrary host.
pub const TRUSTED_HOSTS: [&str; 3] = [
    "github.com",
    "objects.githubusercontent.com",
    "release-assets.githubusercontent.com",
];

/// Whether a URL is something this shell will download from.
///
/// Parsed by hand rather than with a URL crate: the shell needs `scheme`, `host`
/// and `port` and nothing else, and a dependency for three fields would be the
/// larger risk.
///
/// The port is checked rather than skipped, and that is the case a naive
/// `strip_prefix` gets wrong: `https://github.com:8443.evil.test/x` yields the
/// host `github.com` to a parser that stops at the first `:`, while nothing about
/// it is a GitHub address. So everything between the colon and the next `/` must
/// be DIGITS — anything else is a malformed authority and is refused.
pub fn is_trusted_download(url: &str) -> bool {
    let Some(rest) = url.trim().strip_prefix("https://") else {
        return false;
    };
    let end = rest
        .find(|c: char| c == '/' || c == ':' || c == '?')
        .unwrap_or(rest.len());
    let host = rest[..end].to_ascii_lowercase();
    if !TRUSTED_HOSTS.contains(&host.as_str()) {
        return false;
    }
    if rest[end..].starts_with(':') {
        let port = &rest[end + 1..];
        let port_end = port.find(|c: char| c == '/' || c == '?').unwrap_or(port.len());
        let digits = &port[..port_end];
        return !digits.is_empty() && digits.bytes().all(|byte| byte.is_ascii_digit());
    }
    true
}

/// Whether `candidate` is a strictly newer version than `installed`.
///
/// Numeric dotted segments only, ignoring a prerelease suffix — the same
/// comparison the console (`src/shared/lib/updates/semver.ts`), the macOS shell
/// and the Windows shell make, so none of the four can disagree about whether an
/// update exists. A segment that is not a number counts as 0.
pub fn is_newer(candidate: &str, installed: &str) -> bool {
    let left = segments(candidate);
    let right = segments(installed);
    let length = left.len().max(right.len());
    for index in 0..length {
        let a = left.get(index).copied().unwrap_or(0);
        let b = right.get(index).copied().unwrap_or(0);
        if a != b {
            return a > b;
        }
    }
    false
}

fn segments(version: &str) -> Vec<u64> {
    let trimmed = version.trim();
    let trimmed = trimmed.strip_prefix('v').or_else(|| trimmed.strip_prefix('V')).unwrap_or(trimmed);
    let core = trimmed.split('-').next().unwrap_or("");
    core.split('.').map(|part| part.parse::<u64>().unwrap_or(0)).collect()
}

/// Whether an ELF header was built for `arch`.
///
/// The `e_machine` field sits at byte 18 of the header, little-endian. Both
/// architectures this project publishes are little-endian, so no byte-order
/// branch is needed — and a file that is not ELF at all is refused, which is the
/// case that matters: a 200 response carrying an HTML error page.
pub fn elf_matches_arch(header: &[u8], arch: &str) -> bool {
    if header.len() < 20 || &header[..4] != b"\x7fELF" {
        return false;
    }
    let machine = u16::from_le_bytes([header[18], header[19]]);
    let expected = if arch == "arm64" { EM_AARCH64 } else { EM_X86_64 };
    machine == expected
}

/// The AppImage this process is running from, if it is one.
///
/// `APPIMAGE` is exported by the AppImage runtime and points at the image file.
/// Its absence means the shell was unpacked or installed by a package manager,
/// and then there is no single file to replace — the update says so rather than
/// guessing a path.
pub fn appimage_of(env: Option<&str>) -> Option<PathBuf> {
    let value = env?.trim();
    if value.is_empty() {
        return None;
    }
    Some(PathBuf::from(value))
}

/// The staged download's path, beside nothing that already exists.
///
/// The SAME directory as the image being replaced, because `rename` is only
/// atomic within one filesystem — a staging copy in `/tmp` is frequently another
/// one, and a cross-device `rename` fails after the old image was already moved
/// aside.
pub fn staged_path(image: &Path) -> PathBuf {
    let mut name = image.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".new");
    image.with_file_name(name)
}

/// Why an update may not be installed, or `None` when it may.
///
/// Every refusal is a SENTENCE, because the console prints it: "the download is
/// not a Kabmo AppImage for this machine" tells a user what happened, and a bare
/// `false` tells them the update is broken.
pub fn refusal(
    url: &str,
    published_version: &str,
    installed_version: &str,
    header: &[u8],
    arch: &str,
) -> Option<String> {
    if !is_trusted_download(url) {
        return Some(
            "That update does not come from Kabmo's release page, so it was not installed."
                .to_string(),
        );
    }
    if !elf_matches_arch(header, arch) {
        return Some("The download is not a Kabmo build for this machine.".to_string());
    }
    if published_version.trim().is_empty() {
        return Some(
            "The update does not declare a version, so it was not installed.".to_string(),
        );
    }
    if !is_newer(published_version, installed_version) {
        return Some(format!(
            "The published build ({published_version}) is not newer than the installed one ({installed_version})."
        ));
    }
    None
}

/// The shell command that starts the replacement AFTER this process exits.
///
/// Ordering is the whole point: two windows on one port is a server conflict, and
/// this app's managed server would still hold the port while the new instance
/// booted. The shell waits for this pid to disappear, then execs the image.
pub fn relaunch_script(image: &Path, pid: u32) -> String {
    let quoted = image.to_string_lossy().replace('\'', "'\\''");
    format!(
        "while kill -0 {pid} 2>/dev/null; do sleep 0.2; done; exec '{quoted}'"
    )
}
