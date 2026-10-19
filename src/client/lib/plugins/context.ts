/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The context every plugin component is rendered with.
 *
 * A plugin component runs inside the host's tree, so it could in principle read
 * the session and workspace from the host's own hooks — but it is a published
 * package that must not import from the host's source. This module is the seam:
 * the layout PUBLISHES the current context here, the UI kit READS it through
 * `configureUiKit`, and neither end knows about the other.
 *
 * It is deliberately one module-level value rather than a Preact context: the
 * UI kit's `usePanelInfo` subscribes to it directly, and a context object would
 * have to be threaded through every surface that renders a plugin — the
 * activity bar, the panel stack, the navbar dropdown, the editor tab and the
 * settings pane — each of which would be a place to forget it.
 */

import type { PanelContext } from '@kabmo-labs/ui';
import { THEME_CHANGED_EVENT, currentThemeId } from '@/client/hooks/ui/theme';

type Listener = (context: PanelContext) => void;

let current: PanelContext = { sessionId: null, workspacePath: null, theme: 'paper' };
const listeners = new Set<Listener>();

/** The context as it stands. Cheap: every call returns the same object shape. */
export function pluginContext(): PanelContext {
  return { ...current, theme: currentThemeId() };
}

export function subscribePluginContext(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(): void {
  const next = pluginContext();
  current = next;
  for (const listener of listeners) listener(next);
}

/**
 * Publish the active session and workspace.
 *
 * Called from the layout on every change. A no-op when nothing moved, so a
 * re-render that passes the same ids does not wake every plugin component.
 */
export function setPluginContext(sessionId: string | null, workspacePath: string | null): void {
  if (current.sessionId === sessionId && current.workspacePath === workspacePath) return;
  current = { ...current, sessionId, workspacePath };
  publish();
}

/**
 * Follow the palette.
 *
 * A plugin renders in the host's document, so it inherits `data-theme` for
 * free — but a plugin that shows a swatch, a chart or an inline colour needs
 * the ID, not the CSS. Subscribed once at module load rather than from a hook,
 * because the first plugin component to mount may be anywhere in the tree.
 */
if (typeof window !== 'undefined') {
  window.addEventListener(THEME_CHANGED_EVENT, () => publish());
}
