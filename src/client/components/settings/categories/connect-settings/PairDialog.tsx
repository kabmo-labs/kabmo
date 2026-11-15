/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The pairing dialog: one QR, its clock, and the routes it carries.
 *
 * PORTALED TO `<body>`, not positioned inside the settings panel. The panel is
 * `overflow-hidden` and the composer card can become a containing block for
 * `position: fixed` through `backdrop-filter`, a `transform` or `contain:
 * layout` — either one clips or mis-sizes a nested overlay, and the dialog then
 * opens in front of the wrong thing. `createPortal` is the rule the Goal dialog
 * already follows for the same reason.
 *
 * The routes are listed because the code carries all of them: a phone that
 * cannot reach the LAN address still pairs over Tailscale, and the user should
 * be able to see that before scanning.
 */

import { useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { X } from 'lucide-preact';
import { QrCode } from '@/client/components/settings/categories/connect-settings/QrCode';
import { copyToClipboard } from '@/client/hooks/ui/clipboard';
import { pushToast } from '@/client/hooks/ui/toasts';
import type { PairingCode } from '@/client/hooks/connect/use-pairing';

const ROUTE_LABEL: Record<string, string> = {
  tailscale: 'Tailscale',
  lan: 'LAN',
  cloudflare: 'Cloudflare',
};

export interface PairDialogProps {
  code: PairingCode | null;
  error: string | null;
  busy: boolean;
  secondsLeft: number;
  onClose: () => void;
  onRetry: () => void;
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

/**
 * Copy the pairing link and say what happened.
 *
 * `navigator.clipboard` is undefined outside a secure context, and Kabmo is
 * routinely opened over plain HTTP on a LAN or Tailscale address — the exact
 * setup this dialog exists for. The old `navigator.clipboard?.writeText(...)`
 * therefore did nothing at all there, with no feedback. `copyToClipboard` falls
 * back to `execCommand`, and the toast reports the outcome either way.
 */
async function copyPairingLink(link: string): Promise<void> {
  const ok = await copyToClipboard(link);
  pushToast(
    ok ? 'Pairing link copied' : 'Could not copy the pairing link — select it from the routes list instead.',
    ok ? 'success' : 'error',
  );
}

export function PairDialog({ code, error, busy, secondsLeft, onClose, onRetry }: PairDialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const expired = code !== null && secondsLeft === 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/40 p-4 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a device"
        className="w-full max-w-md rounded-2xl border border-ink/15 bg-paper p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Add a device</h3>
            <p className="mt-0.5 text-[11px] text-ink/60">Scan with Kabmo on your phone.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-ink/10 bg-ink/[0.03] px-3 py-2 text-[11px] leading-relaxed text-ink/70">
            {error}
          </p>
        )}

        {busy && !code && <p className="py-10 text-center text-[11px] text-ink/60">Creating a code…</p>}

        {code && (
          <>
            <div className={`flex justify-center ${expired ? 'opacity-30' : ''}`}>
              <QrCode matrix={code.qr} label="Pairing QR code" />
            </div>

            <p className="mt-3 text-center text-[11px] text-ink/60">
              {expired ? (
                'This code has expired.'
              ) : (
                <>
                  Expires in <span className="font-mono tabular-nums text-ink">{clock(secondsLeft)}</span> · works once
                </>
              )}
            </p>

            <div className="mt-4">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">
                Routes in this code
              </div>
              <ul className="space-y-1">
                {code.candidates.map((candidate) => (
                  <li key={`${candidate.kind}:${candidate.url}`} className="flex items-baseline gap-2">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-ink" />
                    <span className="w-[74px] flex-shrink-0 text-[11px] font-semibold text-ink">
                      {ROUTE_LABEL[candidate.kind] ?? candidate.kind}
                    </span>
                    <span className="truncate font-mono text-[11px] text-ink/70">{candidate.url}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-4 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => void copyPairingLink(code.webLink)}
                className="rounded-lg border border-ink/15 px-2.5 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-ink/5"
              >
                Copy link
              </button>
              <div className="flex items-center gap-2">
                {expired && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="rounded-lg border border-ink/15 px-2.5 py-1.5 text-[11px] font-semibold text-ink transition-colors hover:bg-ink/5"
                  >
                    New code
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg bg-ink px-3 py-1.5 text-[11px] font-semibold text-paper transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}
