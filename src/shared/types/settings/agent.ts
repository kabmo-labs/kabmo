/**
 * An omp agent definition.
 *
 * The field set is omp's OWN frontmatter contract (`parseAgentFields` in
 * `@oh-my-pi/pi-coding-agent`), not a shape Kabmo invented: `name`,
 * `description`, `tools`, `spawns`, `model`, `thinkingLevel`, and the body as
 * the system prompt. `mode`/`temperature`/`topP` used to be offered here and
 * were never read by omp, so three controls edited a file to no effect — they
 * are gone, and the pane no longer implies they work.
 */

export type AgentScope = 'system' | 'user' | 'project';

/** A model selector: `provider/model`, or a role selector such as `@smol`. */
export type AgentModelSelector = string;

export interface AgentItem {
  id: string;
  name: string;
  description: string;
  scope: AgentScope;
  /** Absent means omp's default tool set. */
  tools?: string[];
  /** `"*"` or a name list: which agents this one may spawn. */
  spawns?: string;
  model?: AgentModelSelector;
  /** `off` … `max`, or `auto`; absent means the session's level. */
  thinkingLevel?: string;
  systemPrompt: string;
  /** Listed but not editable: a project agent belongs to that workspace. */
  isBuiltIn?: boolean;
  /** Absolute path of the definition file omp loads; absent for a demo preset. */
  filePath?: string;
  /** Base name of that file (no `.md`), which is what a write sends. */
  fileName?: string;
  /** Which root the definition was discovered in. */
  sourceRoot?: 'user' | 'project';
}
