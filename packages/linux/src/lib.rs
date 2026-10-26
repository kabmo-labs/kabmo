/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell's rules, with no window in them.
 *
 * Everything that can be tested without a display lives here — the server list,
 * the health probe, the process supervisor, the bridge's own wire shapes — and
 * the binary in `main.rs` is the AppKit-equivalent wiring on top. That split is
 * the same one `packages/desktop` makes between `KabmoDesktop` and
 * `kabmo-desktop`, and it exists for the same reason: a rule that can only be
 * checked by opening a window is a rule that is not checked.
 */

/// The app's name, as every surface a user can see it states it.
///
/// One constant, because four independent things have to agree and each fails
/// silently on its own: the `--version` line, the process name, `WM_CLASS` (what
/// the window manager labels the taskbar entry) and the launcher entry's `Name=`.
/// `release/linux.test.js` asserts them together against this value.
pub const APP_NAME: &str = "Kabmo";

pub mod bridge;
pub mod navigation;
pub mod palette;
pub mod persisted;
pub mod splash;
pub mod splash_view;
pub mod store;
pub mod system;
pub mod update;
pub mod update_run;
pub mod window;
pub mod wordmark;
mod wordmark_data;

pub use bridge::{bootstrap_script, parse_call, reply_script, DesktopInfo, ShellCall};
pub use palette::ShellPalette;
pub use persisted::{read_state, state_file_path, write_state};
pub use splash::{Failure, Phase, Progress};
pub use splash_view::Splash;
pub use store::{
    normalise_url, port_of, server_id_port, server_id_value, Deps, Health, PersistedState,
    ServerEntry, ServerKind, ServerStore, ServersState, ShellError, StartResult, StoredServer,
};
pub use system::{
    data_directory, detect_local_servers, free_port, probe_health, which, AlreadyServed, Launch,
    ManagedServer, StartFailure, Supervisor, SystemDeps,
};
pub use update::{
    appimage_of, arch, asset_arch, elf_matches_arch, is_newer, is_trusted_download, refusal,
    relaunch_script, staged_path, EM_AARCH64, EM_X86_64, TRUSTED_HOSTS,
};
pub use wordmark::{commands, paint, Command};
pub use window::{
    cursor_for, edge_at, is_fullscreen, make_window, open_settings, pointer_position,
    remember_press, show_about, toggle_inspector, DoubleClickAction, Geometry, DEFAULT_HEIGHT,
    DEFAULT_WIDTH, MAX_ZOOM, MIN_HEIGHT, MIN_WIDTH, MIN_ZOOM, RESIZE_BORDER_PX,
};
