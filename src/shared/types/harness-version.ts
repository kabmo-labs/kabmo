/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One row of `GET /api/harness/versions` — the wire shape the About card reads.
 *
 * Stated ONCE, here, because the route that answers it and the hook that stores it
 * were declaring the same eight fields twice: a second copy is how a client starts
 * reading a field the server stopped sending, silently, and shows a dash forever.
 *
 * **A harness can be TWO installs.** `claude` is an npm ACP adapter over the
 * `claude` CLI: two real versions, moving independently through two different
 * mechanisms. So the row carries a `agent` part and an optional `cli` part, each
 * with its own latest version and its own `updateAvailable` — never one flattened
 * pair, which is what made "the adapter is current" read as "everything is".
 */

import type { HarnessUpdateKind } from '@/shared/lib/harness/updates';

/** One part's installed and latest version, and whether it can move. */
export interface HarnessPartRow {
  /** What is on disk, or null when it has never answered. */
  version: string | null;
  /** What its install source offers, or null when Kabmo reads no source for it. */
  latest: string | null;
  /**
   * A newer version exists for THIS part.
   *
   * False when either number is missing: a comparison needs both, and claiming
   * "up to date" about a part Kabmo never read would be a fabricated fact.
   */
  updateAvailable: boolean;
}

export interface HarnessVersionRow {
  id: string;
  label: string;
  /** `npm` — published on npm; the number IS the install target.
   *  `self` — the CLI updates itself, so Kabmo reports and does not install.
   *  `own` — a vendor installer owns it; the route refuses. */
  kind: HarnessUpdateKind | null;
  /** False when the agent is not on this machine: no version, no action. */
  installed: boolean;
  /** The ADAPTER: the version the probe reported, and its own package's latest.
   *  For a harness that is not an adapter this part IS the agent. */
  agent: HarnessPartRow;
  /** The CLI underneath an adapter: its name, its version and its own package's
   *  latest. Null when the harness is not an adapter. The binary PATH is a server
   *  fact (`forgetCliVersion` invalidates it), so it is not on the wire. */
  cli: (HarnessPartRow & { name: string }) | null;
  /** True when ANY part is behind: one press moves every part that is. */
  updateAvailable: boolean;
  /** Why a field is empty, in words — never a bare dash. */
  note: string | null;
  /** The command that updates it, for `self`, `own` and an adapter's CLI. */
  command: string | null;
}
