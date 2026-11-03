/**
 * The release range, drawn as one section per version.
 *
 * Each section is the version's `CHANGELOG.md` section, read from the repository
 * file by the server — the same prose the GitHub release body carries — rendered
 * through the app's own markdown pipeline, so links, bold labels and commit
 * hashes look the same here as they do in a chat message. The section's own
 * heading was consumed by the parser (it names the version and the date the
 * heading carried), so what arrives here is the prose below it.
 */

import type { TargetedMouseEvent } from 'preact';
import { ExternalLink } from 'lucide-preact';
import { MarkdownRenderer } from '@/client/components/common/MarkdownRenderer';
import type { ReleaseNote, UpdateChangelog } from '@/shared/types/updates';

const LINK_CLASS = 'inline-flex items-center gap-1 text-[10px] font-medium text-ink/50 hover:text-ink transition-colors';

/**
 * A changelog body is full of links — commits, compare ranges, pull requests.
 * Without this, one click navigates the console away from the user's session;
 * a release note is a reference, so every link leaves in a new tab.
 *
 * Exported because the About modal's per-target dialog renders a single section
 * through the same handler; a second copy would let one path navigate in place.
 */
export function openLinksExternally(event: TargetedMouseEvent<HTMLDivElement>) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link) return;
  event.preventDefault();
  event.stopPropagation();
  window.open(link.href, '_blank', 'noopener,noreferrer');
}

export function ReleaseSection({ note }: { note: ReleaseNote }) {
  return (
    <article className="border-t border-ink/10 pt-4 first:border-t-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-[13px] font-semibold text-ink">v{note.version}</h3>
          {note.date && <p className="font-mono text-[10px] text-ink/40">{note.date}</p>}
        </div>
        {note.url && (
          <a href={note.url} target="_blank" rel="noopener noreferrer" className={`${LINK_CLASS} shrink-0`}>
            <ExternalLink size={11} />
            <span>Release</span>
          </a>
        )}
      </header>
      {/* `text-[13px]`, not the 12px a narrow column needed: at this width the
          smaller size left lines too short to read as prose. */}
      {note.body ? (
        <MarkdownRenderer content={note.body} className="mt-2 text-[13px]" />
      ) : (
        <p className="mt-2 text-[11px] text-ink/40">This release was published without notes.</p>
      )}
    </article>
  );
}

export function ReleaseNotes({ data }: { data: UpdateChangelog }) {
  return (
    <div className="space-y-4" onClick={openLinksExternally}>
      {data.truncated && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink/50">
          <span>
            Showing the {data.versions.length} newest of {data.total} releases since v{data.current}.
          </span>
          {data.releaseUrl && (
            <a href={data.releaseUrl} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
              <span>Full changelog</span>
              <ExternalLink size={11} />
            </a>
          )}
        </p>
      )}
      {data.versions.map((note) => (
        <ReleaseSection key={note.version} note={note} />
      ))}
    </div>
  );
}
