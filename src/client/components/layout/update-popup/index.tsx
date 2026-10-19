/**
 * The "an update is available" popup.
 *
 * Shown automatically ONCE PER VERSION: the version check already runs on mount
 * (see `useUpdates`), and this dialog is the place where its verdict is acted on
 * — the footer's update dot said something was available, and without this the
 * user had to open About to find out what. `omp_update_popup_version` records the
 * version that has been announced, so the same release never interrupts twice
 * while the next one still announces itself.
 *
 * It opens only when a check has actually reported an update, and the release
 * range is fetched AFTER that gate — a normal boot with nothing to announce
 * makes no GitHub request for this.
 *
 * The dialog is mounted by whichever layout is on screen (desktop and mobile
 * sidebars both own it, as they own the About modal), and the latch is read from
 * SQLite rather than held in memory, so the two cannot both announce a version.
 */

import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Download, RefreshCw, Sparkles } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import { Actions } from '@/client/components/layout/update-popup/Actions';
import { ReleaseNotes } from '@/client/components/layout/update-popup/ReleaseNotes';
import { useUpdateChangelog } from '@/client/hooks/ui/updates/changelog';
import type { UseUpdatesResult } from '@/client/hooks/ui/updates';
import { useKabmoEvent } from '@/client/hooks/ui/window-event';
import { markAnnounced, shouldAnnounce, UPDATE_POPUP_OPEN_EVENT, UPDATE_REQUEST_EVENT } from '@/shared/lib/updates/popup-state';

export interface UpdatePopupProps {
  updates: UseUpdatesResult;
}

export function UpdatePopup({ updates }: UpdatePopupProps) {
  // A manual open bypasses the latch: the user asked to see the notes again.
  const [manualOpen, setManualOpen] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  // The version this instance has already handled. A ref, not state: a re-render
  // (a toast, a sidebar refresh) must not re-run the latch, and two sidebar
  // instances must not both announce the same version — the second read sees the
  // marker `markAnnounced` already wrote, because the settings snapshot is
  // updated synchronously. Holding the VERSION rather than a boolean is what
  // lets a release that lands mid-session still announce itself.
  const announcedRef = useRef<string | null>(null);

  useKabmoEvent(UPDATE_POPUP_OPEN_EVENT, () => setManualOpen(true));

  const latest = updates.info?.kabmo.latest ?? null;
  const available = Boolean(updates.info?.kabmo.updateAvailable && latest);

  useEffect(() => {
    if (!available || !latest || announcedRef.current === latest) return;
    announcedRef.current = latest;
    if (!shouldAnnounce(latest)) return;

    // Written when the popup is SHOWN, not when it is dismissed: a reload while
    // it is open must not announce the same release again, which is what "once"
    // means to the user. The notes stay reachable from the About modal.
    markAnnounced(latest);
    setAutoOpen(true);
  }, [available, latest]);

  const open = manualOpen || autoOpen;
  const changelog = useUpdateChangelog(open);

  if (!open) return null;

  const data = changelog.data;
  const from = data?.current ?? updates.info?.kabmo.current ?? null;
  const to = data?.latest ?? latest;

  // Rendered through a portal, and that is load-bearing on BOTH layouts: the
  // desktop sidebar lives inside a panel that collapses to `width: 0` with
  // `overflow: hidden`, and the phone's sidebar lives in a screen the drawer
  // hides with `display: none`. A `position: fixed` subtree under either one is
  // clipped or not laid out at all — measured on the phone, the dialog had a
  // 0x0 box and never appeared. `document.body` is outside every such ancestor.
  const close = () => {
    setAutoOpen(false);
    setManualOpen(false);
  };

  // The run belongs to the About modal, so the popup closes and asks for it
  // rather than starting a second copy here. Ordering matters: the event is
  // dispatched after this dialog is gone, or About would open under the popup's
  // own backdrop.
  const requestUpdate = () => {
    close();
    window.dispatchEvent(new CustomEvent(UPDATE_REQUEST_EVENT));
  };

  return createPortal(
    <Modal
      onClose={close}
      zClass="z-[65]"
      maxWidthClass="max-w-[560px]"
      header={
        <div className="flex items-center gap-3 min-w-0">
          <Sparkles size={16} className="shrink-0 text-ink/70" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">Update available</h2>
            <p className="font-mono text-[11px] text-ink/50 truncate">
              {from ? `v${from} → ` : ''}v{to ?? '…'}
            </p>
          </div>
        </div>
      }
      footer={<Actions data={data} updates={updates} onClose={close} onRequestUpdate={requestUpdate} />}
    >
      <div className="px-5 py-4">
        {changelog.loading && (
          <p className="flex items-center gap-2 text-[11px] text-ink/50">
            <RefreshCw size={12} className="animate-spin motion-reduce:animate-none" />
            <span>Loading release notes…</span>
          </p>
        )}

        {!changelog.loading && changelog.error && (
          <div className="flex items-start gap-2">
            <Download size={14} className="mt-0.5 shrink-0 text-ink/40" />
            <p className="text-[11px] leading-4 text-ink/60">{changelog.error}</p>
          </div>
        )}

        {!changelog.loading && data && data.versions.length > 0 && <ReleaseNotes data={data} />}
      </div>
    </Modal>,
    document.body,
  );
}
