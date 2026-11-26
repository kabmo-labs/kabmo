/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The renderer family a tool call belongs to — the SERVER's classification.
 *
 * Kept in its own module because `chat.ts` is at the repo's per-file ceiling,
 * and because this is the one type a producer writes and every renderer reads:
 * `resolveToolRender` decides it once at ingress, and a client must never
 * derive it again from a name, a title or a transport kind.
 */

/**
 * The renderer family a tool call belongs to. This is a SERVER-computed fact:
 * `resolveToolRender` decides it once at ingress (ACP blocks, omp frames, a
 * stored transcript) and every client consumes it verbatim. A client must not
 * derive it from `name`/`title`/`kind`/`type` again — that is how one logical
 * shell call drew a Bash card on one harness and a generic body on another.
 */
export type ToolRenderKey =
  | 'read' | 'edit' | 'write' | 'bash' | 'eval' | 'grep' | 'search_fs'
  | 'todo' | 'task' | 'web_search' | 'lsp' | 'ast_edit' | 'resolve'
  | 'reject' | 'proc' | 'github' | 'checkpoint' | 'security_scan' | 'debug'
  | 'manage_skill' | 'context_notes' | 'memory_edit' | 'goal' | 'ask'
  | 'think' | 'mcp' | 'wait'
  /** No panel: the body is the JSON fallback. */
  | 'custom';

export interface ToolRender {
  key: ToolRenderKey;
  /** False when the producer could not classify the call. The body then shows
   *  the call as JSON instead of guessing a panel. */
  normalized: boolean;
}

