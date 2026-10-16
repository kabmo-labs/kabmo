/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * What the two halves of this plugin say to each other.
 *
 * The panel and the runner are separate bundles in separate realms (a browser
 * and the chamber's own process), so every shape here crosses a wire. Two rules
 * follow from that and both are load-bearing:
 *
 * - **The panel never names a command line.** A run is started by COMMAND ID,
 *   which the server re-resolves against its own scan to build the argv. A
 *   client-supplied string would make the RPC surface a remote-command-execution
 *   endpoint reachable by anything holding the session cookie.
 * - **A log read returns a TAIL, and says what it left out.** `bytes` is the
 *   total the process produced and `ringBytes` how much the buffer still holds,
 *   so the view can say "the last 64 KB of 3.1 MB" rather than presenting a
 *   window as the whole log.
 */

/**
 * One command source.
 *
 * Each name is a toolchain, not a file: `python` covers `pyproject.toml`'s four
 * task tables, and `compose` covers the four Compose filenames. `custom` is a
 * command the USER added, which is why it has no file behind it and why its argv
 * comes from stored text rather than from a parsed declaration.
 *
 * The kind is what the group is ORDERED by and what the panel groups its
 * vocabulary around; the argv is the detector's own (see `detectors/types.ts`).
 */
export type CommandKind =
  | 'package'
  | 'deno'
  | 'make'
  | 'just'
  | 'task'
  | 'python'
  | 'pipenv'
  | 'django'
  | 'compose'
  | 'go'
  | 'rust'
  | 'php'
  | 'java'
  | 'elixir'
  | 'custom';

/** One runnable command inside a file. */
export interface Command {
  /** `<file>#<kind>:<name>` — what `start` takes, never a command line. */
  id: string;
  /** What the user clicked, e.g. `build`. */
  name: string;
  /** The argv the row implies, for display: `make build`, `bun run dev`. */
  label: string;
  /**
   * What this row RUNS, built by the detector that found it.
   *
   * Carried on the row so the server can start it without a second lookup, and so
   * the label is provably the argv joined (`detectors/types.ts`). A command from
   * a FILE still re-resolves against a fresh scan before it starts, because the
   * file may have changed since the listing; this is what the fresh scan rebuilds.
   */
  argv: string[];
  /**
   * The stored command this row came from, for a `custom` kind.
   *
   * Carried so the panel can offer Edit/Delete on exactly the row it drew — the
   * id is derived from the scope and the slug, and re-deriving it in the panel
   * would be a second implementation of the same rule.
   */
  custom?: CustomCommand;
}

/** One command FILE, with the commands it declares. */
export interface CommandGroup {
  /** Repo-relative path of the file (`packages/api/package.json`). */
  file: string;
  /** Repo-relative directory the commands run in. */
  cwd: string;
  kind: CommandKind;
  /** The package runner resolved for a `package` group (`bun`, `npm`, …). */
  runner?: string;
  commands: Command[];
  /** The file could not be read or parsed; the group is listed with the reason. */
  error?: string;
  /**
   * The group is the user's own commands, not a file.
   *
   * Set rather than inferred from `kind === 'custom'` because the panel keys
   * several things off it — the Edit/Delete affordances, the Add button that
   * belongs only here, and the fact that the group header is not a path.
   */
  customGroup?: boolean;
}

/** The scan's answer. */
export interface CommandListing {
  groups: CommandGroup[];
  /** The walk hit its file or depth cap, so the list is a prefix. */
  truncated: boolean;
  /**
   * Every filename the detector table claims, for the panel's "looked for" note.
   *
   * Carried on the payload rather than imported by the panel: the table reads
   * TOML and YAML through Bun's own parsers, so it is server-only code and a
   * client bundle cannot reach it. A hardcoded list in the panel is what this
   * replaces — it named four files while the table claimed twenty.
   */
  sources: string[];
}

export type RunStatus = 'running' | 'exited' | 'stopped' | 'failed';

/**
 * Where a user's own command lives.
 *
 * `global` applies in every repository; `repo` only under the root it was
 * created for. The distinction is the whole point of offering both: a lint
 * wrapper is the same command everywhere, while `deploy staging` names a
 * directory that exists in one checkout.
 */
export type CustomScope = 'global' | 'repo';

/** A command the USER added, as stored. */
export interface CustomCommand {
  /** Stable id, derived from the scope and the slug — never a row id. */
  id: string;
  /** What the user typed, e.g. `deploy staging`. */
  command: string;
  /** `global` in every repository, or `repo` under `root` only. */
  scope: CustomScope;
  /**
   * The workspace root a `repo` command belongs to, or null for a global one.
   *
   * Recorded so a `repo` entry can be resolved without the caller re-deriving
   * which root it was created under — the panel and the runner both need it.
   */
  root: string | null;
  /**
   * The directory the command runs in, RELATIVE to the scope root (`.` for the
   * root itself).
   *
   * Stored rather than inferred: a user who adds a command while browsing
   * `packages/api` means THAT directory, and a `package.json` script in a
   * monorepo only resolves when the cwd is its own.
   */
  cwd: string;
  createdAt: number;
}

/** What `custom-list` answers. */
export interface CustomListing {
  /** Every stored command, global ones first. */
  commands: CustomCommand[];
}

/** One run, as the realtime topic publishes it. */
export interface RunSummary {
  id: string;
  sessionId: string | null;
  /** `${root}\0${repo}` — the scope the run belongs to. */
  scopeKey: string;
  /**
   * The COMMAND this run started (`<file>#<kind>:<name>`).
   *
   * Load-bearing for the per-command rows: a command's output lives in ITS row's
   * expansion, so the row has to find its own latest run. Matching on `file` and
   * `label` instead would collide for two commands of the same name in one file
   * and for the same label in two files.
   */
  commandId: string;
  /** Repo-relative path of the command file. */
  file: string;
  /** What was clicked, e.g. `make build`. */
  label: string;
  background: boolean;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  /** Total bytes the process produced, whether or not the ring still holds them. */
  bytes: number;
  /** Bytes the ring currently holds. */
  ringBytes: number;
  error?: string;
}

/** The plugin's own topic payload. */
export interface RunnerState {
  /** `${root}\0${repo}` of the most recent run, or null with none. */
  scopeKey: string | null;
  runs: RunSummary[];
}

/** One log read. */
export interface RunLog {
  id: string;
  status: RunStatus;
  exitCode: number | null;
  signal: string | null;
  bytes: number;
  ringBytes: number;
  /** The ring dropped output (`bytes > ringBytes`). */
  truncated: boolean;
  /** The last `tail` bytes, ANSI-stripped. */
  text: string;
}

/** What a refused call answers with, so a row can say why. */
export interface RunnerError {
  error: string;
}

/** The RPC method names, in one place so neither half spells them twice. */
export const RPC = {
  list: 'list',
  start: 'start',
  stop: 'stop',
  stopOthers: 'stop-others',
  /**
   * Stop EVERY run in scope, whatever its state.
   *
   * Distinct from `stop-others`, which is a repo-switch sweep and spares the
   * current scope. This one is the per-command `Disable` and the panel's own
   * "stop everything" — both mean "nothing of mine may keep running", so the
   * scope it spares is none.
   */
  stopAll: 'stop-all',
  /**
   * The user's own commands. One CRUD surface rather than five verbs, because
   * the panel renders the list and every mutation answers with the whole one —
   * a partial update would leave the client assembling state the server owns.
   */
  customList: 'custom-list',
  customSave: 'custom-save',
  customRemove: 'custom-remove',
} as const;
