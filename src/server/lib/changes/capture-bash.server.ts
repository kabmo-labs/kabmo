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

import path from 'node:path';
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
import { readSessionChangeLast, readSessionChangePaths } from '@/server/lib/changes/reader.server';
import { blobKey } from '@/server/lib/changes/blobs.server';
import { sessionsInCwd } from '@/server/lib/changes/sessions.server';

export interface BashCaptureHost {
  sessionId: string;
  cwd: string;
  home: string;
  readFile(absolute: string): Promise<string | null | undefined>;
  statFile(absolute: string): Promise<{ mtimeMs: number; size: number; birthtimeMs: number; isDirectory: boolean } | null>;
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
  // Paths the trace already handled; the scan must not record them again.
  const written = new Set<string>();
  for (const mutation of mutations.values()) {
    written.add(mutation.path);
    if (mutation.from) written.add(mutation.from);
    if (mutation.op === 'rename' && mutation.from) {
      const fromEntry = pending.before.get(mutation.from);
      const before = fromEntry ? fromEntry.text : null;
      const after = await host.readFile(mutation.path);
      if (before === after) {
        const info = await host.statFile(mutation.path);
        if (info && !info.isDirectory && info.mtimeMs >= pending.startedAt) {
          const created = info.birthtimeMs >= pending.startedAt;
          await host.writeChange(pending, mutation.from, created ? null : undefined, null, 'trace', { command: pending.command, exit, ...(created ? {} : { unavailableReason: 'snapshot-race' }) });
          await host.writeChange(pending, mutation.path, null, after, 'trace', { command: pending.command, exit, from: mutation.from });
        }
        continue;
      }
      // Two records, so the existing A/M/D list can render a rename.
      await host.writeChange(pending, mutation.from, before, null, 'trace', { command: pending.command, exit });
      await host.writeChange(pending, mutation.path, null, after, 'trace', { command: pending.command, exit, from: mutation.from });
      continue;
    }
    const pathEntry = pending.before.get(mutation.path);
    const before = pathEntry ? pathEntry.text : null;
    const after = await host.readFile(mutation.path);
    if (before === after) {
      // A fast command can finish before the start-frame snapshot reads the
      // file. The mtime proves the command touched it; the birth time says
      // whether it created the file (A) or rewrote an existing one (M).
      const info = await host.statFile(mutation.path);
      // A `cp x bin/` target is a directory, not a file. Its content is
      // unreadable on both sides, and the mtime says "touched" — journaling it
      // would list a bogus delete of `bin` with an unknown before.
      if (info && !info.isDirectory && info.mtimeMs >= pending.startedAt) {
        const created = info.birthtimeMs >= pending.startedAt;
        await host.writeChange(
          pending,
          mutation.path,
          created ? null : undefined,
          after,
          'trace',
          created ? { command: pending.command, exit } : { command: pending.command, exit, unavailableReason: 'snapshot-race' },
        );
      }
      continue;
    }
    await host.writeChange(pending, mutation.path, before, after, 'trace', { command: pending.command, exit });
  }

  if (pending.scan) await reconcileScan(pending, pending.scan, host, written);
  if (plan.opaque) await host.note(pending, 'opaque-command', pending.command);
}

/** Journal the delta an opaque command made, from the two git snapshots. */
async function reconcileScan(
  pending: PendingCall,
  start: GitScan,
  host: BashCaptureHost,
  skip: Set<string>,
): Promise<void> {
  const after = await host.takeScan(host.cwd);
  if (!after) return;
  if (start.truncated || after.truncated) await host.note(pending, 'scan-budget', pending.command);

  // A concurrent session in the same cwd may have written a path the scan
  // sees. Its own journal is the exact record; skip what it already claimed.
  const from = pending.startedAt - 1000;
  const to = Date.now() + 1000;
  const claimed = new Set<string>();
  for (const sessionId of await sessionsInCwd(host.cwd, host.sessionId)) {
    for (const path of await readSessionChangePaths(sessionId, from, to)) claimed.add(path);
  }

  // A nested repo's clean file must read HEAD from ITS repo, not the parent's.
  const rootFor = (absolute: string): string => {
    let best = start.root;
    let bestLength = -1;
    for (const [prefix, root] of start.roots ?? []) {
      if ((absolute === prefix || absolute.startsWith(prefix + path.sep)) && prefix.length > bestLength) {
        best = root;
        bestLength = prefix.length;
      }
    }
    return best;
  };

  const paths = new Set([...start.dirty.keys(), ...after.dirty.keys()]);
  for (const absolute of paths) {
    if (skip.has(absolute)) continue;
    if (claimed.has(absolute)) continue;
    const before = start.dirty.has(absolute)
      ? start.dirty.get(absolute) ?? null
      : await host.readHead(rootFor(absolute), absolute);
    const afterText = after.dirty.has(absolute)
      ? after.dirty.get(absolute) ?? null
      : await host.readFile(absolute);
    if (before === afterText) {
      // A fast command can create the file before the start scan reads the
      // directory, so both snapshots hold the after content. The birth time
      // still proves the command created it.
      const info = await host.statFile(absolute);
      if (info && info.birthtimeMs >= pending.startedAt) {
        await host.writeChange(pending, absolute, null, afterText, 'scan');
      }
      continue;
    }
    // A later opaque command's scan sees files an earlier call already
    // recorded. Same content means no new change; skip the duplicate.
    const last = await readSessionChangeLast(host.sessionId, absolute);
    const afterKey = afterText === null || afterText === undefined ? afterText : blobKey(afterText);
    if (last && last.after === afterKey) continue;
    await host.writeChange(pending, absolute, before, afterText, 'scan');
  }
}
