import { Loader2, RotateCw, Terminal } from 'lucide-preact';
import { GitRepoPicker } from '@/client/components/workspace/repo-picker';
import type { TerminalStatus } from '@/client/hooks/workspace/terminal';

interface TerminalHeaderProps {
  status: TerminalStatus;
  exitCode: number | null;
  rootPath?: string;
  activeRepo: string;
  onSelectRepo: (repo: string) => void;
  /** Discovered repos of the active root; the panel owns discovery. */
  repos: string[];
  /** Discovery or a forced rescan is in flight. */
  reposScanning: boolean;
  onRefreshRepos: () => void;
  shell?: string;
  onRestart: () => void;
}

const STATUS_LABEL: Record<TerminalStatus, string> = {
  connecting: 'CONNECTING',
  running: 'LIVE',
  exited: 'EXITED',
  error: 'ERROR',
};

const STATUS_CLASS: Record<TerminalStatus, string> = {
  connecting: 'bg-warning/10 text-warning border-warning/20',
  running: 'bg-success/10 text-success border-success/20',
  exited: 'bg-ink/5 text-ink/60 border-ink/15',
  error: 'bg-error/10 text-error border-error/20',
};

export function TerminalHeader({
  status,
  exitCode,
  rootPath,
  activeRepo,
  onSelectRepo,
  repos,
  reposScanning,
  onRefreshRepos,
  shell,
  onRestart,
}: TerminalHeaderProps) {
  const shellName = shell ? shell.split('/').pop() : '';
  return (
    <div className="h-10 px-3 border-b border-ink/10 bg-paper flex items-center justify-between flex-shrink-0 select-none">
      {/* Left cluster: Title, Status, Repo */}
      <div className="flex items-center space-x-2 min-w-0">
        <div className="flex items-center space-x-1.5">
          <Terminal size={14} className="text-ink/80 flex-shrink-0" />
          <span className="text-xs font-semibold tracking-wider text-ink uppercase">
            Terminal
          </span>
        </div>

        <span
          className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-mono border ${STATUS_CLASS[status]}`}
          title={status === 'exited' && exitCode !== null ? `Shell exited with code ${exitCode}` : undefined}
        >
          {status === 'connecting' && <Loader2 size={10} className="animate-spin" />}
          <span>{status === 'exited' && exitCode !== null ? `EXIT ${exitCode}` : STATUS_LABEL[status]}</span>
        </span>

        <GitRepoPicker
          rootPath={rootPath}
          activeRepo={activeRepo}
          onSelectRepo={onSelectRepo}
          repos={repos}
          scanning={reposScanning}
          onRefreshRepos={onRefreshRepos}
        />

        <button
          type="button"
          onClick={onRestart}
          title="Kill this shell and start a new one"
          className="p-1 rounded text-ink/50 hover:text-ink hover:bg-ink/5 transition-colors cursor-pointer flex-shrink-0"
        >
          <RotateCw size={12} />
        </button>
      </div>

      {shellName && (
        <span className="hidden sm:block text-[10px] font-mono text-ink/40 flex-shrink-0">{shellName}</span>
      )}
    </div>
  );
}
