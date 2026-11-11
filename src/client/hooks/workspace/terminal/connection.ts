/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Whether this session's terminal should hold a socket — and therefore a PTY.
 *
 * Mounting is NOT opening. The desktop stack keeps every built-in panel mounted
 * and hides it with CSS (`WorkspacePanels.tsx`), which is what preserves a
 * tree's expansion, a search's results and a terminal's buffer across a switch;
 * the terminal is additionally `liveWhileHidden` so it keeps reading while the
 * user looks at Files. Starting the shell on mount therefore started one for
 * every session the user merely VISITED: measured on a live server, 18 idle
 * `zsh -i -l` children of the Kabmo pid, with a burst of seven inside two
 * minutes, none of them opened by the user.
 *
 * So the shell starts on the first render where the panel is genuinely on
 * screen, and from then on the session OWNS it: `terminal.opened` is persisted
 * per session, so switching to another view, collapsing the column or reloading
 * the page reattaches instead of letting the idle reaper collect a shell the
 * user opened. `ready` gates only the WRITE — a blob that has not loaded yet
 * cannot say whether this session was already opened.
 */

export interface TerminalConnectionState {
  /** The panel is on screen AND has a workspace to open the shell in. */
  visible: boolean;
  /** The session's state blob (with `terminal.opened`) has loaded. */
  ready: boolean;
  /** The persisted `terminal.opened` of this session. */
  opened: boolean;
}

export interface TerminalConnection {
  /** Hold a socket for this session. */
  connect: boolean;
  /** This is the first opening; the caller persists it. */
  persist: boolean;
}

export function terminalConnection(state: TerminalConnectionState): TerminalConnection {
  return {
    connect: state.visible || state.opened,
    persist: state.ready && state.visible && !state.opened,
  };
}
