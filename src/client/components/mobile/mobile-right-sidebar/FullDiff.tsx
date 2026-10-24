import { ArrowLeft } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { DiffPanel } from '@/client/components/workspace/diff-panel';
import { getGitStatusInfo } from '@/shared/lib/fs/git-status';
import { diffTabId } from '@/shared/lib/workspace/file-tab-id';
import { titlebarPaddingLeft, titlebarPaddingRight } from '@/shared/lib/ui/titlebar';

interface MobileFullDiffProps {
  diff: {
    path: string;
    status?: string;
    staged?: boolean;
    repo?: string;
    root?: string;
  };
  onClose: () => void;
  onFileSaved?: () => void;
}

/**
 * Phone-sized diff view: the desktop `DiffPanel` in a full-screen overlay with
 * the chrome a phone needs (back button, file identity, status badge).
 *
 * Reusing the panel is what gives mobile stage/unstage, discard, split view,
 * whitespace filtering and copy-diff — the phone only supplies the header, so
 * the two layouts cannot drift apart.
 */
export function MobileFullDiff({ diff, onClose, onFileSaved }: MobileFullDiffProps) {
  const fileName = diff.path.split('/').pop() || diff.path;
  const isStaged = Boolean(diff.staged);
  const status = diff.status || 'M';
  const statusInfo = getGitStatusInfo(status, isStaged);

  return (
    <div className="fixed inset-x-0 top-0 h-dvh z-[60] bg-paper flex flex-col">
      <header
        className="bg-canvas border-b border-ink/10 flex items-center justify-between px-3 flex-shrink-0"
        style={{
          height: 'calc(3rem + env(safe-area-inset-top, 0px))',
          paddingTop: 'env(safe-area-inset-top, 0px)',
          paddingLeft: titlebarPaddingLeft('0.75rem', true),
          paddingRight: titlebarPaddingRight('0.75rem', true),
        }}
      >
        <div className="flex items-center space-x-2 min-w-0 pr-2">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 -ml-1 rounded-lg hover:bg-ink/5 active:bg-ink/10 text-ink transition-colors flex-shrink-0"
            title="Back"
            aria-label="Close diff"
          >
            <ArrowLeft size={18} strokeWidth={1.9} />
          </button>

          <FileIcon name={fileName} size={14} className="flex-shrink-0" />
          <span className="font-mono text-xs text-ink font-medium truncate" title={diff.path}>
            {fileName}
          </span>
        </div>

        <span
          className={`px-1.5 py-0.5 text-[10px] font-mono font-semibold rounded border flex-shrink-0 ${statusInfo.badgeBgClass}`}
        >
          {statusInfo.charStatus} {statusInfo.label}
        </span>
      </header>

      <div className="flex-1 min-h-0">
        <DiffPanel
          className="h-full"
          // A full-screen phone overlay has no chat column or sidebar beside
          // it, so the width modes would widen into nothing.
          viewModeButtons={false}
          filePath={diff.path}
          status={status}
          isStaged={isStaged}
          root={diff.root}
          repo={diff.repo || '.'}
          onFileSaved={onFileSaved}
          // The same id a desktop diff tab uses for this path+staged pair, so a
          // diff read on the phone and one read on the desktop share an offset.
          tabKey={diffTabId(diff.path, isStaged)}
        />
      </div>
    </div>
  );
}
