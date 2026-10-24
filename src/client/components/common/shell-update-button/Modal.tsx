/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The shell update's dialog: confirm, install, report.
 *
 * ## Why the message lives HERE and not in the footer
 *
 * The footer is a row of controls, one of them 24px wide. A sentence like "Kabmo
 * 0.3.2 installed — restarting" pushed into that row pushed the controls around
 * and read as a status line for the SIDEBAR rather than for the update the user
 * just asked for. The control therefore stays a control, and everything a run has
 * to say — the confirmation before it, the progress during it, the shell's own
 * refusal after it — is a dialog.
 *
 * ## The confirmation is not ceremony
 *
 * The click replaces the app the user is looking at and restarts it. That is not
 * something a 24px glyph should do on a single press with no words, which is why
 * the first thing the dialog says is what will happen and what will be lost
 * (nothing but the window: the servers and the session are the console's own
 * state, and they survive).
 *
 * ## Every phase reports the shell's own words
 *
 * `done` and `error` print the sentence the SHELL sent. Nothing here invents
 * "Update failed": a shell that verified the download and declined knows why, and
 * that reason is the only thing a user can act on.
 */

import { AlertCircle, Check, Download, Loader2 } from 'lucide-preact';
import { Modal } from '@/client/components/common/Modal';
import {
  shellDownloadLabel,
  type ShellDownload,
} from '@/client/hooks/ui/updates/shell-download';
import type { ShellUpdatePhase } from '@/client/hooks/ui/updates/shell-update';

/**
 * What the dialog is showing.
 *
 * `confirm` is the dialog's own phase, not the hook's: the hook's `idle` means "no
 * run has happened", and the dialog is only ever open on a run the user is about to
 * start or one that already ran.
 */
export type ShellUpdateModalPhase = ShellUpdatePhase | 'confirm';

interface ShellUpdateModalProps {
  download: ShellDownload;
  phase: ShellUpdateModalPhase;
  message: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/** What this platform actually does with the artifact, in the platform's terms. */
function installNote(download: ShellDownload): string {
  switch (download.platform) {
    case 'macos':
      return 'Kabmo downloads the new build, checks its signature and replaces itself. The window reopens on the new version.';
    case 'windows':
      return 'Kabmo downloads the new installer and runs it silently. The window closes and reopens on the new version.';
    case 'linux':
      return 'Kabmo downloads the new AppImage over the one it is running from and restarts. A package install (.deb / .rpm) cannot replace itself — that build is offered the release page instead.';
    default:
      return 'Kabmo installs the new build and restarts.';
  }
}

const SECONDARY =
  'rounded-md border border-ink/20 px-3 py-1.5 text-[11px] font-medium text-ink transition-colors hover:border-ink/40 cursor-pointer';
const PRIMARY =
  'inline-flex items-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[11px] font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer';

export function ShellUpdateModal({ download, phase, message, onConfirm, onClose }: ShellUpdateModalProps) {
  const label = shellDownloadLabel(download);

  return (
    <Modal
      onClose={onClose}
      maxWidthClass="max-w-sm"
      header={<h2 className="text-sm font-semibold text-ink">{label}</h2>}
      footer={
        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          {phase === 'confirm' && (
            <>
              <button type="button" className={SECONDARY} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className={PRIMARY} onClick={onConfirm}>
                <Download size={13} />
                <span>Install update</span>
              </button>
            </>
          )}

          {phase === 'working' && (
            <button type="button" className={PRIMARY} disabled>
              <Loader2 size={13} className="animate-spin motion-reduce:animate-none" />
              <span>Installing…</span>
            </button>
          )}

          {phase === 'done' && (
            <button type="button" className={PRIMARY} onClick={onClose}>
              <Check size={13} />
              <span>Close</span>
            </button>
          )}

          {phase === 'error' && (
            <>
              <button type="button" className={SECONDARY} onClick={onClose}>
                Close
              </button>
              {/* Retry re-runs the SAME offer: the release is still the one the
                  console read, and a failure here is the shell's download or its
                  verification, not a stale version. */}
              <button type="button" className={PRIMARY} onClick={onConfirm}>
                <Download size={13} />
                <span>Try again</span>
              </button>
            </>
          )}
        </div>
      }
    >
      <div className="px-5 py-4 space-y-3 text-[11px] leading-5 text-ink/70">
        {phase === 'confirm' && (
          <>
            <p>{installNote(download)}</p>
            <p className="text-ink/50">
              Version {download.latest} · the console keeps running; only this window restarts.
            </p>
          </>
        )}

        {phase === 'working' && (
          <p className="flex items-center gap-2 text-ink">
            <Loader2 size={14} className="animate-spin motion-reduce:animate-none" />
            <span>Downloading and verifying the new build…</span>
          </p>
        )}

        {(phase === 'done' || phase === 'error') && (
          <p
            role="status"
            className={`flex items-start gap-2 ${phase === 'error' ? 'text-error' : 'text-ink'}`}
          >
            {phase === 'error' ? (
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
            ) : (
              <Check size={14} className="mt-0.5 shrink-0" />
            )}
            <span>{message ?? (phase === 'error' ? 'The update failed.' : 'Update installed.')}</span>
          </p>
        )}
      </div>
    </Modal>
  );
}
