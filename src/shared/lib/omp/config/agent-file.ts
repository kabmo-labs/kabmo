/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The file-name rules for a native omp agent definition.
 *
 * One module because two sides enforce the same rule: the route refuses a file
 * name that is not a safe base name (path traversal, spaces, dots-only), and
 * the pane refuses the same name before it sends it — a save that travels and
 * returns a 500 for a name the form could have rejected reads as a server bug
 * rather than as a typo.
 */

/** A file base name (no extension) an agent can be written to. */
export const AGENT_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** Why a name cannot be used as an agent file, or null when it can. */
export function agentFileNameError(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'An agent needs a name — it becomes the definition’s file name.';
  if (!AGENT_FILE_NAME_PATTERN.test(trimmed)) {
    return 'Use letters, numbers, dots, dashes or underscores, starting with a letter or number.';
  }
  return null;
}

/** The base name (no `.md`) of an agent definition file path. */
export function agentFileBaseName(filePath: string): string {
  // BOTH separators, because `filePath` is whatever the host produced: a
  // Windows runner reports `C:\Users\…\agents\reviewer.md`, and splitting on
  // `/` alone returned that entire path as the "file name". The pane then sent
  // it back as `fileName`, the route wrote a file named after the full path,
  // and every later rename/delete missed the file it meant — measured on the
  // Windows gate, where `fileName` came back as
  // `C:\Users\RUNNER~1\AppData\Local\Temp\…\agents\reviewer` and three cases
  // failed. `node:path` is not usable here: this module is shared with the
  // browser, where it has no implementation.
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  const file = filePath.slice(cut + 1);
  return file.replace(/\.md$/i, '');
}
