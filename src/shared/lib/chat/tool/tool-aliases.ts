/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Tool names an ACP agent reports in its OWN vocabulary, folded onto the key
 * Kabmo's renderers already know.
 *
 * The ACP spec names a tool by `kind` (ten values) plus an adapter-chosen
 * `name`. The `kind` picks the broad renderer, but every panel lookup reads the
 * NAME first — so an agent that calls its shell `shell` (opencode) or its plan
 * writer `todowrite` opened no panel at all: the card fell back to the generic
 * Input/Output body while a `bash`/`todo` card was one lookup away. Measured on
 * opencode 2.2.5: `shell`, `todowrite`, `webfetch`, `websearch`, `subagent`,
 * `patch`.
 *
 * This is the SINGLE table for that vocabulary. It is applied by the SERVER's
 * one resolver (`shared/lib/chat/tool/render-key.ts`) at ingress and on every
 * stored transcript read, so a live row and a replayed row classify the same
 * and no client derives a panel from a name.
 *
 * It deliberately does NOT restate Kabmo's own legacy aliases (`read_file`,
 * `terminal`, …): those live with the panels/phrases that own them.
 */
export const AGENT_TOOL_ALIASES: Readonly<Record<string, string>> = {
  // opencode 2.x names its tools after the plugin: `opencode.tool.shell` is
  // reported as `shell`, and the bash renderer key is `bash`.
  shell: 'bash',
  // The same slot across adapters: claude-code-acp reports `Bash` (already the
  // key) or `PowerShell`; codex-acp reports `exec_command`; gemini-family
  // agents (`qwen`, `agy`) report `run_shell_command`.
  powershell: 'bash',
  exec_command: 'bash',
  run_shell_command: 'bash',
  // A plan update from opencode is `todowrite`, from codex `update_plan`;
  // Kabmo's panel key is `todo`.
  todowrite: 'todo',
  todo_write: 'todo',
  update_plan: 'todo',
  // Fetching one URL and searching the web share Kabmo's web_search panel,
  // which falls back to the output text for a single page.
  webfetch: 'web_search',
  websearch: 'web_search',
  web_fetch: 'web_search',
  google_web_search: 'web_search',
  // Child-agent calls: opencode `subagent`, claude-code-acp `Agent`/`Task`.
  // Kabmo's delegation panel is `task` (its `acpDelegationRow` reads
  // description/prompt/agent).
  subagent: 'task',
  agent: 'task',
  // The codex/Claude patch tool, opencode's `patch` plugin, and gemini's
  // `replace` are edits.
  apply_patch: 'edit',
  patch: 'edit',
  replace: 'edit',
  // Gemini-family file tools name the operation in a different word.
  write_file: 'write',
  list_directory: 'read',
  read_many_files: 'read',
  search_file_content: 'grep',
  view_image: 'read',
};

/**
 * The canonical key for an agent-reported tool name, or the name unchanged
 * when this table has no row for it.
 *
 * Case is preserved for unknown names: an MCP tool (`mcp__server_tool`) is a
 * real identifier, not display text, and lowercasing it would stop matching
 * the server it names.
 */
export function canonicalAgentToolName(name: string | undefined): string {
  if (!name) return '';
  return AGENT_TOOL_ALIASES[name.toLowerCase()] ?? name;
}
