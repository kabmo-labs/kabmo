/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Read/write of the two native instruction files omp loads from the user agent
 * dir (~/.omp/agent):
 *
 * - `AGENTS.md` — user context file, injected once into the opening project
 *   prompt; it shadows every other user-level context file.
 * - `RULES.md` — user sticky rule, re-sent in full on every request and
 *   re-read when a session starts or after `/clear` and `/new`.
 *
 * Writes are atomic (temp + rename) so a crash never truncates the file, and
 * the agent dir follows PI_CODING_AGENT_DIR through getAgentDir().
 */

import fs from 'fs';
import { join } from 'path';
import { getAgentDir } from '@/server/lib/omp/core/paths';
import { writeFileAtomic } from '@/server/lib/fs/atomic-write';
import type { InstructionFileKind } from '@/shared/types';

/** Basenames omp recognises; the provider reads these exact names. */
const FILE_NAMES: Record<InstructionFileKind, string> = {
  agents: 'AGENTS.md',
  rules: 'RULES.md',
};

/** Refuse to buffer an absurd instruction file rather than reading it whole. */
const MAX_INSTRUCTION_BYTES = 1024 * 1024;

export interface InstructionFile {
  kind: InstructionFileKind;
  path: string;
  content: string;
  exists: boolean;
}

/** Narrows an untrusted request value to a file this module can read or write. */
export function isInstructionFileKind(value: unknown): value is InstructionFileKind {
  return value === 'agents' || value === 'rules';
}

/** Absolute path of one native instruction file in the user agent dir. */
export function getInstructionFilePath(kind: InstructionFileKind): string {
  return join(getAgentDir(), FILE_NAMES[kind]);
}

/** Reads one instruction file. A missing file is a state, not an error. */
export async function readInstructionFile(kind: InstructionFileKind): Promise<InstructionFile> {
  const path = getInstructionFilePath(kind);
  const file = Bun.file(path);
  if (!(await file.exists())) return { kind, path, content: '', exists: false };
  const stat = await file.stat();
  if (stat.isDirectory()) throw new Error(`${path} is a directory, not a file`);
  if (stat.size > MAX_INSTRUCTION_BYTES) throw new Error(`${path} is larger than ${MAX_INSTRUCTION_BYTES} bytes`);
  return { kind, path, content: await file.text(), exists: true };
}

/**
 * Writes one instruction file atomically, creating the agent dir when it does
 * not exist yet. Whitespace-only content removes the file instead of leaving
 * an empty one behind: omp reads nothing from an empty instruction file, so
 * absence is the honest state — and an empty AGENTS.md would still claim the
 * user context scope that another tool's file could otherwise fill.
 */
export async function saveInstructionFile(kind: InstructionFileKind, content: string): Promise<InstructionFile> {
  const path = getInstructionFilePath(kind);
  if (!content.trim()) return clearInstructionFile(kind);
  await writeFileAtomic(path, content);
  return { kind, path, content, exists: true };
}

/** Removes one instruction file and reports the resulting empty state. */
export async function clearInstructionFile(kind: InstructionFileKind): Promise<InstructionFile> {
  const path = getInstructionFilePath(kind);
  await fs.promises.unlink(path).catch(() => {});
  return { kind, path, content: '', exists: false };
}
