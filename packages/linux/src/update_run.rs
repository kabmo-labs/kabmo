// @license
// SPDX-License-Identifier: Apache-2.0

//! Downloading and installing a newer AppImage over this one.
//!
//! The RULES live in `update` (pure, and pinned by the rules suite). This module is
//! the part that touches the network and the disk, which is why it is separate: the
//! rules can be checked with no display and no network, and the sequence here is
//! one straight line a reader can check against `rename(2)`'s own guarantee.
//!
//! The order is load-bearing, and each step was chosen against a failure it
//! prevents:
//!
//! 1. **Download beside the image, not into `/tmp`.** `rename` is atomic only
//!    within one filesystem, and `/tmp` is frequently another one (tmpfs). A
//!    cross-device rename fails AFTER the old image was moved aside.
//! 2. **Check the ELF header and the version before touching anything.**
//! 3. **`rename` over the image, then `chmod +x`.** The rename replaces the
//!    directory entry in one step, so a crash leaves either the old image or the
//!    new one — never a truncated half.
//! 4. **Start the replacement after this process is gone.** Two instances would
//!    fight over the managed server's port.

use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use crate::store::ShellError;
use crate::update;

/// The first bytes of a download, read before anything is replaced.
const HEADER_BYTES: usize = 64;

/// Download, verify and install `url` over `image`, and answer what was installed.
///
/// It deliberately does NOT start the replacement: the caller has to send the
/// console its answer first, and a process that exits here would leave the page
/// waiting on a reply for an update that worked. `relaunch` is what the caller runs
/// afterwards.
pub fn apply(
    url: &str,
    published_version: &str,
    installed_version: &str,
    image: &Path,
) -> Result<String, ShellError> {
    if !update::is_trusted_download(url) {
        return Err(ShellError::new(
            "That update does not come from Kabmo's release page, so it was not installed.",
        ));
    }

    let staged = update::staged_path(image);
    let _ = std::fs::remove_file(&staged);

    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout_read(std::time::Duration::from_secs(120))
        .timeout_write(std::time::Duration::from_secs(30))
        .build();

    let response = agent.get(url).call().map_err(|error| {
        ShellError::new(format!("The update could not be downloaded ({error})."))
    })?;
    if response.status() != 200 {
        return Err(ShellError::new(format!(
            "The update could not be downloaded (HTTP {}).",
            response.status()
        )));
    }

    {
        let mut reader = response.into_reader();
        let mut file = std::fs::File::create(&staged)
            .map_err(|error| ShellError::new(format!("The update could not be saved ({error}).")))?;
        std::io::copy(&mut reader, &mut file)
            .map_err(|error| ShellError::new(format!("The update could not be saved ({error}).")))?;
    }

    // Read the header BEFORE anything else, so a refusal costs a `remove_file`.
    let mut header = vec![0u8; HEADER_BYTES];
    let read = std::fs::File::open(&staged)
        .and_then(|mut file| file.read(&mut header))
        .unwrap_or(0);
    header.truncate(read);

    if let Some(reason) = update::refusal(
        url,
        published_version,
        installed_version,
        &header,
        update::arch(),
    ) {
        let _ = std::fs::remove_file(&staged);
        return Err(ShellError::new(reason));
    }

    // Executable before the rename: the file must be runnable the instant it
    // appears at the image's path, or the relaunch fails on a permission error
    // that reads as a corrupt download.
    if let Ok(metadata) = std::fs::metadata(&staged) {
        let mut permissions = metadata.permissions();
        permissions.set_mode(0o755);
        let _ = std::fs::set_permissions(&staged, permissions);
    }

    std::fs::rename(&staged, image).map_err(|error| {
        let _ = std::fs::remove_file(&staged);
        ShellError::new(format!("The new build could not be put in place ({error})."))
    })?;

    Ok(format!("Kabmo {published_version} installed — restarting."))
}

/// Start the build that was just installed, once this process is gone.
///
/// `setsid` detaches the waiter so it survives this process's exit, and the shell
/// loop waits for our pid: the replacement must not boot while the managed server
/// still holds its port.
pub fn relaunch(image: &Path) {
    let script = update::relaunch_script(image, std::process::id());
    let _ = Command::new("/bin/sh").arg("-c").arg(script).spawn();
}
