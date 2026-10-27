// @license
// SPDX-License-Identifier: Apache-2.0

//! The self-update's rules, pinned without a display.
//!
//! Every case here is a way an update could install the wrong thing, and NONE of
//! them throws in the app: a wrong host allowlist downloads from anywhere, a wrong
//! ELF check runs the other architecture's build, a wrong comparison downgrades the
//! app. The download and the swap need a network and a running AppImage; these
//! rules need neither.
//!
//! The cases are the macOS and Windows suites', restated where the question is the
//! same — the three shells share no runtime, so the same table in each is what
//! keeps them from disagreeing.

use std::path::{Path, PathBuf};

use kabmo_desktop::update::{
    appimage_of, arch, asset_arch, elf_matches_arch, is_newer, is_trusted_download, outcome, plan,
    refusal, relaunch_script, staged_path, EM_AARCH64, EM_X86_64,
};

use crate::support::Runner;

/// An ELF header for `machine`, as the first bytes of a real image would be.
fn elf(machine: u16) -> Vec<u8> {
    let mut header = vec![0u8; 64];
    header[..4].copy_from_slice(b"\x7fELF");
    header[4] = 2; // 64-bit
    header[5] = 1; // little-endian
    header[18..20].copy_from_slice(&machine.to_le_bytes());
    header
}

pub fn cases(r: &mut Runner) {
    r.group("update — where a download may come from");
    r.check(
        "a release asset on github.com",
        is_trusted_download(
            "https://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/Kabmo-0.3.0-linux-x86_64.AppImage",
        ),
    );
    r.check(
        "the CDN host GitHub redirects an asset to",
        is_trusted_download("https://objects.githubusercontent.com/github-production-release-asset/x/y"),
    );
    r.check(
        "release-assets.githubusercontent.com",
        is_trusted_download("https://release-assets.githubusercontent.com/x"),
    );
    r.check(
        "plain http is refused, because the bytes decide what gets installed",
        !is_trusted_download("http://github.com/kabmo-labs/kabmo/releases/download/v0.3.0/x.AppImage"),
    );
    r.check(
        "another host is refused, even over https",
        !is_trusted_download("https://example.com/Kabmo.AppImage"),
    );
    r.check(
        "a host that merely CONTAINS a trusted name is refused",
        !is_trusted_download("https://github.com.example.com/Kabmo.AppImage"),
    );
    r.check(
        "a malformed authority is refused, because a parser that stops at the first colon reads it as github.com",
        !is_trusted_download("https://github.com:8443.evil.test/x"),
    );
    r.check(
        "a real port on a trusted host is still that host",
        is_trusted_download("https://github.com:8443/x.AppImage"),
    );
    r.check(
        "userinfo cannot smuggle another host past the allowlist",
        !is_trusted_download("https://github.com@evil.test/x.AppImage"),
    );
    r.check("an empty URL is refused", !is_trusted_download(""));

    r.group("update — which architecture this machine runs");
    r.check(
        "the reported arch is one of the console's two tokens",
        arch() == "arm64" || arch() == "x64",
    );
    r.check(
        "the asset spelling is the Linux one",
        asset_arch("x64") == "x86_64" && asset_arch("arm64") == "arm64",
    );
    r.check("an x86-64 header is an x64 build", elf_matches_arch(&elf(EM_X86_64), "x64"));
    r.check("an AArch64 header is an arm64 build", elf_matches_arch(&elf(EM_AARCH64), "arm64"));
    r.check(
        "the OTHER architecture's build is refused",
        !elf_matches_arch(&elf(EM_AARCH64), "x64") && !elf_matches_arch(&elf(EM_X86_64), "arm64"),
    );
    r.check(
        "an HTML error page saved as a binary is refused",
        !elf_matches_arch(b"<!DOCTYPE html><html><body>404</body></html>", "x64"),
    );
    r.check("a truncated header is refused", !elf_matches_arch(b"\x7fELF", "x64"));

    r.group("update — the version comparison");
    r.check("a higher patch is newer", is_newer("0.3.1", "0.3.0"));
    r.check("a higher minor is newer", is_newer("0.4.0", "0.3.9"));
    r.check("a higher major is newer", is_newer("1.0.0", "0.9.9"));
    r.check("the same version is not newer", !is_newer("0.3.0", "0.3.0"));
    r.check("an older version is not newer", !is_newer("0.2.9", "0.3.0"));
    r.check("a prerelease suffix is ignored", is_newer("0.3.1-beta.2", "0.3.0"));
    r.check("a leading v is ignored", is_newer("v0.3.1", "0.3.0"));
    r.check("a non-numeric segment counts as 0", !is_newer("0.3.x", "0.3.0"));
    r.check("a shorter version compares without panicking", !is_newer("0.3", "0.3.0"));
    r.check("an empty installed version makes any real version newer", is_newer("0.3.0", ""));

    r.group("update — what may be installed");
    let url = "https://github.com/kabmo-labs/kabmo/releases/download/v0.3.1/Kabmo-0.3.1-linux-x86_64.AppImage";
    r.check(
        "a newer image from the release page",
        refusal(url, "0.3.1", "0.3.0", &elf(EM_X86_64), "x64").is_none(),
    );
    r.check(
        "an untrusted host is refused",
        refusal("https://example.com/Kabmo.AppImage", "0.3.1", "0.3.0", &elf(EM_X86_64), "x64")
            .is_some(),
    );
    r.check(
        "the other architecture is refused",
        refusal(url, "0.3.1", "0.3.0", &elf(EM_AARCH64), "x64").is_some(),
    );
    r.check(
        "the same build is refused, because that is not an update",
        refusal(url, "0.3.0", "0.3.0", &elf(EM_X86_64), "x64").is_some(),
    );
    r.check(
        "an OLDER build is refused, because installing it would be a downgrade",
        refusal(url, "0.2.0", "0.3.0", &elf(EM_X86_64), "x64").is_some(),
    );
    r.check(
        "a missing published version is refused",
        refusal(url, "", "0.3.0", &elf(EM_X86_64), "x64").is_some(),
    );

    r.group("update — what it will replace");
    r.check(
        "an AppImage path is read from the environment",
        appimage_of(Some("/home/x/Apps/Kabmo.AppImage"))
            == Some(PathBuf::from("/home/x/Apps/Kabmo.AppImage")),
    );
    r.check(
        "a package-manager install has no image to replace, and says so",
        appimage_of(None).is_none() && appimage_of(Some("  ")).is_none(),
    );
    r.check(
        "the staged file sits BESIDE the image, so the rename stays on one filesystem",
        staged_path(Path::new("/home/x/Apps/Kabmo.AppImage"))
            == PathBuf::from("/home/x/Apps/Kabmo.AppImage.new"),
    );
    r.check(
        "the relaunch waits for this pid, so two instances never share the port",
        relaunch_script(Path::new("/home/x/Apps/Kabmo.AppImage"), 4242)
            .contains("kill -0 4242"),
    );
    r.check(
        "the relaunch execs the image it was given",
        relaunch_script(Path::new("/home/x/Apps/Kabmo.AppImage"), 4242)
            .contains("exec '/home/x/Apps/Kabmo.AppImage'"),
    );
    r.check(
        "a path with a quote in it is escaped for the shell",
        relaunch_script(Path::new("/home/x/It's/Kabmo.AppImage"), 1).contains("It'\\''s"),
    );

    // The shell threads `update_apply` because it runs on the GTK loop (see
    // `main.rs`), which puts the two decisions that used to be inline in a place
    // a test can reach. Both are silent failures when wrong: a refusal that
    // scheduled a restart brings the process back as the image it already runs
    // while the page reports the failure, and a plan accepted without an
    // AppImage hands the thread a path it cannot replace.
    r.group("update — what the shell decides before and after the download");
    let request = serde_json::json!({
        "url": "https://github.com/kabmo-labs/kabmo/releases/download/v0.5.0/Kabmo-0.5.0-linux-x86_64.AppImage",
        "version": "0.5.0",
    });
    let installable = plan(&request, Some("/home/x/Apps/Kabmo.AppImage"))
        .expect("an AppImage install is a plan");
    r.check(
        "the plan carries the address, the published version and the image",
        installable.url == request["url"].as_str().unwrap()
            && installable.version == "0.5.0"
            && installable.image == PathBuf::from("/home/x/Apps/Kabmo.AppImage"),
    );
    r.check(
        "a build that is not an AppImage is refused BEFORE anything is downloaded",
        plan(&request, None).is_err(),
    );
    r.check(
        "the refusal names the release page instead of a path it would guess",
        plan(&request, None)
            .err()
            .map(|reason| reason.contains("Download the release"))
            .unwrap_or(false),
    );

    let installed = outcome(Ok("Kabmo 0.5.0 is being installed".to_string()), &installable);
    r.check(
        "a successful install restarts into the image it installed",
        installed.relaunch.as_deref() == Some(Path::new("/home/x/Apps/Kabmo.AppImage")),
    );
    r.check(
        "…and tells the page it is restarting, with the published version",
        installed.ok
            && installed.payload["relaunching"] == serde_json::json!(true)
            && installed.payload["version"] == serde_json::json!("0.5.0"),
    );

    let failed = outcome(Err("The update was refused.".to_string()), &installable);
    r.check(
        "a FAILED install schedules no restart — the old image would come back",
        failed.relaunch.is_none(),
    );
    r.check(
        "…and answers with the sentence the page shows",
        !failed.ok && failed.payload == serde_json::json!("The update was refused."),
    );
}
