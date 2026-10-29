/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The boundary every plugin-owned component renders inside.
 *
 * A plugin is third-party code drawing into the host's tree, so a throw from it
 * is not an edge case — it is what a half-written plugin, an old bundle against
 * a newer host, or a value the host handed it in an unexpected shape all look
 * like. Without a boundary that throw leaves the HOST's diff half-written, and
 * the damage is not local:
 *
 * - Preact re-renders the nearest root it can reach. A throw inside the app's
 *   root diff leaves the container's vnode bookkeeping incomplete, and the next
 *   queued render then APPENDS a second app tree — measured on the navbar: the
 *   Stats readout threw after a server restart, and the console drew two
 *   identical navbars (and two of everything under them) until a reload.
 * - The reason disappears with the tree. A plugin that failed to render is
 *   then indistinguishable from one that drew nothing.
 *
 * Both are fixed by holding the plugin's subtree here: the throw is caught at
 * the boundary, the rest of the surface renders, and the reason is stated twice
 * over — on the console for whoever is debugging, and in the chip for the user
 * who is now looking at a control the plugin is not drawing.
 *
 * This is the ONE implementation: every surface that renders a plugin's
 * component (a navbar entry, a pending-interaction control, a panel) uses it,
 * so a second copy cannot drift into handling a throw differently.
 */

import { Component, type ComponentChildren } from 'preact';
import { AlertTriangle } from 'lucide-preact';

export interface PluginRenderBoundaryProps {
  pluginId: string;
  /**
   * What the plugin was drawing, in the words of the chip: "its navbar entry",
   * "its answer control". Stated by the surface, because only it knows.
   */
  surface: string;
  children?: ComponentChildren;
}

interface PluginRenderBoundaryState {
  reason: string | null;
}

export class PluginRenderBoundary extends Component<PluginRenderBoundaryProps, PluginRenderBoundaryState> {
  state: PluginRenderBoundaryState = { reason: null };

  static getDerivedStateFromError(error: unknown): PluginRenderBoundaryState {
    return { reason: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown): void {
    console.error(`[plugin:${this.props.pluginId}] ${this.props.surface} failed to render`, error);
  }

  render(): ComponentChildren {
    const { reason } = this.state;
    if (reason === null) return this.props.children;
    return (
      <div
        data-plugin-error={this.props.pluginId}
        className="flex items-start gap-2 rounded-md border border-error/20 bg-error/[0.03] px-2.5 py-1.5 text-[10.5px] text-ink/70"
      >
        <AlertTriangle size={11} className="mt-0.5 shrink-0 text-error" />
        <span className="select-text">
          Plugin <span className="font-mono">{this.props.pluginId}</span> failed to render {this.props.surface}:{' '}
          <span className="font-mono">{reason}</span>
        </span>
      </div>
    );
  }
}
