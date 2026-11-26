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
 * `patch` — and the same gap exists on every other adapter that names its tools
 * in its own vocabulary: kimi (`ReadFile`, `StrReplaceFile`, `SetTodoList`),
 * antigravity (`view_file`, `write_to_file`, `replace_file_content`), grok
 * (`run_terminal_command`, `search_replace`), dsh (`str_replace_editor`,
 * `run_code`), hermes (`delegate_task`, `execute_code`, `search_files`),
 * command-code (`shell_command`, `read_directory`).
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
  // agents (`qwen`, `agy`) report `run_shell_command`; grok reports
  // `run_terminal_command`/`run_terminal_cmd`; command-code reports
  // `shell_command`; codex's `write_stdin` is the interactive half of the same
  // exec slot.
  powershell: 'bash',
  exec_command: 'bash',
  run_shell_command: 'bash',
  run_terminal_command: 'bash',
  run_terminal_cmd: 'bash',
  shell_command: 'bash',
  write_stdin: 'bash',
  // A plan update from opencode is `todowrite`, from codex `update_plan`;
  // Kabmo's panel key is `todo`. kimi spells it `SetTodoList`/`TodoList`.
  todowrite: 'todo',
  todo_write: 'todo',
  update_plan: 'todo',
  settodolist: 'todo',
  todolist: 'todo',
  // Fetching one URL and searching the web share Kabmo's web_search panel,
  // which falls back to the output text for a single page.
  webfetch: 'web_search',
  websearch: 'web_search',
  web_fetch: 'web_search',
  google_web_search: 'web_search',
  fetchurl: 'web_search',
  read_url_content: 'web_search',
  search_web: 'web_search',
  web_extract: 'web_search',
  // Child-agent calls: opencode `subagent`, claude-code-acp `Agent`/`Task`,
  // hermes `delegate_task`. Kabmo's delegation panel is `task` (its
  // `acpDelegationRow` reads description/prompt/agent).
  subagent: 'task',
  agent: 'task',
  delegate_task: 'task',
  // The codex/Claude patch tool, opencode's `patch` plugin, gemini's
  // `replace`, antigravity's `*_file_content` pair, grok's
  // `search_replace`/`hashline_edit`, and kimi's `StrReplaceFile` are edits.
  apply_patch: 'edit',
  patch: 'edit',
  replace: 'edit',
  str_replace_editor: 'edit',
  strreplacefile: 'edit',
  search_replace: 'edit',
  hashline_edit: 'edit',
  replace_file_content: 'edit',
  multi_replace_file_content: 'edit',
  notebook_edit: 'edit',
  // qwen spells it with the underscore, claude's adapter without.
  notebookedit: 'edit',
  // Gemini-family file tools name the operation in a different word. kimi
  // capitalises its own (`ReadFile`, `WriteFile`), and the table is keyed
  // case-insensitively.
  write_file: 'write',
  writefile: 'write',
  write_to_file: 'write',
  list_directory: 'read',
  list_dir: 'read',
  read_directory: 'read',
  read_many_files: 'read',
  readfile: 'read',
  readmediafile: 'read',
  view_file: 'read',
  search_file_content: 'grep',
  grep_search: 'grep',
  search_files: 'grep',
  find_by_name: 'grep',
  view_image: 'read',
  // Code execution that is not a shell: opencode's Code Mode `execute`, dsh's
  // `run_code`, hermes' `execute_code`. Kabmo's `eval` panel draws the script.
  execute: 'eval',
  run_code: 'eval',
  execute_code: 'eval',
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
