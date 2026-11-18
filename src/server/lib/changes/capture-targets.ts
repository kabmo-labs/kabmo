/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The paths one tool call can touch, read from its `args`.
 *
 * A file tool names its path outright — `filePath` is the ACP/opencode
 * spelling, `path`/`file_path` the omp and Claude ones, and a tool whose args
 * use none of them is a note. `apply_patch` names its paths only inside the
 * patch text, so the headers are read. A `bash` call instead takes the paths its
 * classification found, plus the source side of a move, which is what makes the
 * before-snapshot cover a redirect or an `mv` the trace does not model.
 */

import path from 'node:path';
import type { PendingCall } from '@/server/lib/changes/capture-types';
import { patchPaths } from '@/server/lib/changes/patch-paths';

/** Every absolute path the call could read or write, before it runs. */
export function captureTargets(pending: PendingCall, cwd: string): string[] {
  if (pending.tool === 'bash') {
    const paths: string[] = [];
    for (const mutation of pending.plan?.mutations ?? []) {
      paths.push(mutation.path);
      if (mutation.from) paths.push(mutation.from);
    }
    return paths;
  }
  const args = pending.args;
  const raw: unknown[] = [args.path, args.file_path, args.filePath, args.moveTo, args.destination];
  if (Array.isArray(args.paths)) raw.push(...args.paths);
  if (Array.isArray(args.files)) raw.push(...args.files);
  const patch = typeof args.patch === 'string'
    ? args.patch
    : typeof args.patchText === 'string'
      ? args.patchText
      : typeof args.input === 'string'
        ? args.input
        : '';
  if (patch) raw.push(...patchPaths(patch));
  const paths: string[] = [];
  for (const value of raw) {
    // A URL is not a path; a bare `://` inside a Windows path is not either,
    // which is why this looks for the scheme separator rather than `:`.
    if (typeof value !== 'string' || !value || value.includes('://')) continue;
    paths.push(path.isAbsolute(value) ? path.normalize(value) : path.resolve(cwd, value));
  }
  return paths;
}
