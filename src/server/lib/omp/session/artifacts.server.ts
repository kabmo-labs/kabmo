/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The raw output behind a spilled tool result.
 *
 * When a tool result is too long to keep inline omp spills the whole stream to
 * a file beside the session and leaves a `columnTruncated.artifactId` in the
 * result's `details.meta` — measured over 5,441 real results, 1% (65) carry one,
 * and they are exactly the outputs a reader most wants whole: a `bash` build
 * log, an `eval` that printed a table, a `read` of a long file. The Kabmo
 * served none of it, so those results were truncated at 768 bytes with no way
 * to see the rest.
 *
 * omp 19.0.0 replaced `artifact://<id>` with a `local://<id>.log` file at the
 * session's `local://` root, so the layout is now:
 *   <sessionsDir>/<cwd-dir>/<sessionFile>.jsonl        the transcript
 *   <sessionsDir>/<cwd-dir>/<sessionFile>/<id>.log     the spilled stream
 * Before 19.0.0 the file carried the tool's kind in its name
 * (`<id>.<kind>.log`), and sessions recorded then still name one, so both
 * layouts are read. The kind is no longer part of the path; a new spill is
 * reported as `spill`.
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
import { findSessionFileById } from '@kabmo-labs/kabmo-omp-session-locator';
import { siblingDirForSession } from '@kabmo-labs/kabmo-omp-subagent/history-paths';

/** omp's legacy artifact kinds, from the filenames it wrote before 19.0.0. */
export const ARTIFACT_KINDS = ['bash', 'bash-original', 'eval', 'read', 'async'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number] | 'spill';

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
  /** The kind the artifact was found under; `spill` for a 19.0.0 `local://` file. */
  kind: ArtifactKind;
}

/** True when `kind` is a legacy kind omp actually wrote into a filename. */
export function isArtifactKind(kind: string): kind is (typeof ARTIFACT_KINDS)[number] {
  return (ARTIFACT_KINDS as readonly string[]).includes(kind);
}

/** Read one file, keeping the tail when it exceeds the cap. */
async function readCapped(filePath: string, size: number, kind: ArtifactKind): Promise<ArtifactText> {
  if (size <= MAX_ARTIFACT_BYTES) {
    return { text: await fsp.readFile(filePath, 'utf8'), truncated: false, size, kind };
  }
  // Too big to serve whole: keep the tail, which is where a log's answer is.
  const handle = await fsp.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_ARTIFACT_BYTES);
    await handle.read(buffer, 0, MAX_ARTIFACT_BYTES, size - MAX_ARTIFACT_BYTES);
    return { text: buffer.toString('utf8'), truncated: true, size, kind };
  } finally {
    await handle.close();
  }
}

/**
 * Read one spilled tool output, or null when the session, the id or the file
 * cannot be resolved.
 *
 * The 19.0.0 layout is probed first: `<id>.log` at the session's `local://`
 * root. A session recorded before the pin keeps `<id>.<kind>.log`, where the
 * kind is probed rather than required — a caller reading a transcript sees
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

  const spillPath = path.join(dir, `${artifactId}.log`);
  // Boundary check: the id is digits, but the resolved path is what actually
  // reaches the filesystem.
  if (spillPath.startsWith(`${dir}${path.sep}`)) {
    const stat = await fsp.stat(spillPath).catch(() => null);
    if (stat?.isFile()) return readCapped(spillPath, stat.size, 'spill');
  }

  const candidates = kind && isArtifactKind(kind) ? [kind] : [...ARTIFACT_KINDS];
  for (const candidate of candidates) {
    const filePath = path.join(dir, `${artifactId}.${candidate}.log`);
    if (!filePath.startsWith(`${dir}${path.sep}`)) continue;
    const stat = await fsp.stat(filePath).catch(() => null);
    if (!stat?.isFile()) continue;
    return readCapped(filePath, stat.size, candidate);
  }
  return null;
}
