import type { TargetedMouseEvent } from 'preact';
import { useState } from 'preact/hooks';
import { Check, ChevronDown, ChevronRight, Copy } from 'lucide-preact';
import type { GitCommit, GitCommitFile } from '@kabmo-labs/kabmo-app-contracts/git';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import { CommitActions } from '@/client/components/workspace/git-panel/commit-modal/CommitActions';
import { CommitDiffViewer } from '@/client/components/workspace/git-panel/commit-modal/CommitDiffViewer';

interface CommitRowProps {
  commit: GitCommit;
  /**
   * Whether this row's detail is open — the only state that reveals it.
   *
   * One row at a time belongs to the modal, and it starts with NONE open: the
   * history is a list to scan, and a pre-expanded first row pushes every other
   * commit down before the reader has asked for anything.
   */
  isExpanded: boolean;
  /** Clicking the row opens it, and clicking it again closes it. */
  onToggleExpand: () => void;
  onAction: (action: string, commit: GitCommit) => void;
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
  isExpanded,
  onToggleExpand,
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
  // Expansion is the row's own detail state and the row is its only toggle:
  // the modal owns WHICH row is open, so a click cannot leave the file list on
  // a row the header says is closed. Clicking an open row closes it, which is
  // the affordance the chevron promises.
  const body = commit.body?.trim() ?? '';
  const hasBody = body.length > 0;
  const files = commit.files ?? [];
  const fileCount = files.length;
  const hasFiles = fileCount > 0;
  const expandable = hasBody || hasFiles;

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

  // A one-line commit with no changed files has nothing to open, so it is not
  // a toggle at all: a click that marked it "expanded" would light its graph
  // node and change nothing else.
  const rowClassName = expandable
    ? 'border-b border-ink/5 transition-colors cursor-pointer hover:bg-ink/[0.015]'
    : 'border-b border-ink/5';

  return (
    <div
      onClick={expandable ? onToggleExpand : undefined}
      data-testid="commit-row"
      data-commit-hash={commit.hash}
      className={rowClassName}
    >
      <div className="py-2.5 flex flex-col">
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
                        ? 'bg-warning/10 text-ink/80 border-warning/25 font-semibold'
                        : isHead
                        ? 'bg-ink/10 text-ink font-semibold border-ink/20'
                        : 'bg-canvas text-muted border-ink/10 font-medium'
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
            <button
              type="button"
              onClick={
                expandable
                  ? (e) => {
                      e.stopPropagation();
                      onToggleExpand();
                    }
                  : undefined
              }
              aria-expanded={expandable ? isExpanded : undefined}
              className="flex flex-1 min-w-0 items-start gap-1.5 text-left cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20"
            >
              <span
                data-commit-title=""
                className="text-[13px] font-semibold text-ink leading-snug break-words flex-1 min-w-0"
              >
                {commit.message}
              </span>
              {expandable && (
                <span className="text-ink/55 flex-shrink-0 mt-0.5" aria-hidden="true">
                  {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
              )}
            </button>
          </div>

          {/* Full commit message body, rendered as markdown for the open commit */}
          {hasBody && isExpanded && (
            <div className="border-l-2 border-ink/15 pl-3 py-1">
              <MarkdownRenderer content={body} className="text-ink/70" />
            </div>
          )}

          {/* Metadata line: author, date, hash with copy button, file count */}
          <div className="flex items-center gap-x-2 gap-y-0.5 text-[11px] text-muted font-mono flex-wrap">
            <span>{commit.author}</span>
            <span>{commit.date}</span>
            <button
              type="button"
              onClick={handleCopyHash}
              title="Copy commit hash"
              aria-label={`Copy commit hash ${commit.shortHash}`}
              className="inline-flex items-center gap-1 hover:text-ink transition-colors cursor-pointer text-ink/70"
            >
              <span>{commit.shortHash}</span>
              {copied ? <Check size={11} className="text-success-text" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
            </button>
            {hasFiles && (
              /* The collapsed row still says how much the commit touched,
                 so the file list being closed is a choice, not a surprise. */
              <span>{fileCount} {fileCount === 1 ? 'file' : 'files'}</span>
            )}
          </div>
        </div>

        {/* Action buttons belong to the open row only. Rendering them on
            every row in graph mode turned the list into a wall of buttons and
            buried the topology the mode exists to show. */}
        {isExpanded && (
          <div className="mt-2">
            <CommitActions commit={commit} onAction={onAction} />
          </div>
        )}

          {/* Changed Files List, shown for the open commit */}
        {hasFiles && isExpanded && (
          <div className="mt-2 flex flex-col gap-1">
            {files.map((file, fileIdx) => {
              const fileExpanded = isExpandedFile(commit.hash, file.file);
              const diffKey = `${commit.hash}:${file.file}`;
              const activeDiff = fileDiffs[diffKey] !== undefined ? fileDiffs[diffKey] : file.diff;
              const isLoading = isLoadingFile(commit.hash, file.file);

              const statusColor =
                file.status === 'A'
                  ? 'text-success-text font-bold'
                  : file.status === 'D'
                  ? 'text-error-text font-bold'
                  : file.status === 'R'
                  ? 'text-meta-text font-bold'
                  : 'text-info-text font-bold';

              return (
                <div key={fileIdx} className="flex flex-col">
                  <button
                    type="button"
                    onClick={(e) => handleToggleFile(e, file)}
                    aria-expanded={fileExpanded}
                    className="flex w-full items-center gap-2 py-1 px-2 rounded text-[11.5px] font-mono text-ink/80 transition-colors group cursor-pointer border border-transparent hover:border-ink/10 text-left"
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
                      <span className="text-success-text">+{file.additions}</span>
                      <span className="text-ink/30">/</span>
                      <span className="text-error-text">-{file.deletions}</span>
                    </span>

                    {/* Expand icon */}
                    <span className="text-ink/55 group-hover:text-ink flex-shrink-0">
                      {fileExpanded ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                    </span>
                  </button>

                  {/* Inline Diff Viewer when expanded */}
                  {fileExpanded && (
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
