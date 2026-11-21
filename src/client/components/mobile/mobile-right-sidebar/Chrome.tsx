/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The phone right drawer's two chromes, as components.
 *
 * Extracted from `RightSidebar` when that file crossed the 350-line ceiling.
 * The split is by QUESTION, not by line count: the drawer owns state (which
 * view, which tabs, whether the terminal wants the keyboard) and these own the
 * two shapes of chrome that state is drawn in.
 *
 * - `DrawerHeader` is the `classic` chrome: a real header row holding the whole
 *   catalog as chips. It must be tall enough for the 44px touch floor, and it is
 *   the window's title bar while this drawer is the mounted screen.
 * - `TabsChrome` is the `tabs` chrome: the strip alone, which inherits that same
 *   window contract (`data-drag-region`, the shell's traffic-light inset, the
 *   safe-area top) because there is no header left to carry it, and whose
 *   trailing action is the drawer's close control.
 *
 * The `PanelRightClose` glyph rather than an `X` is deliberate: the control
 * closes the DRAWER, not the view, and an `X` beside eleven chips reads as
 * "close this tab".
 */

import { Suspense } from 'preact/compat';
import type { CSSProperties } from 'preact/compat';
import { PanelRight, X } from 'lucide-preact';
import { PanelHostProvider } from '@kabmo-labs/kabmo-ui';
import type { ResolvedPanel } from '@/client/components/workspace/plugin-panel/catalog';
import type { PanelBodyProps } from '@/client/components/workspace/panels/builtin';
import { PanelChips } from '@/client/components/mobile/panel-chips';
import { dragRegionProps, titlebarInsetLeft } from '@/client/lib/desktop/titlebar';
import type { VisibilityMenuSurfaceProps } from '@/client/hooks/ui/visibility-menu-trigger';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';
import { CONTROL_BOX, CONTROL_GLYPH_PX } from '@/client/lib/ui/control-plate';

/** The height a `classic` header needs to hold a 44px chip and its padding. */
const HEADER_HEIGHT = 'calc(3.5rem + env(safe-area-inset-top, 0px))';

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
      style={{
        height: HEADER_HEIGHT,
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingLeft: titlebarInsetLeft(titlebarPaddingLeft('0.75rem', true)),
        paddingRight: titlebarPaddingRight('0.75rem', true),
      }}
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
 * The `tabs` chrome's strip props: the window contract the removed header
 * carried, and nothing else.
 */
export function drawerStripProps(menuProps: VisibilityMenuSurfaceProps): {
  dragRegion: boolean;
  layout: 'mobile';
  rootProps: Record<string, unknown>;
  style: CSSProperties;
} {
  return {
    dragRegion: true,
    // The PHONE density, stated rather than inferred from `dragRegion`: this
    // drawer is the phone layout's own screen, and its row must match the
    // phone header above the chat (56px, 36px controls) — measured before this,
    // the strip drew 40px/28px against a 56px/36px header and read as a broken
    // edge.
    layout: 'mobile',
    // The ATTRIBUTE the shells hit-test, plus the drawer's long-press menu
    // handlers: this row is what the header used to be, so it inherits both
    // jobs. `dragRegionProps` is empty in a browser tab, where nothing may be
    // dragged.
    rootProps: { ...dragRegionProps(), ...menuProps } as unknown as Record<string, unknown>,
    // The row's height and the notch live in the strip's own classes
    // (`TabStrip`): a `padding-top: env()` written here is dropped by
    // happy-dom, and the two values belong together with the height they
    // modify. Only the HORIZONTAL insets are this caller's business.
    style: {
      paddingLeft: titlebarInsetLeft(titlebarPaddingLeft('0.75rem', true)),
      paddingRight: titlebarPaddingRight('0.75rem', true),
    },
  };
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

/**
 * The drawer's close control, for the strip's trailing edge.
 *
 * `PanelRight`, NOT `PanelRightClose`: the latter draws a chevron inside the
 * panel (`m8 9 3 3-3 3`), and the arrow reads as "collapse this column" — a
 * second meaning beside a strip whose chips each carry their own `X`. The plain
 * panel mark says what the control acts on and nothing more.
 */
export function DrawerCloseAction({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      /* The SAME box and glyph as every other control in the phone header row:
         a 28px box here sat 4px left of the header's 36px one, which is the
         misalignment a reader sees as a strip that does not line up. */
      className={`${CONTROL_BOX.mobile} flex-none cursor-pointer rounded-lg text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink titlebar-no-drag`}
      title="Tutup panel kanan"
      aria-label="Close right sidebar"
    >
      <PanelRight size={CONTROL_GLYPH_PX.mobile} strokeWidth={1.8} />
    </button>
  );
}
