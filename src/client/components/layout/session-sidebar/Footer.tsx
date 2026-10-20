import { Download, Info, Settings } from 'lucide-preact';

interface SessionSidebarFooterProps {
  onSettings: () => void;
  onInfo: () => void;
  updateAvailable?: boolean;
  onUpdateClick?: () => void;
  /** The newer APK to offer, or null. Only ever set inside the Android app. */
  androidDownload?: { url: string; latest: string; releaseUrl: string | null } | null;
}

/**
 * The sidebar's bottom strip.
 *
 * Settings and Info are real `<button>`s carrying an `aria-label`, not bare
 * `<svg onClick>` glyphs. A clickable icon with no role and no name is
 * unreachable by keyboard and invisible to assistive tech — the same rule the
 * editor and diff toolbars already follow (AGENTS.md: "a bare `<svg onClick>`
 * is unreachable by keyboard"). It is also what lets a browser spec address
 * these controls by role and name instead of by their position in the DOM.
 */
export function SessionSidebarFooter({ onSettings, onInfo, updateAvailable, onUpdateClick, androidDownload }: SessionSidebarFooterProps) {
  return (
    <div className="h-10 px-3 border-t border-ink/10 flex items-center justify-between text-ink/60 shrink-0">
      <div className="flex space-x-1">
        <button
          type="button"
          onClick={onSettings}
          title="Settings"
          aria-label="Settings"
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={onInfo}
          title="About Kabmo"
          aria-label="About Kabmo"
          className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
        >
          <Info size={16} />
        </button>
        {androidDownload && (
          // Next to About, and only when BOTH facts hold: this page is inside
          // the Android app, and a newer APK is published. An up-to-date app
          // shows nothing here, and a browser never does — see
          // `useAndroidDownload`.
          <a
            href={androidDownload.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Download Kabmo ${androidDownload.latest} for Android`}
            aria-label={`Download Kabmo ${androidDownload.latest} for Android`}
            className="p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors"
          >
            <Download size={16} />
          </a>
        )}
      </div>
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
  );
}
