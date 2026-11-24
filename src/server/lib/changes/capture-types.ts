/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shapes the capture layer shares across its files.
 *
 * `PendingCall` is one tool call between its start and end frame: the args, the
 * before snapshot, and (for `bash`) the plan and the git scan. It lives here so
 * the bash half can read it without importing the class that owns it.
 */

import type { CommandPlan } from '@/server/lib/changes/classify-command';
import type { ChangeJournal } from '@/server/lib/changes/journal.server';
import type { GitScan } from '@/server/lib/changes/scan.server';

export interface PendingCall {
  toolCallId: string;
  /** The run that opened this call; captured at start so a late end keeps it. */
  runId?: string;
  runAt?: number;
  tool: string;
  agent: string;
  parent?: string;
  startedAt: number;
  args: Record<string, unknown>;
  before: Map<string, { text: string | null | undefined; mtimeMs?: number }>;
  plan?: CommandPlan;
  command?: string;
  scan?: GitScan | null;
  ready: Promise<void>;
}

export interface TraceNode {
  k?: string;
  argv?: unknown;
}

export interface ShellTrace {
  status?: number;
  units?: { nodes?: TraceNode[] }[];
}

export type ChangeSource = 'tool' | 'trace' | 'scan';

export interface ChangeExtra {
  command?: string;
  exit?: number;
  from?: string;
  /** Why a side is `undefined`; the journal writes the matching note. */
  unavailableReason?: 'too-large' | 'snapshot-race';
}

export interface CaptureDeps {
  journal: ChangeJournal;
  cwd: string;
  home: string;
  readFile?: (absolute: string) => Promise<string | null>;
  statFile?: (absolute: string) => Promise<{ mtimeMs: number; size: number; birthtimeMs: number; isDirectory: boolean } | null>;
  /** The git snapshot seam; tests inject a fake, production uses `scan.server`. */
  takeScan?: (cwd: string) => Promise<GitScan | null>;
  readHead?: (root: string, absolute: string) => Promise<string | null>;
}
