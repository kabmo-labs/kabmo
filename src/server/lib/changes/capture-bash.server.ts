/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The `bash` half of the capture layer: what a shell command changed.
 *
 * Two sources, merged: the script text tokenized at start (which names the
 * redirects the trace does not model) and the trace's `simple` nodes at end
 * (which name the `argv` that actually ran). A rename becomes two records so
 * the existing A/M/D list can render it. An opaque command is reconciled from
 * the two git snapshots, and a command the scan could not cover is a note.
 */

import {
  classifyArgv,
  classifyCommand,
  type CommandMutation,
} from '@/server/lib/changes/classify-command';
import type {
  ChangeExtra,
  ChangeSource,
  PendingCall,
  ShellTrace,
} from '@/server/lib/changes/capture-types';
import type { GitScan } from '@/server/lib/changes/scan.server';

export interface BashCaptureHost {
  cwd: string;
  home: string;
  readFile(absolute: string): Promise<string | null | undefined>;
  takeScan(cwd: string): Promise<GitScan | null>;
  readHead(root: string, absolute: string): Promise<string | null>;
  writeChange(
    pending: PendingCall,
    absolute: string,
    before: string | null | undefined,
    after: string | null | undefined,
    source: ChangeSource,
    extra?: ChangeExtra,
  ): Promise<void>;
  note(pending: PendingCall, reason: 'opaque-command' | 'scan-budget', detail?: string): Promise<void>;
}

export async function captureBashChanges(
  pending: PendingCall,
  trace: ShellTrace | null,
  host: BashCaptureHost,
): Promise<void> {
  const plan = pending.plan ?? classifyCommand(pending.command ?? '', host.cwd, host.home);
  const mutations = new Map<string, CommandMutation>();
  const remember = (mutation: CommandMutation): void => {
    mutations.set(`${mutation.op}:${mutation.from ?? ''}:${mutation.path}`, mutation);
  };
  for (const mutation of plan.mutations) remember(mutation);
  if (trace) {
    for (const unit of trace.units ?? []) {
      for (const node of unit.nodes ?? []) {
        if (node.k !== 'simple' || !Array.isArray(node.argv) || node.argv.length === 0) continue;
        const argv = node.argv.filter((value): value is string => typeof value === 'string');
        for (const mutation of classifyArgv(argv, host.cwd, host.home).mutations) remember(mutation);
      }
    }
  }

  const exit = typeof trace?.status === 'number' ? trace.status : undefined;
  for (const mutation of mutations.values()) {
    if (mutation.op === 'rename' && mutation.from) {
      const fromEntry = pending.before.get(mutation.from);
      const before = fromEntry ? fromEntry.text : null;
      const after = await host.readFile(mutation.path);
      if (before === after) continue;
      // Two records, so the existing A/M/D list can render a rename.
      await host.writeChange(pending, mutation.from, before, null, 'trace', { command: pending.command, exit });
      await host.writeChange(pending, mutation.path, null, after, 'trace', { command: pending.command, exit, from: mutation.from });
      continue;
    }
    const pathEntry = pending.before.get(mutation.path);
    const before = pathEntry ? pathEntry.text : null;
    const after = await host.readFile(mutation.path);
    await host.writeChange(pending, mutation.path, before, after, 'trace', { command: pending.command, exit });
  }

  if (pending.scan) await reconcileScan(pending, pending.scan, host);
  if (plan.opaque) await host.note(pending, 'opaque-command', pending.command);
}

/** Journal the delta an opaque command made, from the two git snapshots. */
async function reconcileScan(pending: PendingCall, start: GitScan, host: BashCaptureHost): Promise<void> {
  const after = await host.takeScan(host.cwd);
  if (!after) return;
  if (start.truncated || after.truncated) await host.note(pending, 'scan-budget', pending.command);

  const paths = new Set([...start.dirty.keys(), ...after.dirty.keys()]);
  for (const absolute of paths) {
    const before = start.dirty.has(absolute)
      ? start.dirty.get(absolute) ?? null
      : await host.readHead(start.root, absolute);
    const afterText = after.dirty.has(absolute)
      ? after.dirty.get(absolute) ?? null
      : await host.readFile(absolute);
    if (before === afterText) continue;
    await host.writeChange(pending, absolute, before, afterText, 'scan');
  }
}
