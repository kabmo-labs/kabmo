/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Control strip for ONE running subagent: a steer box and a stop button.
 *
 * Subagents are not read-only any more. omp exposes `steer_subagent` (send the
 * agent a message as its user) and `cancel_subagent` (hard-kill it) on RPC, and
 * both act on the session's live child — so the strip renders only while the
 * subagent is running, and a session the server does not manage answers 409.
 *
 * The two actions are deliberately asymmetric in feedback: a cancelled subagent
 * disappears from the roster on the next lifecycle frame, while a steer is
 * acknowledged in place, so only the steer needs an inline confirmation.
 */

import { useState } from 'preact/hooks';
import { Send, Square } from 'lucide-preact';
import { cancelSubagent, steerSubagent } from '@/shared/lib/omp/subagent/control';

interface SubagentControlsProps {
  sessionId: string;
  subagentId: string;
  /** Renders the full strip only while the subagent runs. */
  running: boolean;
  className?: string;
}

export function SubagentControls({ sessionId, subagentId, running, className = '' }: SubagentControlsProps) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!running) return null;

  const submitSteer = async () => {
    const message = draft.trim();
    if (!message || busy) return;
    setBusy(true);
    const ok = await steerSubagent(sessionId, subagentId, message);
    setBusy(false);
    if (ok) {
      setDraft('');
      setNote('Sent to the subagent');
    } else {
      // A refusal has to SAY so: the draft stays so the user can retry.
      setNote('The subagent did not accept the message');
    }
    setTimeout(() => setNote(null), 4000);
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <input
        type="text"
        value={draft}
        disabled={busy}
        placeholder="Message this subagent…"
        aria-label="Message this subagent"
        onInput={(e) => setDraft(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submitSteer();
          }
        }}
        className="flex-1 min-w-0 rounded-md border border-ink/15 bg-paper px-2 py-1.5 text-[11.5px] text-ink outline-none focus:border-ink/35 disabled:opacity-50"
      />
      <button
        type="button"
        onClick={() => void submitSteer()}
        disabled={busy || !draft.trim()}
        title="Send to subagent"
        aria-label="Send to subagent"
        className="flex items-center justify-center w-7 h-7 rounded-md border border-ink/15 text-ink/70 hover:text-ink hover:bg-ink/5 disabled:opacity-40 disabled:hover:bg-transparent transition-colors shrink-0"
      >
        <Send size={12} />
      </button>
      <button
        type="button"
        onClick={() => void cancelSubagent(sessionId, subagentId)}
        title="Stop this subagent"
        aria-label="Stop this subagent"
        className="flex items-center justify-center w-7 h-7 rounded-md border border-ink/15 text-ink/70 hover:text-error hover:border-error/40 hover:bg-error/5 transition-colors shrink-0"
      >
        <Square size={11} />
      </button>
      {note && <span className="shrink-0 text-[10.5px] text-ink/55">{note}</span>}
    </div>
  );
}
