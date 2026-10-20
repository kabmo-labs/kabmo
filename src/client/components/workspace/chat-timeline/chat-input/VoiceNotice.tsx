/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AlertTriangle } from 'lucide-preact';

export interface VoiceNoticeProps {
  /** Status while a dictation is in flight ("Downloading speech model 42%"). */
  status: string | null;
  /** A dictation failure, shown until it times out in the hook. */
  error: string | null;
}

/**
 * The composer's dictation strips: progress while the utterance (or a first-run
 * model download) is being handled, and the failure that ended it.
 */
export function VoiceNotice({ status, error }: VoiceNoticeProps) {
  if (status) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink/60">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ink/50 animate-pulse" />
        <span className="min-w-0 flex-1 break-words">{status}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-start gap-1.5 bg-error/5 px-3 py-1.5 text-[11px] text-error">
        <AlertTriangle size={11} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">{error}</span>
      </div>
    );
  }

  return null;
}
