import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Heart, X } from 'lucide-preact';
import packageJson from '@/../package.json';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import type { ToastTone } from '@/shared/lib/ui/toast-duration';
import { BrandWordmark } from '@/client/components/common/brand-wordmark';
import { NotesDialog } from '@/client/components/layout/session-sidebar/about-modal/NotesDialog';
import { SocialLinks } from '@/client/components/layout/session-sidebar/about-modal/SocialLinks';
import { UpdateSection } from '@/client/components/layout/session-sidebar/about-modal/UpdateSection';
import { VersionLine } from '@/client/components/layout/session-sidebar/about-modal/VersionLine';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { useHarnesses } from '@/client/hooks/models/use-harnesses';
import { HarnessTable, harnessCategoryFor } from '@/client/components/layout/session-sidebar/about-modal/HarnessTable';
import { useHarnessVersions } from '@/client/hooks/models/use-harness-versions';
import { useHarnessUpdate } from '@/client/hooks/models/use-harness-update';
import { UpdateLogDialog } from '@/client/components/layout/session-sidebar/about-modal/UpdateLogDialog';
import { useDialogBehaviour } from '@/client/hooks/ui/dialog-behaviour';
import { UPDATE_POPUP_OPEN_EVENT } from '@/shared/lib/updates/popup-state';
import type { UpdateTarget } from '@/shared/types/updates';
import { MAX_WIDTH as CARD_MAX_WIDTH } from '@/client/components/workspace/model-dropdown/popover-metrics';
import { safeAreaPadding } from '@/shared/lib/ui/safe-area';

export interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
  updates: UseUpdatesResult;
  onToast?: (message: string, type?: ToastTone) => void;
}

export function AboutModal({ isOpen, onClose, updates, onToast }: AboutModalProps) {
  // Which product's "what am I running" notes are open. The dialog draws above
  // this panel instead of replacing it, so closing it returns here.
  const [notesTarget, setNotesTarget] = useState<UpdateTarget | null>(null);
  // The update log panel, opened for a harness id.
  // The About sheet is a dialog to assistive tech and to the keyboard. It had
  // neither: measured in the running console it carried no `role`, no
  // `aria-modal`, and Escape did nothing while focus sat inside it.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useDialogBehaviour(panelRef, { open: isOpen, onClose });
  // The SAME shared store the composer's tab strip and Settings read, so a probe
  // made in either appears here without a reload.
  const { harnesses, isLoading: harnessesLoading } = useHarnesses();
  const versions = useHarnessVersions();
  // The rows name what is on disk NOW. A run that settled while the card was
  // closed — or a probe that answered after the last read — leaves the shared
  // store holding the number the update replaced, and its `loaded` flag makes a
  // remount skip the read. Re-reading on OPEN is what makes "updated" and the
  // version beside it agree; it does not force the registry, so the cheap path.
  const refreshVersions = versions.refresh;
  useEffect(() => {
    if (isOpen) refreshVersions();
  }, [isOpen, refreshVersions]);
  // Which harness's log is open. The run is a background worker and there can be
  // MORE THAN ONE record (one installing, one waiting its turn), so the panel is
  // opened for a harness id and renders THAT harness's record.
  const [logHarness, setLogHarness] = useState<string | null>(null);
  // Which harnesses have a record — installing, waiting, or settled. The run is a
  // BACKGROUND worker, so this hook also ADOPTS runs that are still going when
  // the card opens — a reload no longer loses an update's state.
  const update = useHarnessUpdate(
    (message, ok) => {
      // The hook re-reads the version rows itself once a run settles (the update
      // forgot the cached probe), so what is left here is telling the user what
      // happened. The row will still read the OLD number until the agent is
      // probed again, and saying otherwise would be a claim Kabmo cannot stand
      // behind.
      onToast?.(message, ok ? 'success' : 'error');
    },
    { enabled: isOpen },
  );

  // "What's new" opens the popup, which draws at a higher layer: leaving this
  // dialog mounted would stack two modals over the same subject, and its
  // backdrop would swallow the popup's clicks.
  useKabmoEvent(UPDATE_POPUP_OPEN_EVENT, () => {
    if (isOpen) onClose();
  });

  if (!isOpen) return null;

  // The record the open log panel renders. Looked up per harness, so a settled
  // row keeps its log while another harness installs.
  const logJob = logHarness ? update.jobs.find((job) => job.harness === logHarness) ?? null : null;

  // Rendered through a portal, for the reason the update popup is: this dialog
  // is mounted inside whichever sidebar is on screen, and that sidebar is not
  // always laid out — the phone's drawer hides its whole screen with
  // `display: none`, and the desktop panel collapses to `width: 0` with
  // `overflow: hidden`. A `position: fixed` subtree under either one is clipped
  // or has no box at all. That mattered the moment the update popup started
  // handing its run over to this dialog: it opens over the chat, with the drawer
  // closed, and was invisible.
  return createPortal(
    <>
      {/* ONE centered card at both sizes, sized like the composer's model
          picker: the phone gets its own width cap (the popover's 512px) instead
          of the whole screen, and the card is as TALL as its content up to the
          space the safe area leaves — so nothing hides under the status bar or
          the home indicator, and a short card never asks for a scroll.

          Full-bleed on a phone was the bug: `h-full w-full` with no gutters put
          the header at the viewport's top edge, which a `viewport-fit: cover`
          surface draws UNDER the phone's status bar. The scrim's padding is
          `safeAreaPadding` — one rule, shared with the `Modal` shell. The
          desktop keeps its FIXED 880px two-column card. */}
      <div
        className="fixed inset-0 modal-scrim z-50 flex items-center justify-center md:backdrop-blur-[2px] animate-in fade-in duration-200"
        style={safeAreaPadding()}
        onClick={onClose}
      >
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="About Kabmo"
          tabIndex={-1}
          // A FIXED desktop width, not `w-auto`: the card is sized by its content
          // when auto, so narrowing any one column shrank the whole dialog
          // (measured when the action column went to an icon). 880px is what the
          // two-column table needs with room for the widest agent name.
          //
          // The phone cap is the MODEL PICKER's own width (`MAX_WIDTH`), so the
          // console's two floating cards are one size class; `min(…, 100%)` keeps
          // a 320px phone from overflowing the backdrop padding.
          className="glass-overlay relative flex max-h-full w-full max-w-[var(--about-card-max)] flex-col overflow-hidden rounded-2xl border border-ink/15 bg-paper text-ink shadow-2xl select-none md:w-[880px] md:max-w-[calc(100vw-3rem)] md:max-h-[92vh]"
          style={{ '--about-card-max': `min(${CARD_MAX_WIDTH}px, 100%)` }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close Button */}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 z-10 rounded-md p-1.5 text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink md:right-4 md:top-4"
            aria-label="Close"
          >
            <X size={18} className="stroke-[2.5]" />
          </button>

          {/* ONE scroller for the WHOLE card, at both sizes: the harness table
              used to cap itself at `46vh` and scroll on a phone while the card
              still had most of the screen empty below it. The body is the only
              place a scroll can happen now, and only when the content genuinely
              outgrows the card. On a desktop the card sizes itself to the content
              instead of asking the reader to scroll a dialog. */}
          <div className="min-h-0 flex-1 scrollbar-overlay-container overflow-y-auto p-5 md:flex-none md:overflow-visible md:p-6">
            <header className="flex items-center gap-3 pr-10">
              <img src="/icon.svg" alt="Kabmo" width={44} height={44} draggable={false} />
              <div className="min-w-0">
                <h2 className="flex items-center text-lg font-bold tracking-tight">
                  <BrandWordmark className="text-lg" />
                </h2>
                {/* Version lines: each circle-i opens the release notes for the
                    version that is RUNNING; the updates section answers what an
                    update would install. */}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px] text-ink/55">
                  <VersionLine
                    label={`Kabmo v${packageJson.version}`}
                    notesLabel="What's new in Kabmo"
                    onNotes={() => setNotesTarget('kabmo')}
                  />
                  <VersionLine
                    label={`Oh-My-Pi ${updates.info?.omp.current ?? '…'}`}
                    notesLabel="What's new in Oh-My-Pi"
                    onNotes={() => setNotesTarget('omp')}
                  />
                </div>
              </div>
            </header>

            {/* The AGENTS own the card's width in a two-column list; the update
                controls and links sit in ONE merged strip under them. A rail
                beside the table was tried and measured: it squeezed each row's
                three cells into 280px while the rail held two short blocks, so
                the content paid for the sidebar. */}
            <div className="mt-5">
              <HarnessTable
                harnesses={harnesses}
                versions={versions.rows}
                loading={harnessesLoading}
                onUpdate={update.start}
                jobs={update.jobs}
                onOpenLog={setLogHarness}
                onOpenHarness={(id) => {
                  onClose();
                  // The settings modal is the frame that owns harness pages; the
                  // dispatcher is its opener, so About does not need a reference
                  // to it (and cannot hold a stale one).
                  window.dispatchEvent(new CustomEvent('omp:open-settings', {
                    detail: { category: harnessCategoryFor(id) },
                  }));
                }}
              />
            </div>

            {/* ONE stacked strip, as it has always been: the Kabmo-side update
                controls, then the project's links directly UNDER them. Side by
                side was tried and is wrong — the two are different subjects, and
                a reader who wants "check for updates" should not have to decide
                which column it lives in. */}
            {/* No `border-t` here: `UpdateSection` already draws `border-y`, and
                two rules 16px apart read as a mistake. */}
            <div className="mt-5">
              <UpdateSection updates={updates} onToast={onToast} />
              <SocialLinks />
            </div>

            {/* Footer */}
            <p className="mt-6 flex items-center justify-center gap-1.5 border-t border-ink/10 pt-3 text-[11px] font-normal text-ink/50">
              <Heart size={12} className="shrink-0 fill-current text-error" aria-hidden="true" />
              Made with love for the community
            </p>
          </div>
        </div>
      </div>
      {/* Sibling of the About backdrop, not a child: an event inside the portal
          would otherwise bubble to that backdrop's `onClick` and close About. */}
      {notesTarget && <NotesDialog target={notesTarget} onClose={() => setNotesTarget(null)} />}
      {/* The log draws ABOVE About and does not replace it — the card it was
          opened from keeps its glanceable state. It is not gated on a run being
          in flight: a finished (or failed) record is what a reader came for, and
          a WAITING one is what says where the queue is. It renders the record of
          the harness whose line was clicked — two runs can exist at once. */}
      {logJob && <UpdateLogDialog job={logJob} onClose={() => setLogHarness(null)} />}
    </>,
    document.body,
  );
}
