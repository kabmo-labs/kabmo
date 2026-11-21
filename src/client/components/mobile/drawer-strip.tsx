/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The chrome a PHONE drawer's tab strip carries, and the control that closes it.
 *
 * One module for both drawers: under the tab style the strip IS the drawer's
 * title bar, so it inherits the window contract the removed header carried
 * (`data-drag-region`, the shell's traffic-light inset, the safe-area notch) and
 * it owns the close control. A second copy in the left drawer is how the two
 * would drift about which of those three the strip reserves.
 *
 * The row's height, inset and control box are NOT stated here — they come from
 * `control-plate.ts` (`CONTROL_ROW_HEIGHT` / `CONTROL_ROW_INSET`), which is what
 * makes a phone strip line up with the phone header above the chat. Measured
 * before that was stated once: strip 40px with 28px controls against a 56px
 * header with 36px ones.
 */

import type { CSSProperties } from 'preact/compat';
import { PanelLeft, PanelRight } from 'lucide-preact';
import { dragRegionProps, titlebarInsetLeft } from '@/client/lib/desktop/titlebar';
import type { VisibilityMenuSurfaceProps } from '@/client/hooks/ui/visibility-menu-trigger';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';
import { CONTROL_BOX, CONTROL_GLYPH_PX } from '@/client/lib/ui/control-plate';

/**
 * The strip props a phone drawer passes to `PanelTabsColumn`.
 *
 * `layout: 'mobile'` is stated rather than inferred from `dragRegion`: this
 * drawer is the phone layout's own screen, and its row must match the phone
 * header above the chat. A desktop shell window narrowed past the layout
 * breakpoint can be a drag region while still being the desktop layout.
 */
export function drawerStripProps(menuProps: VisibilityMenuSurfaceProps): {
  dragRegion: boolean;
  layout: 'mobile';
  rootProps: Record<string, unknown>;
  style: CSSProperties;
} {
  return {
    dragRegion: true,
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
 * The drawer's close control, for the strip's trailing edge.
 *
 * The plain panel mark, NOT `PanelRightClose` / `PanelLeftClose`: those draw a
 * chevron inside the panel (`m8 9 3 3-3 3`), which reads as "collapse this
 * column" — a second meaning on a strip whose chips each carry their own `X`.
 */
export function DrawerCloseAction({ side, onClose }: { side: 'left' | 'right'; onClose: () => void }) {
  const Icon = side === 'left' ? PanelLeft : PanelRight;
  return (
    <button
      type="button"
      onClick={onClose}
      /* The SAME box and glyph as every other control in the phone header row:
         a 28px box here sits 4px off the header's 36px one, which is the
         misalignment a reader sees as a strip that does not line up. */
      className={`${CONTROL_BOX.mobile} flex-none cursor-pointer rounded-lg text-ink/60 transition-colors hover:bg-ink/5 hover:text-ink titlebar-no-drag`}
      title={side === 'left' ? 'Tutup panel kiri' : 'Tutup panel kanan'}
      aria-label={side === 'left' ? 'Close left sidebar' : 'Close right sidebar'}
    >
      <Icon size={CONTROL_GLYPH_PX.mobile} strokeWidth={1.8} />
    </button>
  );
}
