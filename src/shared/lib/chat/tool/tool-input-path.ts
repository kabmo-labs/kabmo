/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The key a tool call names its file under.
 *
 * Every adapter spells it differently: omp and opencode send `path`,
 * claude-code-acp and the gemini family send `file_path`, omp's legacy tool
 * names use `TargetFile`/`AbsolutePath`, and the MOCK path sends `filePath`.
 * Reading one spelling per renderer is what made a claude `Read` card open with
 * no file and an `Edit` card headed "File modification".
 *
 * This is the ONE list; `parseMessageBlocks` (the `target` a card carries),
 * `resolveTargetFile`, the Read/Edit panels and the ACP adapter's own target
 * all read it.
 */

/** Path keys. omp's own order is kept first — `TargetFile` outranks
 *  `filePath`, which `parse-message-blocks.test.ts` pins — and the adapter
 *  spellings that arrived later are appended after it. */
export const TOOL_PATH_KEYS: readonly string[] = [
  'path',
  'TargetFile',
  'targetFile',
  'FilePath',
  'filePath',
  'AbsolutePath',
  'absolutePath',
  'file',
  'file_path',
  'absolute_path',
  'notebook_path',
  'notebookPath',
];

/** The path a tool call's arguments name, or undefined. */
export function toolInputPath(input: unknown): string | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const bag = input as Record<string, unknown>;
  for (const key of TOOL_PATH_KEYS) {
    const value = bag[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}
