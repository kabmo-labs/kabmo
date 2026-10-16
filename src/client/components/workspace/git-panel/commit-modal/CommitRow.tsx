import type { TargetedMouseEvent } from 'preact';
import { useState } from 'preact/hooks';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-preact';
import type { GitCommit, GitCommitFile } from '@/shared/types/git';
import { CommitActions } from '@/client/components/workspace/git-panel/commit-modal/CommitActions';
import { CommitDiffViewer } from '@/client/components/workspace/git-panel/commit-modal/CommitDiffViewer';

interface CommitRowProps {
  commit: GitCommit;
  isSelected: boolean;
  isGraphMode: boolean;
  onSelect: (commit: GitCommit) => void;
  onAction: (action: string, commit: GitCommit, extra?: any) => void;
  onToggleFile: (commitHash: string, file: GitCommitFile) => void;
  isExpandedFile: (commitHash: string, filePath: string) => boolean;
  isLoadingFile: (commitHash: string, filePath: string) => boolean;
  isFullContextFile: (commitHash: string, filePath: string) => boolean;
  onToggleContext: (commitHash: string, file: GitCommitFile) => void;
  fileDiffs: Record<string, string>;
  headerRef?: (el: HTMLDivElement | null) => void;
}

export function CommitRow({
  commit,
  isSelected,
  isGraphMode,
  onSelect,
  onAction,
  onToggleFile,
  isExpandedFile,
  isLoadingFile,
  isFullContextFile,
  onToggleContext,
  fileDiffs,
  headerRef,
}: CommitRowProps) {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  // A one-line commit has no body, so there is nothing to expand — and no
  // affordance is drawn, because a chevron that opens an empty block reads as
  // a broken row.
  const body = commit.body?.trim() ?? '';
  const hasBody = body.length > 0;

  const handleCopyHash = (e: globalThis.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(commit.hash);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleToggleFile = (e: TargetedMouseEvent<HTMLElement>, file: GitCommitFile) => {
    e.stopPropagation();
    onToggleFile(commit.hash, file);
  };

  // Clicking the row still selects it for the action strip, and additionally
  // opens the full message — the body is what the subject alone never shows.
  // A click that ends a text selection must not count: copying the message out
  // of an open body would otherwise collapse the very block being read.
  const handleRowClick = () => {
    onSelect(commit);
    if (!hasBody) return;
    const selection = globalThis.getSelection?.();
    if (selection && !selection.isCollapsed) return;
    setIsExpanded((prev) => !prev);
  };

  return (
    <div
      onClick={handleRowClick}
      data-testid="commit-row"
      data-commit-hash={commit.hash}
      className={`border-b border-ink/5 transition-colors cursor-pointer ${
        isSelected ? 'bg-ink/[0.03]' : 'hover:bg-ink/[0.015]'
      }`}
    >
      <div className="py-2.5 pr-4 pl-1 flex flex-col">
        {/* Commit Header Line */}
        <div className="flex flex-col gap-1">
          {/* Ref tags / Branch badges */}
          {commit.refs && commit.refs.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pb-0.5">
              {commit.refs.map((refTag, idx) => {
                const isStash = refTag.includes('stash');
                const isHead = refTag.includes('HEAD') || refTag.includes('main') || refTag.includes('master');
                return (
                  <span
                    key={idx}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono border ${
                      isStash
                        ? 'bg-warning/10 text-warning border-warning/25 font-semibold'
                        : isHead
                        ? 'bg-ink/10 text-ink font-semibold border-ink/20'
                        : 'bg-canvas text-meta border-ink/10 font-medium'
                    }`}
                  >
                    {refTag}
                  </span>
                );
              })}
            </div>
          )}

          {/* Subject message (Node dot anchor) */}
          <div
            ref={headerRef}
            className="flex items-start gap-1.5"
          >
            {/* `data-commit-title` is the anchor the graph node is aligned
                against, and it has to be on the SUBJECT: the changed-file rows
                below carry `flex-1` spans of their own, so "the flex-1 span in
                this row" resolves to two elements — measured, and a locator
                that picks the first is a locator that silently measures a
                different element the day the row is reordered. */}
            <span
              data-commit-title=""
              className="text-[13px] font-semibold text-ink leading-snug break-words flex-1 min-w-0"
            >
              {commit.message}
            </span>
            {hasBody && (
              <span
                className="text-ink/40 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              >
                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </span>
            )}
          </div>

          {/* Full commit message body — the subject alone hides it */}
          {hasBody && isExpanded && (
            <div className="text-[12px] text-ink/70 leading-relaxed whitespace-pre-wrap break-words border-l-2 border-ink/15 pl-2.5 py-0.5 font-mono">
              {body}
            </div>
          )}

          {/* Metadata line: Author • Date • Hash with copy button */}
          <div className="flex items-center gap-2 text-[11px] text-ink/50 font-mono flex-wrap">
            <span>{commit.author}</span>
            <span>•</span>
            <span>{commit.date}</span>
            <span>•</span>
            <button
              type="button"
              onClick={handleCopyHash}
              title="Copy commit hash"
              className="inline-flex items-center gap-1 hover:text-ink transition-colors cursor-pointer text-ink/70"
            >
              <span>{commit.shortHash}</span>
              {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
            </button>
          </div>
        </div>

        {/* Action buttons (always visible when selected, or in graph mode when selected) */}
        {(isSelected || isGraphMode) && (
          <div className="mt-2">
            <CommitActions commit={commit} onAction={onAction} />
          </div>
        )}

          {/* Changed Files List */}
        {commit.files && commit.files.length > 0 && (
          <div className="mt-2 flex flex-col gap-1">
            {commit.files.map((file, fileIdx) => {
              const isExpanded = isExpandedFile(commit.hash, file.file);
              const diffKey = `${commit.hash}:${file.file}`;
              const activeDiff = fileDiffs[diffKey] !== undefined ? fileDiffs[diffKey] : file.diff;
              const isLoading = isLoadingFile(commit.hash, file.file);

              const statusColor =
                file.status === 'A'
                  ? 'text-success font-bold'
                  : file.status === 'D'
                  ? 'text-error font-bold'
                  : file.status === 'R'
                  ? 'text-meta font-bold'
                  : 'text-info font-bold';

              return (
                <div key={fileIdx} className="flex flex-col">
                  <div
                    onClick={(e) => handleToggleFile(e, file)}
                    className="flex items-center gap-2 py-1 px-2 rounded hover:bg-ink/5 text-[11.5px] font-mono text-ink/80 transition-colors group cursor-pointer border border-transparent hover:border-ink/10"
                  >
                    {/* Status badge: M / A / D */}
                    <span className={`w-3.5 text-center flex-shrink-0 text-[11px] ${statusColor}`}>
                      {file.status || 'M'}
                    </span>

                    {/* File Path */}
                    <span className="truncate flex-1 min-w-0 text-ink/90 group-hover:text-ink font-medium">
                      {file.file}
                    </span>

                    {/* Stats: +3 / -2 */}
                    <span className="flex items-center gap-1 text-[10.5px] tabular-nums flex-shrink-0 font-medium">
                      <span className="text-success">+{file.additions}</span>
                      <span className="text-ink/30">/</span>
                      <span className="text-error">-{file.deletions}</span>
                    </span>

                    {/* Expand icon */}
                    <span className="text-ink/40 group-hover:text-ink flex-shrink-0">
                      {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                    </span>
                  </div>

                  {/* Inline Diff Viewer when expanded */}
                  {isExpanded && (
                    <div className="pl-4 pr-1">
                      <CommitDiffViewer
                        diffText={activeDiff}
                        isLoading={isLoading}
                        filePath={file.file}
                        fullContext={isFullContextFile(commit.hash, file.file)}
                        onToggleContext={() => onToggleContext(commit.hash, file)}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
