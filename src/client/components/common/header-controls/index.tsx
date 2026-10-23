import { LayoutTemplate, PanelRight, PanelRightClose, Smartphone } from 'lucide-preact';
import { PWAInstallButton } from '@/client/components/common/PWAInstallButton';
import { ReloadPageButton } from '@/client/components/common/ReloadPageButton';
import { SignOutButton } from '@/client/components/common/SignOutButton';
import { ContextUsageButton } from '@/client/components/common/context-usage-button';
import { HeaderPanelButtons } from '@/client/components/common/header-panel-buttons';
import { useHeaderEntries } from '@/client/components/common/header-panel-buttons/entries';
import { HeaderMoreMenu } from '@/client/components/common/header-controls/MoreMenu';
import { WindowControls } from '@/client/components/common/window-controls';
import { drawsWindowControls } from '@/client/lib/desktop/titlebar';
import { useAuthEnabled, useAuthState } from '@/client/hooks/ui/auth';
import { useViewportAtLeast } from '@/client/hooks/ui/media-query';
import { withChord } from '@/client/lib/ui/with-chord';

export type HeaderLayout = 'desktop' | 'mobile';

/**
 * The narrowest phone header that still holds every control in the row.
 *
 * Measured against the real header, with a long session title so the picker is
 * at its 150px cap and cannot absorb the difference:
 *
 * - open instance, reload in the row: the picker reaches 150px at **400px**;
 * - with a UI password, reload + lock: at **436px**.
 *
 * Below those the picker would start truncating the session title to pay for a
 * control that is pressed once a session, so those two move into `⋯` instead.
 * A wider phone or a rotated one gets them back — the fold is not a device
 * class, it is the width at which the row stops fitting.
 */
const MOBILE_FULL_ROW_PX = { without: 400, withSignOut: 436 } as const;

interface HeaderControlsProps {
  layout: HeaderLayout;
  sessionId: string | null;
  showRightPanel: boolean;
  onToggleRightPanel: () => void;
  /** Desktop only: the editor column has no phone counterpart in the header. */
  showEditor?: boolean;
  onToggleEditor?: () => void;
  /** Desktop only: the dev-only layout switch, drawn after every listed control. */
  onSwitchToMobile?: () => void;
}

/** The hit area each layout gives an icon-only control. */
const ICON_BUTTON_CLASS: Record<HeaderLayout, string> = {
  desktop: 'p-1.5 rounded hover:bg-ink/10 transition-colors text-ink/60 hover:text-ink cursor-pointer',
  mobile: 'w-8 h-8 rounded-lg hover:bg-ink/5 active:bg-ink/10 flex items-center justify-center text-ink transition-colors cursor-pointer',
};

const ICON_SIZE: Record<HeaderLayout, number> = { desktop: 16, mobile: 18 };

/**
 * Every control the top navbar draws, in ONE order for both layouts.
 *
 * The two headers are separate components (a phone's title area and a desktop
 * titlebar have nothing in common), so the ORDER used to be written twice and
 * drifted: the phone drew reload → context → sign out → panel while the desktop
 * drew plugins → install → reload → sign out → editor → context → panel. A user
 * switching layouts had to re-find every control. The order is stated here
 * once, and each layout passes only what it has:
 *
 *   1. Install (PWA)            — desktop only
 *   2. Plugin header slots
 *   3. Reload page              — desktop; behind `⋯` on a phone
 *   4. Context usage
 *   5. Sign out (the lock)      — desktop; behind `⋯` on a phone
 *   6. Editor toggle            — desktop only
 *   7. Right panel
 *   8. More actions (`⋯`)       — phone only, in the slot the two moved controls
 *                                  left behind
 *
 * The dev-only layout switch sits AFTER that list: it is not part of the
 * product's navbar and must not push a listed control out of the agreed order.
 *
 * ## Why a narrow phone folds two of them into a menu
 *
 * The row is 320–412px wide and already shares it with the wordmark, the slash
 * and the session title — the only functional thing in the left group. Reload
 * and sign-out are rare (a reload is Cmd/Ctrl+R; a sign-out happens once a
 * session), while context and the right panel are read and pressed mid-turn.
 * Measured with a UI password set and all four standing in the row, the title
 * got 89px at 390 and 19px at 320 — one letter and an ellipsis.
 *
 * The fold is therefore a WIDTH, not a layout: `MOBILE_FULL_ROW_PX` is the
 * narrowest header that still fits every control beside a full 150px picker,
 * and above it the phone draws the same row the desktop does. Nothing is
 * permanently unreachable, and nothing is hidden at a width that can hold it.
 */
export function HeaderControls({
  layout,
  sessionId,
  showRightPanel,
  onToggleRightPanel,
  showEditor = false,
  onToggleEditor,
  onSwitchToMobile,
}: HeaderControlsProps) {
  const iconClass = ICON_BUTTON_CLASS[layout];
  const size = ICON_SIZE[layout];
  const authEnabled = useAuthEnabled();
  const authState = useAuthState();
  const signOutShown = authEnabled && authState !== 'required';
  // Called unconditionally: a hook inside the ternary below would run in a
  // different order on the two layouts.
  const wideRow = useViewportAtLeast(signOutShown ? MOBILE_FULL_ROW_PX.withSignOut : MOBILE_FULL_ROW_PX.without);
  const wideEnoughForAll = layout === 'desktop' || wideRow;
  // A phone folds the two rare controls only while the row cannot hold them.
  const folded = layout === 'mobile' && !wideEnoughForAll;
  // ONE resolution of what the plugin entries do, because two surfaces draw it:
  // the row (inline) and the `⋯` menu (folded). Asking twice would be two media
  // queries deciding one row, and the two halves could disagree mid-resize.
  const headerEntries = useHeaderEntries(layout);

  return (
    // `titlebar-no-drag` belongs HERE, on the cluster's own root, not on each
    // call site. `app-region` INHERITS (WebView2's own spec says so, and
    // Chromium 152 began enforcing it), so a header that marks itself a drag
    // region makes every descendant a drag handle unless something below it
    // says otherwise — a control inside one is unclickable, silently. The
    // desktop navbar wrapped this cluster in a `titlebar-no-drag` div and the
    // PHONE's header did not, so on Windows every control in a phone-width
    // window (reload, context, sign out, the right panel, `⋯`) swallowed its
    // own click. Stating it on the cluster is what makes the next layout that
    // draws it correct by construction.
    <div className="flex items-center space-x-1 titlebar-no-drag">
      {layout === 'desktop' && <PWAInstallButton />}
      <HeaderPanelButtons layout={layout} entries={headerEntries.inline} />
      {/* The cluster's ORDER is fixed; what changes on a narrow phone is that
          reload and sign-out move behind `⋯`, which sits in the slot they
          left. Nothing is hidden at a width that can hold it: measured, the
          row fits every control at 400px open and 436px with the lock. */}
      {(layout === 'desktop' || !folded) && <ReloadPageButton size={size} className={iconClass} />}
      <ContextUsageButton sessionId={sessionId} layout={layout} />
      {(layout === 'desktop' || !folded) && <SignOutButton size={size} className={iconClass} />}
      {layout === 'desktop' && onToggleEditor && (
        <button
          type="button"
          onClick={onToggleEditor}
          className={`${iconClass} ${showEditor ? 'text-ink' : 'text-ink/40'}`}
          title={withChord('toggleEditorPanel', 'Toggle Editor Layout')}
          aria-label={withChord('toggleEditorPanel', 'Toggle Editor Layout')}
          aria-pressed={showEditor}
        >
          <LayoutTemplate size={size} />
        </button>
      )}
      {layout === 'mobile' ? (
        <button
          type="button"
          onClick={onToggleRightPanel}
          className={iconClass}
          title="Right Panel"
          aria-label="Open Right Panel"
        >
          <PanelRight size={size} strokeWidth={1.8} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onToggleRightPanel}
          className={`${iconClass} ${showRightPanel ? 'text-ink' : 'text-ink/40'}`}
          title={withChord('toggleRightPanel', 'Toggle Right Panel')}
          aria-label={withChord('toggleRightPanel', 'Toggle Right Panel')}
          aria-pressed={showRightPanel}
        >
          {showRightPanel ? <PanelRightClose size={size} /> : <PanelRight size={size} />}
        </button>
      )}
      {(folded || headerEntries.folded.length > 0) && (
        <HeaderMoreMenu entries={headerEntries.folded} />
      )}
      {layout === 'desktop' && onSwitchToMobile && (
        <button
          type="button"
          onClick={onSwitchToMobile}
          className={iconClass}
          title="Switch to Mobile View"
          aria-label="Switch to Mobile View"
        >
          <Smartphone size={size} />
        </button>
      )}
      {/* The Windows and Linux shells draw no caption buttons of their own —
          their webview is the whole window — so the PAGE owns minimise,
          maximise and close. This lives in the shared cluster rather than in
          the desktop navbar for a measured reason: a desktop shell window can
          be NARROWER than the layout breakpoint (`App` switches to the mobile
          layout below 768px, and all three shells allow a 720px window), and
          the phone header drew no window controls at all. A user who shrank
          the window lost close/minimise/maximise entirely, with no title bar
          behind them to fall back on. macOS never reaches this branch: its
          traffic lights are the system's, so `drawsWindowControls` is false. */}
      {drawsWindowControls() && <WindowControls />}
    </div>
  );
}
