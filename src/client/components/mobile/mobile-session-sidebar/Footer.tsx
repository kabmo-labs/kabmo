import { Info, Monitor, Settings } from 'lucide-preact';
import packageJson from '@/../package.json';
import type { ShellDownload } from '@/client/hooks/ui/updates/shell-download';
import { ShellUpdateButton } from '@/client/components/common/shell-update-button';

interface MobileSessionFooterProps {
  onSettings: () => void;
  onAbout: () => void;
  updateAvailable?: boolean;
  onUpdateClick?: () => void;
  /** The native-shell artifact to offer, or null. Set inside a shell (an update) or on an Android browser (an install). */
  shellDownload?: ShellDownload | null;
  /** Switch the app to the desktop layout for this page session only. The
   *  choice is not persisted, so the next load re-detects the device. */
  onDesktopToggle?: () => void;
}

export function MobileSessionFooter({
  onSettings,
  onAbout,
  updateAvailable,
  onUpdateClick,
  onDesktopToggle,
  shellDownload,
}: MobileSessionFooterProps) {
  return (
    <div
      className="px-3 pt-3 border-t border-ink/10 flex items-center justify-between flex-shrink-0 bg-canvas text-xs text-ink/60"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))' }}
    >
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onSettings}
          className="flex items-center space-x-1 hover:text-ink transition-colors"
        >
          <Settings size={14} />
          <span>Settings</span>
        </button>
        <button
          type="button"
          onClick={onAbout}
          className="flex items-center space-x-1 hover:text-ink transition-colors"
        >
          <Info size={14} />
          <span>About</span>
        </button>
        {shellDownload && (
          // Directly after About, matching the desktop footer.
          //
          // The visible word is the OFFER, not the file type: `APK` told a
          // reader what the bytes are but not what the control does, and on a
          // browser it is the only place the native shell is ever mentioned. An
          // iOS update is an IPA, so the word names the platform instead of a
          // file extension.
          //
          // The shared control decides link-versus-button: a desktop shell that
          // knows its architecture installs the artifact itself, and a link
          // there would leave the file in Downloads.
          <ShellUpdateButton download={shellDownload} variant="label" />
        )}
        {onDesktopToggle && (
          <button
            type="button"
            onClick={onDesktopToggle}
            className="flex items-center space-x-1 hover:text-ink transition-colors"
            title="Switch to desktop view"
          >
            <Monitor size={14} />
            <span>Desktop</span>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] text-ink/40">v{packageJson.version}</span>
        {updateAvailable && (
          <button
            type="button"
            onClick={onUpdateClick}
            className="px-2 py-0.5 rounded-full border border-ink/20 text-[10px] font-semibold text-ink hover:border-ink/40"
          >
            update
          </button>
        )}
      </div>
    </div>
  );
}
