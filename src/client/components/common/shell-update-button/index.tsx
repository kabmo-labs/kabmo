/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The native shell's update/install control, shared by both sidebar layouts.
 *
 * ## Two controls, because there are two different jobs
 *
 * - **A link** when the console cannot name a file: a desktop shell that did not
 *   report its architecture, or any offer whose artifact is not installable from
 *   inside. Following it is the browser's (or the WebView's) job.
 * - **A button** when the shell CAN install it: the click opens a CONFIRMATION, and
 *   the confirmation asks the shell to download, verify and replace itself. That is
 *   the desktop self-update, and it is the whole reason this component exists.
 *
 * The decision is `canSelfUpdate`, never a check on the platform at the call site:
 * Android installs through `PackageInstaller` (its own path, unchanged), iOS cannot
 * install at all, and a browser has no shell to ask.
 *
 * ## The control is ONLY a control
 *
 * Every word a run has to say — the confirmation, the progress, the shell's own
 * refusal — is in `Modal.tsx`. The footer is a 24px row of glyphs, and a status
 * sentence pushed into it moved the neighbouring controls and read as a status
 * line for the SIDEBAR rather than for the update.
 *
 * ## The state lives here, not in either footer
 *
 * Both layouts draw this control and each unmounts at a different moment (a phone
 * closes its drawer, a desktop swaps sessions). One hook, one vocabulary of
 * phases, so the two cannot report the same run differently.
 */

import { useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Download, Loader2 } from 'lucide-preact';
import {
  shellDownloadLabel,
  shellDownloadShortLabel,
  type ShellDownload,
} from '@/client/hooks/ui/updates/shell-download';
import { canSelfUpdate, useShellUpdate } from '@/client/hooks/ui/updates/shell-update';
import { ShellUpdateModal } from '@/client/components/common/shell-update-button/Modal';

interface ShellUpdateButtonProps {
  download: ShellDownload;
  /** `icon` for the desktop footer's glyph row, `label` for the phone's. */
  variant: 'icon' | 'label';
}

const ICON_CLASS = 'p-1 rounded hover:text-ink hover:bg-ink/5 cursor-pointer transition-colors';

/**
 * The phone footer's row style: no padding and no hover plate, because it sits
 * beside Settings / About / Desktop and those are bare glyph-and-word rows. A
 * padded, plate-highlighted control in that row reads as a different kind of
 * control from its neighbours.
 */
const LABEL_CLASS = 'flex items-center space-x-1 hover:text-ink transition-colors';

/**
 * The `label` variant's glyph size.
 *
 * `14` is the phone footer's own size — Settings, About and Desktop all draw at
 * `14` — so the APK control is not the one row that is a pixel off. The icon-only
 * variant stays at 16, which is the desktop footer's size.
 */
const LABEL_ICON_SIZE = 14;

export function ShellUpdateButton({ download, variant }: ShellUpdateButtonProps) {
  const { phase, message, apply, reset, working } = useShellUpdate();
  // The dialog is open from the CLICK until it is dismissed, and the run's phases
  // are drawn inside it. A closed dialog whose run is still `working` is not a
  // state this component can be in: `confirm` is what opens it.
  const [open, setOpen] = useState(false);
  const label = shellDownloadLabel(download);

  if (!canSelfUpdate(download)) {
    // A link, and `target="_blank"` hands it to the system browser so the console
    // is not replaced by a file download.
    //
    // The `label` variant draws its glyph TOO. It used to render the word alone,
    // and that is exactly the case this branch covers for the mobile pair: neither
    // an Android nor an iOS shell can install its own artifact (`canSelfUpdate`
    // refuses both), so the phone's footer drew `Get APK` with no mark beside it —
    // the only control in that row without one.
    return (
      <a
        href={download.url}
        target="_blank"
        rel="noopener noreferrer"
        title={label}
        aria-label={label}
        className={variant === 'icon' ? ICON_CLASS : LABEL_CLASS}
      >
        <Download size={variant === 'icon' ? 16 : LABEL_ICON_SIZE} />
        {variant === 'label' && <span>{shellDownloadShortLabel(download)}</span>}
      </a>
    );
  }

  return (
    <>
      <button
        type="button"
        // A dismissed run is not a run: reopening starts from the confirmation, not
        // from the previous attempt's refusal.
        onClick={() => {
          reset();
          setOpen(true);
        }}
        disabled={working}
        title={label}
        aria-label={label}
        className={`${variant === 'icon' ? ICON_CLASS : LABEL_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
      >
        {working ? (
          <Loader2
            size={variant === 'icon' ? 16 : LABEL_ICON_SIZE}
            className="animate-spin motion-reduce:animate-none"
          />
        ) : (
          <Download size={variant === 'icon' ? 16 : LABEL_ICON_SIZE} />
        )}
        {variant === 'label' && <span>{shellDownloadShortLabel(download)}</span>}
      </button>

      {open &&
        // A PORTAL, not a child of this row. The footer is a 24px flex row of
        // glyphs, so a dialog rendered inside it is nested in a control strip: its
        // text joins the row's own text content (measured in the browser — the row
        // read as the dialog's body), and any `overflow`/`transform` added to that
        // row later would clip a `fixed` overlay. The portal is what makes "the
        // footer says nothing about a run" true rather than merely visually true.
        createPortal(
          <ShellUpdateModal
            download={download}
            phase={phase === 'idle' ? 'confirm' : phase}
            message={message}
            onConfirm={() => void apply(download)}
            // Closing mid-run hides the dialog but does not cancel the shell: it is
            // already replacing itself, and a Cancel that could not stop it would be
            // a button that lies. The control stays disabled until the run answers.
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
