/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel body's props, scoped to the panel that is being rendered.
 *
 * A Preact context rather than a service singleton, and that is the whole point:
 * the desktop stack keeps EVERY built-in view mounted at once (hidden with CSS,
 * so a tree's expansion and a terminal's buffer survive a switch), so "the
 * current panel's props" is not a process-wide fact — there are eleven of them
 * live at the same time. A module-level value would hand a wiki panel the
 * terminal's `rootPath` and its `onClose`.
 *
 * The provider is rendered by whichever layout draws the panel, so a component
 * nested deep inside a plugin's own tree reads the SAME props its top-level
 * component was handed rather than a second derivation of them.
 */

import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { PanelHostProps } from './services';

const PanelHostContext = createContext<PanelHostProps | null>(null);

/** Render a panel's body inside its own props scope. */
export function PanelHostProvider({ value, children }: { value: PanelHostProps; children: ComponentChildren }) {
  return <PanelHostContext.Provider value={value}>{children}</PanelHostContext.Provider>;
}

/**
 * The props of the panel this component is rendered in.
 *
 * Falls back to a permissive default when there is no provider — a component
 * rendered outside a panel body (the settings pane, a test) is not "disabled",
 * it simply has no layout to describe.
 */
export function usePanelHost(): PanelHostProps {
  return (
    useContext(PanelHostContext) ?? {
      sessionId: null,
      enabled: true,
      active: true,
      refreshKey: 0,
    }
  );
}
