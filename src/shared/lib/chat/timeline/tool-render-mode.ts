/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * How a tool call is drawn in the chat transcript, as ONE of four modes.
 *
 * This is a READING style, not a capability: every mode renders the same call,
 * the same facts and the same body — only the frame, the density and the
 * grouping change. No mode hides information, and the collapsed form always
 * states the outcome (the rule `ToolCardShell` was built around).
 *
 *  - `card`    — the bordered, collapsible card Kabmo has always shipped.
 *  - `compact` — one status line per call, facts inline, body inset on demand.
 *  - `trace`   — a vertical rail per section, one node per call.
 *  - `minimal` — a faint line per call, read as part of the answer.
 *
 * **The mode NAMES and the copy live here**; the markup lives in
 * `tool-renderers/styles/`. A mode added here without a renderer is a build
 * error at the switch in `ToolCallingSection`, not a silent fallback.
 */

export type ToolRenderMode = 'card' | 'compact' | 'trace' | 'minimal';

/**
 * The mode a document with no stored preference renders at. It is the value
 * Kabmo shipped before the setting existed, so an upgrade changes nothing.
 */
export const DEFAULT_TOOL_RENDER_MODE: ToolRenderMode = 'card';

/** Every mode, in the order the settings control lists them: fullest first. */
export const TOOL_RENDER_MODES = ['card', 'compact', 'trace', 'minimal'] as const;

/** A stored value written by another build is not a mode this one can draw. */
export function isToolRenderMode(value: unknown): value is ToolRenderMode {
  return value === 'card' || value === 'compact' || value === 'trace' || value === 'minimal';
}

/**
 * The mode to APPLY for a stored value. Anything this build cannot draw — a
 * value from a newer build, a corrupted blob, `undefined` on a fresh install —
 * falls back to the default rather than to a renderer that does not exist.
 */
export function resolveToolRenderMode(value: unknown): ToolRenderMode {
  return isToolRenderMode(value) ? value : DEFAULT_TOOL_RENDER_MODE;
}

export interface ToolRenderModeCopy {
  /** Control label. */
  label: string;
  /** One line under the label, in the settings card. */
  description: string;
}

/** Labels for the settings control. */
export const TOOL_RENDER_MODE_COPY: Record<ToolRenderMode, ToolRenderModeCopy> = {
  card: {
    label: 'Card',
    description: 'A bordered card per call: the outcome, the facts, and a body that opens on click.',
  },
  compact: {
    label: 'Compact',
    description: 'One status line per call, with the facts inline and the body inset on demand.',
  },
  trace: {
    label: 'Trace',
    description: 'A vertical rail per section: every step on one line, expanded in place.',
  },
  minimal: {
    label: 'Minimal',
    description: 'The quietest form: a faint line per call, read as part of the answer.',
  },
};
