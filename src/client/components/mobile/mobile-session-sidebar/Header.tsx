import { X } from 'lucide-preact';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';
import { ServerControl } from '@/client/components/common/server-control';
import type { VisibilityMenuSurfaceProps } from '@/client/hooks/ui/visibility-menu-trigger';
import { dragRegionProps } from '@/client/lib/desktop/titlebar';
import { phoneRowStyle } from '@/client/lib/ui/phone-row';

/**
 * The session drawer's title bar.
 *
 * Two controls on the right, and the second one is why this row exists in the
 * shape it does:
 *
 * - the **server chip** — which server this window is on. A PHONE puts its
 *   server control here rather than in the chat header because this row has the
 *   room and that one does not: measured at 390px with a password set, the chat
 *   header has ~100px spare while the session title is the one thing that may
 *   give up width, and adding 40px there left the title 49px. This row has
 *   ~158px spare and truncates nothing to pay for the chip.
 * - the **close** button.
 *
 * The chip is also what a DESKTOP shell window narrowed below the layout
 * breakpoint relies on: it renders the phone layout, so its navbar — and the
 * server control in it — is gone, and this is the only surface left.
 *
 * `viewLabel` says what the drawer is showing (Sessions, or a panel's name), so
 * the chip is available in every view the drawer has.
 */
export function MobileSessionHeader({
  onClose,
  viewLabel = 'Sessions',
  menuProps,
}: {
  onClose: () => void;
  viewLabel?: string;
  /** The drawer's right-click surface: a long press opens the panel switch. */
  menuProps?: VisibilityMenuSurfaceProps;
}) {
  return (
    <div 
      className="border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0 bg-canvas titlebar-drag-region select-none"
      {...dragRegionProps()}
      {...menuProps}
      style={{
        // `px-3`, the toolbar's own inset: the wordmark above and the New
        // Session button below share one left edge, which the header's old
        // 14px did not — and the SHELL's own inset, because a desktop shell
        // window narrowed past the layout breakpoint shows this drawer, whose
        // wordmark would otherwise sit under macOS's traffic lights. The row's
        // height, notch and window insets are the ONE phone-row fact
        // (`lib/ui/phone-row`), so this drawer cannot drift from the chat
        // header it is opened from.
        ...phoneRowStyle(),
      }}
    >
      <div className="flex items-center space-x-2.5 titlebar-no-drag min-w-0">
        <span className="font-bold text-sm tracking-tight flex items-center flex-shrink-0">
          <BrandWordmark className="text-[16px]" glow />
        </span>
        <span className="text-ink/25 text-xs select-none flex-shrink-0">/</span>
        <span className="text-[11px] font-semibold text-ink/60 uppercase tracking-wider font-mono truncate">{viewLabel}</span>
      </div>

      <div className="flex items-center gap-1 titlebar-no-drag flex-shrink-0">
        {/* Draws nothing in a browser: `ServerControl` hides itself when no
            native host is present, which is the same rule the desktop navbar
            follows rather than a second one stated here. */}
        <ServerControl variant="chip" />
        <button
          type="button"
          onClick={onClose}
          className="w-9 h-9 rounded-xl hover:bg-ink/5 active:bg-ink/10 text-ink flex items-center justify-center transition-colors cursor-pointer"
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <X size={19} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}
