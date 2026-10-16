/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The run record, and what the registry needs from its host.
 *
 * A separate module from the registry so the registry reads as behaviour rather
 * than as a type declaration, and so `runner.test.ts` can build a record without
 * importing the class under test.
 */

import type { RunnerState, RunStatus } from '../protocol';
import type { ByteRing } from './ring';

/** One run, as the registry holds it in memory. */
export interface Run {
  id: string;
  sessionId: string | null;
  /** `${root}\0${repo}` — the scope this run belongs to. */
  scopeKey: string;
  /** The command this run started (`<file>#<kind>:<name>`). */
  commandId: string;
  /** Repo-relative path of the command file. */
  file: string;
  /** Absolute directory the command runs in. */
  cwd: string;
  argv: string[];
  /** What the user clicked, e.g. `make build`. */
  label: string;
  background: boolean;
  proc: Bun.Subprocess | null;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  exitCode: number | null;
  signal: string | null;
  /** Total bytes produced, whether or not the ring still holds them. */
  bytes: number;
  ring: ByteRing;
  /** The last time this run's growth was published. */
  lastPublishAt: number;
  /** A pending coalesced publish, so a burst is one frame. */
  publishTimer: ReturnType<typeof setTimeout> | null;
  error?: string;
}

/** What the registry needs from its host, injected so a test drives it directly. */
export interface RunnerDeps {
  /** Publish the current state on the plugin's topic. */
  publish(state: RunnerState): void;
  /** Log a line, for a spawn failure the user never sees otherwise. */
  log(message: string, detail?: unknown): void;
  /** Read a plugin setting. */
  setting<T extends string | number | boolean>(key: string): Promise<T | undefined>;
}
