import { Download, Info, Monitor, Settings } from 'lucide-preact';
import packageJson from '@/../package.json';

interface MobileSessionFooterProps {
  onSettings: () => void;
  onAbout: () => void;
  updateAvailable?: boolean;
  onUpdateClick?: () => void;
  /** The newer APK to offer, or null. Only ever set inside the Android app. */
  androidDownload?: { url: string; latest: string; releaseUrl: string | null } | null;
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
  androidDownload,
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
        {androidDownload && (
          // Directly after About, matching the desktop footer. An `<a>`, not a
          // button: the download is the browser's (or the WebView's) job, and
          // `target="_blank"` hands it to the system browser so the console is
          // not replaced by a file download.
          <a
            href={androidDownload.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Download Kabmo ${androidDownload.latest} for Android`}
            aria-label={`Download Kabmo ${androidDownload.latest} for Android`}
            className="flex items-center space-x-1 hover:text-ink transition-colors"
          >
            <Download size={14} />
            <span>APK</span>
          </a>
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
