/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The body of omp's TOOL-APPROVAL gate: what is being approved, and why.
 *
 * Over RPC the gate is a `select` frame whose TITLE is omp's whole approval
 * prompt, newline-separated (see `parseApprovalPrompt`). A title is a
 * single-line field, and the dialog's header renders it with `truncate` — so
 * the reason and the path were clipped out of the one element that could
 * show them, and the gate read "Allow tool: read" over a command the user
 * never saw. "Approve" without the thing being approved is not a decision.
 *
 * This body shows the prompt's parts, each in full:
 *
 *  - the TOOL, as the header's own subject line;
 *  - the REASON omp wrote ("Restricted folder: /tmp/secrets" — omp's
 *    `tools.restrictedFolders` gate writes exactly that line);
 *  - the tool's own DETAIL rows (the path, the command), verbatim.
 *
 * A frame that is not an approval gate renders nothing here: the dialog's
 * other bodies (a `confirm` banner, an extension's own message) own their
 * own copy.
 */

import { AlertTriangle } from 'lucide-preact';
import { isApprovalGateFrame, parseApprovalPrompt } from '@/shared/lib/chat/omp/approval-gate';

interface ApprovalBodyProps {
  /** The frame's title — omp's whole approval prompt. */
  title?: string | null;
  /** The frame's choices — a gate's are "Approve" / "Deny". */
  options?: readonly string[];
}

export function ApprovalBody({ title, options }: ApprovalBodyProps) {
  const prompt = isApprovalGateFrame({ title, options }) ? parseApprovalPrompt(title) : null;
  if (!prompt) return null;

  return (
    <div className="space-y-2">
      {prompt.reason && (
        <div className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/8 px-3.5 py-2.5 text-[12px] leading-relaxed text-ink/80">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warning" />
          <span className="min-w-0 break-words">{prompt.reason}</span>
        </div>
      )}

      {prompt.details.length > 0 && (
        <div className="rounded-xl border border-ink/10 bg-canvas/40 px-3.5 py-2.5">
          {prompt.details.map((detail, index) => (
            <div
              key={`${index}-${detail}`}
              className="font-mono text-[11.5px] leading-relaxed text-ink/75 break-all"
            >
              {detail}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
