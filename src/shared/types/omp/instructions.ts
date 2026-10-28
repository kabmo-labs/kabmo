/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The two native user-level instruction files in the omp agent directory that
 * the Behavior panel can edit, plus the HTTP payload shapes shared by
 * `GET/POST /api/settings/behavior` and its hook.
 */

/**
 * `agents` → AGENTS.md, the user context file injected once when a session
 * starts. `rules` → RULES.md, the sticky rule whose full body rides every
 * request and is re-read at session start / `/clear` / `/new`.
 */
export type InstructionFileKind = 'agents' | 'rules';

/** Response shape of GET and POST /api/settings/behavior. */
export interface InstructionFilePayload {
  kind?: InstructionFileKind;
  /** File content; empty when the file does not exist (or holds only whitespace). */
  rules?: string;
  /** Absolute native path, or null in MOCK mode where nothing hits disk. */
  path?: string | null;
  exists?: boolean;
  isMock?: boolean;
  /** True when recognizable permission directives were mirrored into config.yml. */
  nativeSynced?: boolean;
  nativeError?: string;
  error?: string;
}

/** Outcome of a persist attempt: an error to surface, or a note about what landed. */
export interface InstructionSaveResult {
  error?: string;
  note?: string;
}
