import { LayoutTemplate, PanelRight, PanelRightClose, Smartphone } from 'lucide-preact';
import { PWAInstallButton } from '@/client/components/common/PWAInstallButton';
import { ReloadPageButton } from '@/client/components/common/ReloadPageButton';
import { SignOutButton } from '@/client/components/common/SignOutButton';
import { ContextUsageButton } from '@/client/components/common/context-usage-button';
import { HeaderPanelButtons } from '@/client/components/common/header-panel-buttons';
import { withChord } from '@/client/lib/ui/with-chord';

export type HeaderLayout = 'desktop' | 'mobile';

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
 *   3. Reload page
 *   4. Context usage
 *   5. Sign out (the lock)
 *   6. Editor toggle            — desktop only
 *   7. Right panel
 *
 * The dev-only layout switch sits AFTER that list: it is not part of the
 * product's navbar and must not push a listed control out of the agreed order.
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

  return (
    <div className="flex items-center space-x-1">
      {layout === 'desktop' && <PWAInstallButton />}
      <HeaderPanelButtons layout={layout} />
      <ReloadPageButton size={size} className={iconClass} />
      <ContextUsageButton sessionId={sessionId} layout={layout} />
      <SignOutButton size={size} className={iconClass} />
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
    </div>
  );
}
