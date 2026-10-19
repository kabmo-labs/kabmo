/**
 * What the popup offers to DO, which depends on how this copy was installed.
 *
 * The primary action HANDS OFF to the About modal rather than running the update
 * here. That modal is where an update has always been driven from — it owns the
 * live output, the per-target rows and the retry — so the popup announces the
 * release and then gets out of the way. Running a second copy of the same run in
 * a second dialog meant two places could disagree about what was in flight, and
 * the popup's copy was the one with no way back to it after a reload.
 *
 * A copy under `node_modules` cannot update itself at all, so for that install
 * the button is replaced by the exact command to run — information plus a copy
 * action, not an action this app can take.
 */

import { Check, Copy, Download, ExternalLink } from 'lucide-preact';
import { useCopyFlag } from '@/client/hooks/ui/copy-flag';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import type { UpdateChangelog } from '@/shared/types/updates';

export interface ActionsProps {
  data: UpdateChangelog | null;
  updates: UseUpdatesResult;
  onClose: () => void;
  /** Open the About modal and start Kabmo update there. */
  onRequestUpdate: () => void;
}

const BUTTON_CLASS = 'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

function ManualCommand({ command, reason }: { command: string; reason: string }) {
  const { copied, flagCopied } = useCopyFlag();

  const handleCopy = async () => {
    if (await copyToClipboard(command)) flagCopied();
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-md border border-ink/15 bg-canvas px-2 py-1.5 font-mono text-[11px] text-ink select-text">
          {command}
        </code>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`${BUTTON_CLASS} border border-ink/20 text-ink hover:border-ink/40`}
          title="Copy command"
          aria-label="Copy update command"
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
        </button>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-ink/45">
        This copy cannot update itself ({reason}). Run the command above, then restart the server.
      </p>
    </div>
  );
}

export function Actions({ data, updates, onClose, onRequestUpdate }: ActionsProps) {
  // A run started from the About modal is still this hook's run, so the button
  // reflects it: pressing it again while one is in flight would only queue a
  // refusal the server already knows how to word.
  const busy = updates.applying !== null;
  const manual = Boolean(data?.install.manual && data.install.command);

  return (
    // `sticky bottom-0`: `Modal` renders its footer INSIDE the scrolling body,
    // and this dialog's body is a changelog that can run 1900px. Without this
    // the primary action sat below the fold — measured on a 1440x900 window, the
    // "Update now"/"Later" row landed at y=1966 while the panel ended at 884.
    // Sticky pins it to the visible bottom edge instead of the content's.
    <div className="sticky bottom-0 z-10 border-t border-ink/10 bg-paper px-5 py-3">
      <div className="flex items-center justify-between gap-3">
        {manual ? (
          <ManualCommand command={data!.install.command!} reason={data!.install.reason} />
        ) : (
          <button
            type="button"
            onClick={onRequestUpdate}
            disabled={busy}
            className={`${BUTTON_CLASS} bg-ink text-canvas hover:bg-ink/90`}
          >
            <Download size={12} />
            <span>{busy ? 'Updating…' : 'Update now'}</span>
          </button>
        )}

        <div className="flex shrink-0 items-center gap-2">
          {data?.releaseUrl && (
            <a
              href={data.releaseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`${BUTTON_CLASS} border border-ink/20 text-ink hover:border-ink/40`}
            >
              <ExternalLink size={12} />
              <span>Release notes</span>
            </a>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${BUTTON_CLASS} text-ink/60 hover:text-ink`}
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
