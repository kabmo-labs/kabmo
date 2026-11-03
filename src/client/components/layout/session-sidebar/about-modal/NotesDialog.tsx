/**
 * One product's changelog for the version that is RUNNING, opened from About.
 *
 * The About modal's pair of buttons answer "what am I running" — the update
 * popup answers "what would I get" — so this dialog renders exactly one section,
 * taken from the install's own version by the server. It sits above About rather
 * than replacing it, and `z-[65]` keeps it above the update popup's layer for the
 * case where both are reachable at once.
 */

import { createPortal } from 'preact/compat';
import { AlertCircle, ExternalLink, RefreshCw, Sparkles } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { openLinksExternally, ReleaseSection } from '@/client/components/layout/update-popup/ReleaseNotes';
import { useActiveReleaseNotes } from '@/client/hooks/ui/updates/notes';
import type { UpdateTarget } from '@/shared/types/updates';

export interface NotesDialogProps {
  target: UpdateTarget;
  onClose: () => void;
}

const PRODUCT: Record<UpdateTarget, string> = { kabmo: 'Kabmo', omp: 'Oh-My-Pi' };

export function NotesDialog({ target, onClose }: NotesDialogProps) {
  const notes = useActiveReleaseNotes(target);
  const data = notes.data;
  const product = PRODUCT[target];
  const version = data?.version ?? null;
  // "installed" vs "running" names where the version came from: a package on
  // disk for Kabmo, the live `omp` binary for Oh-My-Pi. Both are this machine's.
  const origin = target === 'omp' ? 'running' : 'installed';

  return createPortal(
    <Modal
      onClose={onClose}
      zClass="z-[65]"
      // A single release's notes are long prose — commit subjects, long PR and
      // contributor names, 60+ wrapped list items in omp's case. At 560px the
      // body was 542px of column and a release ran past 1900px of scroll, so the
      // width is the reader's cost. 768px is the widest panel that still wraps
      // those items once instead of three times while staying under a prose
      // measure a reader can track; `max-h-full` keeps it inside a phone's
      // viewport, where the body scrolls.
      maxWidthClass="max-w-3xl"
      ariaLabel={`What is new in ${product}`}
      header={
        <div className="flex min-w-0 items-center gap-3">
          <Sparkles size={16} className="shrink-0 text-ink/70" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">What&apos;s new in {product}</h2>
            <p className="truncate font-mono text-[11px] text-ink/50">
              {version ? `v${version} · ${origin}` : `${origin} version…`}
            </p>
          </div>
        </div>
      }
      footer={
        data?.changelogUrl ? (
          <div className="border-t border-ink/10 px-5 py-3">
            <a
              href={data.changelogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-ink/60 transition-colors hover:text-ink"
            >
              <span>Full changelog</span>
              <ExternalLink size={11} />
            </a>
          </div>
        ) : undefined
      }
    >
      <div className="px-5 py-4" onClick={openLinksExternally}>
        {notes.loading && (
          <p className="flex items-center gap-2 text-[11px] text-ink/50">
            <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
            <span>Loading release notes…</span>
          </p>
        )}

        {!notes.loading && notes.error && (
          <div className="flex items-start gap-2">
            <AlertCircle size={14} className="mt-0.5 shrink-0 text-ink/40" />
            <p className="text-[11px] leading-4 text-ink/60">{notes.error}</p>
          </div>
        )}

        {!notes.loading && data?.note && <ReleaseSection note={data.note} />}
      </div>
    </Modal>,
    document.body,
  );
}