/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which coding-agent harness runs a session.
 *
 * This is a SPAWN-time property, not a per-row cosmetic: it decides which
 * transport carries the frames, which capabilities exist (todos, usage,
 * subagents), and which launch command is spawned. That is why it is an ID in
 * the shared graph rather than a display string — the sidebar badge, the
 * capability gate and the server driver all read the same value.
 *
 * `omp-rpc` and `omp-acp` are two entries for the SAME product: omp over its
 * native RPC mode (the existing path, only one with todos/subagents/host tools)
 * and omp over Agent Client Protocol (the adapter every other harness uses).
 * A user picking between them is picking a surface, not a different agent, so
 * they share a glyph and are told apart by name.
 *
 * There is ONE `opencode` entry. The `opencode2` preview used to be a separate
 * binary with its own beta line; it is now a 47-byte shim that `exec`s
 * `opencode` — measured on this machine: both report `v2.2.5`, and the shim's
 * own body is `exec "$(dirname "$0")/opencode" "$@"`. A second catalog entry for
 * the same binary would offer two tabs that run one program.
 */
export type HarnessId =
  | 'omp-rpc'
  | 'omp-acp'
  | 'claude'
  | 'codex'
  | 'opencode'
  /** Command Code's own agent (`cmd acp`). */
  | 'command-code'
  | 'dsh'
  /** Google's agent over its own ACP server (`agy acp`). Replaced `gemini`:
   *  Gemini CLI is deprecated in favour of Antigravity CLI, and the two are the
   *  same product line's successor/ancestor, not two agents worth listing. */
  | 'antigravity'
  | 'minimax'
  | 'pi'
  | 'qwen'
  | 'kimi'
  | 'cursor'
  /** Z.ai's own agent, over the community ACP bridge that drives its headless
   *  `zcode app-server`. The CLI ships no native ACP server (measured against
   *  the 3.17.x source: no `acp` subcommand), so the launch line names that
   *  bridge and the bridge finds the CLI by itself. */
  | 'zcode';

/** Every harness this build knows how to launch or display. */
export const HARNESS_IDS: readonly HarnessId[] = [
  'omp-rpc',
  'omp-acp',
  'claude',
  'codex',
  'opencode',
  'command-code',
  'dsh',
  'antigravity',
  'minimax',
  'pi',
  'qwen',
  'kimi',
  'cursor',
  'zcode',
];

export interface HarnessDescriptor {
  id: HarnessId;
  /** Name a human reads (`omp`, `deepseek-harness`). */
  label: string;
  /** One letter, for a row that has no room for a glyph (the sidebar's badge
   *  fallback and the tab strip). Never a substitute for the icon. */
  initial: string;
  transport: 'rpc' | 'acp';
  /**
   * Icon key in the client's harness-glyph table. Data rather than an imported
   * component because this module is imported by the server too (it builds the
   * sidebar payload), and `lucide-preact` belongs to the browser bundle.
   */
  glyph: HarnessGlyph;
  /**
   * True for a transport Kabmo itself provides, which is therefore not a
   * choice. `omp` over RPC is the default every discovered session already
   * runs on: it cannot be installed, cannot be probed (there is no agent to
   * spawn), and listing it under Settings → Harnesses offered a card whose
   * "Check status" could only answer "no launch command is configured".
   *
   * It stays in the CATALOG because a session row must still say which
   * transport ran it, and it stays in the composer's tab strip because that
   * strip names the list on screen — the default included.
   */
  builtIn?: true;
}

/**
 * The brand mark a harness draws, as a key into the client's glyph table.
 *
 * The harness's OWN logo, not a generic icon: a session row, a tab and a model
 * row all identify which agent produced the work, and a lucide shape for
 * "claude" is a guess where the vendor publishes a mark. Kept as a string union
 * so a typo is a build error instead of a silently blank icon.
 */
export type HarnessGlyph =
  | 'omp'
  | 'claudecode'
  | 'codex'
  | 'commandcode'
  | 'opencode'
  | 'deepseek'
  | 'pi'
  | 'kimi'
  | 'minimax'
  | 'qwen'
  | 'cursor'
  | 'antigravity'
  | 'zcode';

/**
 * The catalog. Order is the tab/legend order: omp's two surfaces first because
 * they are the default, then the adapters in the order the research measured.
 */
export const HARNESS_CATALOG: Readonly<Record<HarnessId, HarnessDescriptor>> = {
  'omp-rpc': { id: 'omp-rpc', label: 'omp', initial: 'o', transport: 'rpc', glyph: 'omp', builtIn: true },
  'omp-acp': { id: 'omp-acp', label: 'omp (ACP)', initial: 'o', transport: 'acp', glyph: 'omp' },
  claude: { id: 'claude', label: 'claude', initial: 'A', transport: 'acp', glyph: 'claudecode' },
  codex: { id: 'codex', label: 'codex', initial: 'C', transport: 'acp', glyph: 'codex' },
  opencode: { id: 'opencode', label: 'opencode', initial: 'O', transport: 'acp', glyph: 'opencode' },
  // Command Code's own agent. `cmd` is the bin name npm installs (plus `cmdc`
  // on Windows and the long `command-code` / `commandcode` aliases).
  'command-code': { id: 'command-code', label: 'command-code', initial: 'C', transport: 'acp', glyph: 'commandcode' },
  dsh: { id: 'dsh', label: 'deepseek-harness', initial: 'D', transport: 'acp', glyph: 'deepseek' },
  antigravity: { id: 'antigravity', label: 'antigravity', initial: 'A', transport: 'acp', glyph: 'antigravity' },
  minimax: { id: 'minimax', label: 'minimax', initial: 'M', transport: 'acp', glyph: 'minimax' },
  pi: { id: 'pi', label: 'pi', initial: 'p', transport: 'acp', glyph: 'pi' },
  qwen: { id: 'qwen', label: 'qwen', initial: 'Q', transport: 'acp', glyph: 'qwen' },
  kimi: { id: 'kimi', label: 'kimi', initial: 'K', transport: 'acp', glyph: 'kimi' },
  cursor: { id: 'cursor', label: 'cursor', initial: '⌖', transport: 'acp', glyph: 'cursor' },
  zcode: { id: 'zcode', label: 'zcode', initial: 'Z', transport: 'acp', glyph: 'zcode' },
};

/**
 * The harness every omp-session-file row runs on.
 *
 * Kabmo's sidebar discovers sessions by scanning omp's own JSONL store, so a
 * discovered row is by definition an omp session — and the path that resumes it
 * is RPC. Named rather than inlined so the day a second scanner exists, the
 * default is changed in one place.
 */
export const DEFAULT_HARNESS_ID: HarnessId = 'omp-rpc';

/** The descriptor for an id, or undefined for a value this build does not know
 *  (a newer adapter's id arriving over the wire). */
export function harnessDescriptor(id: string | null | undefined): HarnessDescriptor | undefined {
  if (!id) return undefined;
  return (HARNESS_CATALOG as Record<string, HarnessDescriptor | undefined>)[id];
}

/**
 * The row's badge text: the label, with omp's two surfaces told apart.
 *
 * `omp` alone would make `omp-rpc` and `omp-acp` indistinguishable in a row
 * that shows only one glyph — they share the glyph by design, so the word is
 * what carries the difference.
 */
export function harnessBadgeLabel(id: string | null | undefined): string {
  return harnessDescriptor(id)?.label ?? 'unknown harness';
}
