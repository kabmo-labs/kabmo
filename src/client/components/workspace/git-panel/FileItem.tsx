import { Minus, Plus, Undo2 } from 'lucide-preact';
import { FileIcon } from '@/client/components/common/file-icon';
import { getGitStatusInfo } from '@/shared/lib/fs/git-status';
import type { GitChange } from '@/shared/types';

interface GitFileItemProps {
  change: GitChange;
  isStaged: boolean;
  repo?: string;
  rootPath?: string;
  onAction: (actionType: string, file?: string) => void;
}

export function GitFileItem({ change, isStaged, repo, rootPath, onAction }: GitFileItemProps) {
  const statusInfo = getGitStatusInfo(change.status, isStaged);
  const charStatus = statusInfo.charStatus;
  const colorClass = statusInfo.colorClass;

  const parts = change.file.split('/');
  const fileName = parts.pop() || change.file;
  const dirPath = parts.length > 0 ? parts.join('/') : '';

  const handleOpenDiff = () => {
    window.dispatchEvent(new CustomEvent('omp:open-diff', {
      detail: {
        file: change.file,
        staged: isStaged,
        status: charStatus,
        repo: repo || '.',
        root: rootPath,
      }
    }));
  };

  return (
    <div 
      className="flex items-center justify-between px-3 py-1 hover:bg-ink/5 cursor-pointer group text-[11px] transition-colors"
      onClick={handleOpenDiff}
    >
      <div className="flex items-center space-x-1.5 flex-1 min-w-0 pr-2">
        <span className={`font-bold font-mono text-[10px] w-3 flex-shrink-0 text-center ${colorClass}`} title={`Status: ${statusInfo.label}`}>
          {charStatus}
        </span>
        <FileIcon name={fileName} size={12} className="flex-shrink-0" />
        <span className={`truncate ${colorClass}`} title={change.file}>
          {fileName}
        </span>
        {dirPath && (
          <span className="text-[10px] text-ink/40 truncate ml-1">
            {dirPath}
          </span>
        )}
      </div>
      <div className="flex items-center space-x-1 text-ink/40 flex-shrink-0">
        <div className="flex items-center touch-visible opacity-0 group-hover:opacity-100 space-x-1">
          {!isStaged && (
            <>
              <button 
                type="button" 
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('revert', change.file);
                }} 
                title="Discard Changes" 
                className="w-5 h-5 flex items-center justify-center rounded hover:text-error hover:bg-error/10 cursor-pointer transition-colors"
              >
                <Undo2 size={11} />
              </button>
              <button 
                type="button" 
                onClick={(e) => {
                  e.stopPropagation();
                  onAction('stage', change.file);
                }} 
                title="Stage Changes" 
                className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
              >
                <Plus size={11} />
              </button>
            </>
          )}
          {isStaged && (
            <button 
              type="button" 
              onClick={(e) => {
                e.stopPropagation();
                onAction('unstage', change.file);
              }} 
              title="Unstage Changes" 
              className="w-5 h-5 flex items-center justify-center rounded hover:text-ink hover:bg-ink/10 cursor-pointer transition-colors"
            >
              <Minus size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
