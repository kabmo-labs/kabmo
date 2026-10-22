/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bake the shell's version into the binary.
 *
 * `version.properties` is the only place the number is declared (see that file),
 * and the page receives it as `shellVersion` — so the binary has to know it at
 * compile time. `env!("CARGO_PKG_VERSION")` is NOT usable: the crate's version is
 * its identity for a registry it is never published to, and two numbers for one
 * build is exactly the drift the properties file exists to prevent.
 *
 * A missing or unparsable line FAILS the build rather than defaulting: a shell
 * that reports `0.0.0` is a build nobody can identify, and the failure would
 * surface as a wrong number in a release rather than as a compile error.
 */

use std::path::Path;

fn main() {
    let properties = Path::new(env!("CARGO_MANIFEST_DIR")).join("version.properties");
    println!("cargo:rerun-if-changed={}", properties.display());

    let text = std::fs::read_to_string(&properties)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", properties.display()));

    let version = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#'))
        .find_map(|line| line.strip_prefix("versionName="))
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| {
            panic!(
                "{} declares no versionName= line; refusing to build a shell with no version",
                properties.display()
            )
        });

    println!("cargo:rustc-env=KABMO_SHELL_VERSION={version}");
}
