/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw output behind an `artifact://<id>` reference.
 *
 * When a tool result is too long to keep inline omp spills the whole stream to
 * a file beside the session and leaves a `columnTruncated.artifactId` in the
 * result's `details.meta` — measured over 5,441 real results, 1% (65) carry one,
 * and they are exactly the outputs a reader most wants whole: a `bash` build
 * log, an `eval` that printed a table, a `read` of a long file. The Kabmo
 * served none of it, so those results were truncated at 768 bytes with no way
 * to see the rest.
 *
 * The layout is omp's own, verified against a real install:
 *   <sessionsDir>/<cwd-dir>/<sessionFile>.jsonl        the transcript
 *   <sessionsDir>/<cwd-dir>/<sessionId>/<id>.<kind>.log the spilled stream
 * `kind` is the tool's own (`bash`, `bash-original`, `eval`, `read`, `async`),
 * and the id is numeric.
 *
 * Every guard here is a path boundary: the id must be digits, the kind must be
 * one of omp's own, and the resolved path must still sit inside the session's
 * directory. omp wrote these files, but the id and kind reach this module from
 * a session transcript, which is a document Kabmo reads rather than one
 * it wrote.
 */

import * as fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { findSessionFileById } from '@/server/lib/omp/session/locator';
import { siblingDirForSession } from '@/server/lib/omp/subagent/history/paths';

/** omp's own artifact kinds, from the filenames it writes. */
export const ARTIFACT_KINDS = ['bash', 'bash-original', 'eval', 'read', 'async'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** A numeric artifact id; anything else never reaches a path join. */
const ARTIFACT_ID_RE = /^\d+$/;

/** Cap on what the route will read, so a pathological log cannot be slurped whole. */
const MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;

export interface ArtifactText {
  text: string;
  /** True when the file was longer than `MAX_ARTIFACT_BYTES` and the tail was kept. */
  truncated: boolean;
  /** Total file size in bytes, so a caller can say how much was elided. */
  size: number;
  /** The kind the artifact was found under. */
  kind: ArtifactKind;
}

/** True when `kind` is one omp actually writes. */
export function isArtifactKind(kind: string): kind is ArtifactKind {
  return (ARTIFACT_KINDS as readonly string[]).includes(kind);
}

/**
 * Read one spilled tool output, or null when the session, the id or the file
 * cannot be resolved.
 *
 * The kind is probed rather than required: a caller reading a transcript sees
 * `artifactId` without the kind that produced it, and a session can hold an
 * `eval` and a `bash` artifact under the same id (they are numbered per tool).
 * The caller may pass the kind it knows; otherwise the first match in
 * `ARTIFACT_KINDS` order wins.
 */
export async function readArtifact(
  sessionId: string,
  artifactId: string,
  kind?: string,
): Promise<ArtifactText | null> {
  if (!ARTIFACT_ID_RE.test(artifactId)) return null;

  const sessionFile = await findSessionFileById(sessionId);
  if (!sessionFile) return null;
  const dir = siblingDirForSession(sessionFile);
  if (!existsSync(dir)) return null;

  const candidates = kind && isArtifactKind(kind) ? [kind] : [...ARTIFACT_KINDS];
  for (const candidate of candidates) {
    const filePath = path.join(dir, `${artifactId}.${candidate}.log`);
    // Boundary check: the id is digits and the kind is from the table, but the
    // resolved path is what actually reaches the filesystem.
    if (!filePath.startsWith(`${dir}${path.sep}`)) continue;
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;

    if (stat.size <= MAX_ARTIFACT_BYTES) {
      return { text: await fsp.readFile(filePath, 'utf8'), truncated: false, size: stat.size, kind: candidate };
    }
    // Too big to serve whole: keep the tail, which is where a log's answer is.
    const handle = await fsp.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES);
      await handle.read(buffer, 0, MAX_ARTIFACT_BYTES, stat.size - MAX_ARTIFACT_BYTES);
      return { text: buffer.toString('utf8'), truncated: true, size: stat.size, kind: candidate };
    } finally {
      await handle.close();
    }
  }
  return null;
}
