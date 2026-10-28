/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * A change's files and commits, folded.
 *
 * Both are COLLAPSED by default and each carries its own count in the header,
 * because the reason to open a change is usually its description and its
 * conversation — the diff is what you scroll to when you are reviewing, not what
 * you read first. A file row shows its path, its status and its counts; the hunk
 * text is rendered as a `<pre>` only when the row is opened, because a
 * twenty-file change would otherwise mount twenty code blocks nobody asked for.
 *
 * The disclosure is the panel's own (`▸`/`▾` in a fixed track, `aria-expanded`,
 * body mounted and `inert` while closed) — the same control the git panel's
 * sections and the command runner's rows use, so a reader learns it once.
 *
 * A file with no hunks is a BINARY change: it is listed with its name and status
 * and nothing to expand, because a code block over `Binary files differ` reads as
 * a broken diff.
 */

import { useState } from 'preact/hooks';
import type { ForgeCommit, ForgeFile } from '../protocol';
import { Glyph, ICON } from './Glyph';
import { relativeTime } from './format';

/** A `+n −n` pair, with the sign that matters for an empty side dropped. */
function Counts({ additions, deletions }: { additions: number; deletions: number }) {
  return (
    <span className="flex flex-shrink-0 items-center gap-1 font-mono text-[10px]">
      {additions > 0 && <span className="text-success">+{additions}</span>}
      {deletions > 0 && <span className="text-error">−{deletions}</span>}
    </span>
  );
}

/** The status word, shortened to what fits a row. */
const STATUS: Record<string, string> = {
  added: 'new',
  removed: 'gone',
  renamed: 'moved',
  modified: 'changed',
};

function FileRow({ file }: { file: ForgeFile }) {
  const [open, setOpen] = useState(false);
  const bodyId = `forge-file-${file.path.replace(/[^a-z0-9]+/gi, '-')}`;
  // A binary change has no hunk to show, so it has no disclosure either.
  const expandable = file.patch.trim().length > 0;

  return (
    <div className="border-b border-ink/8 last:border-b-0">
      <div className="flex items-center gap-1.5 px-2.5 py-1">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          aria-controls={expandable ? bodyId : undefined}
          aria-label={`${file.path}, ${STATUS[file.status] ?? file.status}`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left disabled:cursor-default"
        >
          <span aria-hidden="true" className="w-3 flex-shrink-0 font-mono text-ink/40">
            {expandable ? (open ? '▾' : '▸') : ''}
          </span>
          <Glyph path={ICON.file} size={10} />
          <span className="min-w-0 truncate font-mono text-[10.5px] text-ink/80">{file.path}</span>
        </button>
        <span className="flex-shrink-0 text-[9.5px] uppercase tracking-wider text-ink/40">
          {STATUS[file.status] ?? file.status}
        </span>
        <Counts additions={file.additions} deletions={file.deletions} />
      </div>
      {expandable && (
        <div id={bodyId} data-expanded={open} inert={!open} className="section-reveal">
          <div className="min-h-0 overflow-hidden">
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all bg-canvas/60 px-2.5 py-1.5 font-mono text-[10px] leading-[1.35] text-ink/75">
              {file.patch}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: preact.ComponentChildren;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = `forge-section-${title.toLowerCase()}`;
  return (
    <div className="border-t border-ink/10">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        className="flex w-full items-center gap-1.5 px-2.5 py-1 text-left"
      >
        <span aria-hidden="true" className="w-3 flex-shrink-0 font-mono text-ink/40">
          {open ? '▾' : '▸'}
        </span>
        <span className="text-[9.5px] font-semibold uppercase tracking-wider text-ink/40">{title}</span>
        <span className="font-mono text-[10px] text-ink/40">{count}</span>
      </button>
      <div id={bodyId} data-expanded={open} inert={!open} className="section-reveal">
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

export function ChangeFiles({ files }: { files: readonly ForgeFile[] }) {
  if (files.length === 0) return null;
  return (
    <Section title="Files" count={files.length}>
      {files.map((file) => (
        <FileRow key={file.path} file={file} />
      ))}
    </Section>
  );
}

export function ChangeCommits({ commits }: { commits: readonly ForgeCommit[] }) {
  if (commits.length === 0) return null;
  return (
    <Section title="Commits" count={commits.length}>
      {commits.map((commit) => (
        <div key={commit.sha} className="flex items-baseline gap-1.5 border-b border-ink/8 px-2.5 py-1 last:border-b-0">
          <Glyph path={ICON.commit} size={10} />
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink/80" title={commit.message}>
            {commit.message}
          </span>
          <span className="flex-shrink-0 font-mono text-[9.5px] text-ink/40">{commit.sha.slice(0, 7)}</span>
          <span className="flex-shrink-0 text-[9.5px] text-ink/40">{relativeTime(commit.at)}</span>
        </div>
      ))}
    </Section>
  );
}
