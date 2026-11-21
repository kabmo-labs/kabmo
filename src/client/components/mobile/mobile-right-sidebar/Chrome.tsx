/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone right drawer's `classic` chrome, and its view body.
 *
 * Extracted from `RightSidebar` when that file crossed the 350-line ceiling.
 * The split is by QUESTION: the drawer owns state (which view, which tabs,
 * whether the terminal wants the keyboard) and this owns the shape that state
 * is drawn in.
 *
 * `DrawerHeader` is the `classic` chrome: a real header row holding the whole
 * catalog as chips. It must be tall enough for the 44px touch floor, and it is
 * the window's title bar while this drawer is the mounted screen.
 *
 * The `tabs` chrome is NOT here: under that style the strip IS the drawer's
 * title bar, and both drawers share one statement of what it reserves
 * (`mobile/drawer-strip.tsx`).
 */

import { Suspense } from 'preact/compat';
import { X } from 'lucide-preact';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { PanelChips } from '@/client/components/mobile/panel-chips';
import { dragRegionProps } from '@/client/lib/desktop/titlebar';
import { phoneRowStyle } from '@/client/lib/ui/phone-row';
import type { VisibilityMenuSurfaceProps } from '@/client/hooks/ui/visibility-menu-trigger';

export function DrawerHeader({
  catalog,
  activeId,
  onSelect,
  hasGitChanges,
  onClose,
  menuProps,
}: {
  catalog: readonly ResolvedPanel[];
  activeId: string;
  onSelect: (id: string) => void;
  hasGitChanges: boolean;
  onClose: () => void;
  menuProps: VisibilityMenuSurfaceProps;
}) {
  return (
    <div
      className="border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0 bg-canvas titlebar-drag-region select-none"
      {...dragRegionProps()}
      {...menuProps}
      style={phoneRowStyle()}
    >
      {/* The header is a drag region, so its controls must say so —
          `app-region` inherits, and a control inside a drag region is a drag
          handle that swallows its own click on Windows. */}
      <div className="flex items-center min-w-0 titlebar-no-drag">
        <PanelChips
          panels={catalog}
          activeId={activeId}
          onSelect={onSelect}
          hasGitChanges={hasGitChanges}
        />
      </div>

      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink transition-colors flex-shrink-0 ml-2 titlebar-no-drag"
        title="Close right sidebar"
        aria-label="Close right sidebar"
      >
        <X size={20} strokeWidth={1.8} />
      </button>
    </div>
  );
}

/**
 * The active view's body, and the "nothing selected" sentence.
 *
 * A plugin component renders in the host's tree like any other view, so it needs
 * no workspace folder and no session: it reads whatever the host published and
 * draws what it can. Gating it here would hide a panel that works.
 */
export function DrawerBody({ panel, body }: { panel?: ResolvedPanel; body: PanelBodyProps }) {
  if (!panel) {
    return (
      <div className="h-full flex items-center justify-center text-ink/40">
        <span className="text-xs font-mono text-muted">No session selected</span>
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div className="h-full flex items-center justify-center text-ink/40">
          <span className="text-xs font-mono">Loading…</span>
        </div>
      }
    >
      <PanelHostProvider value={body}>{panel.render(body)}</PanelHostProvider>
    </Suspense>
  );
}
