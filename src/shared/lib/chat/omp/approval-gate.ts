/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Is this dialog omp's TOOL-APPROVAL gate, rather than a question it asked?
 *
 * Over RPC the gate is NOT a `confirm` frame. omp's RPC UI context
 * (`RpcExtensionUIContext`) has no `approve` member, so `requestApproval`
 * falls back to its `select` branch (`approval.ts`: `if (ui.approve) … else
 * ui.select(full, approvalChoiceLabels(choices))`). The gate therefore
 * arrives as a `select` frame whose TITLE is omp's approval prompt and whose
 * OPTIONS are the approval choices — measured against 18.13.1:
 *
 *     title:   "Allow tool: read\nReason: Restricted folder: /tmp/secret\nPath: …"
 *     options: ["Approve", "Deny"]
 *
 * A mode-raised prompt (the ordinary `always-ask` gate) carries the same
 * shape, so the TITLE PREFIX is what separates the two.
 *
 * This matters because an approval gate and an `ask` question are both
 * `select` frames, and the routing that decides which one gets the dialog
 * (`splitAskFrames`) claims a `select` by its title. omp's approval title
 * names no question, so the gate used to fall through to the "last ask
 * spoke" walk and land on an unrelated QUESTION's card — where it renders as
 * that question's answer options ("Approve" / "Deny" offered as answers to
 * "Which language?"), and the answer is posted to the wrong tool call.
 *
 * The prefix is omp's own (`approvalHeader`: `Allow tool: ${tool.name}`) and
 * has been in that shape since well before 18.13.1 — 18.13.1 does not change
 * it, it only adds a NEW WAY to raise the gate (`tools.restrictedFolders`),
 * which makes the misrouting reachable in a session that never asks anything.
 */

/** omp's approval-prompt title prefix (`approval.ts`: `Allow tool: <tool>`). */
const APPROVAL_TITLE_PREFIX = 'allow tool:';

/**
 * The choices omp's approval gate offers, in every shape it can take.
 *
 * Measured against omp 18.13.1's own resolver, across all three approval
 * modes and with a restricted folder in force: the gate's option list is
 * ALWAYS exactly `["Approve", "Deny"]`. A mode-raised prompt adds
 * "Approve write for this session" — but only when `sessionApprovalScope`
 * grants it, and a RESTRICTED call carries source `restriction`, for which
 * upstream returns NO scope. So the list is two labels either way.
 *
 * The labels are omp's own (`approvalChoiceLabels`), and they are what the
 * answer parser compares against — anything else is a deny.
 */
const APPROVAL_CHOICES = ['approve', 'deny'];

/**
 * True for a frame omp raised as a tool-approval gate.
 *
 * TWO facts have to hold, and both are omp's own:
 *
 *  - the TITLE is omp's approval prompt (it leads with "Allow tool: <tool>");
 *  - the OPTIONS are the approval choices.
 *
 * The title alone would be enough for omp's own frames, but a model-authored
 * `ask` question can also be titled "Allow tool: …" — and that question is
 * answered through the QUESTION's card, with its own options. Requiring the
 * choice labels as well is what keeps such a question a question.
 */
export function isApprovalGateFrame(frame: { title?: string | null; options?: readonly string[] }): boolean {
  const title = typeof frame.title === 'string' ? frame.title.trim().toLowerCase() : '';
  if (!title.startsWith(APPROVAL_TITLE_PREFIX)) return false;
  const options = frame.options;
  // A frame with no option list cannot be an approval gate: omp's gate always
  // carries its choices.
  if (!options || options.length === 0) return false;
  return options.every((option) => APPROVAL_CHOICES.includes(option.trim().toLowerCase()));
}

/** The approval prompt, split into the parts a reader needs. */
export interface ApprovalPrompt {
  /** The tool the gate is about ("read", "bash"). */
  tool: string;
  /** Why the gate asks ("Restricted folder: /tmp/secret") — omp's own line. */
  reason?: string;
  /**
   * The tool's own detail rows — the path, the command, whatever omp's tool
   * supplies. These are lines the gate is ABOUT, and the reason the user
   * needs them: "Approve" without the command it approves is not a decision.
   */
  details: string[];
}

/**
 * omp's approval prompt, split into its parts.
 *
 * omp sends the whole prompt as ONE title, newline-separated
 * (`approvalHeader` + `approvalDetails` joined with `\n`):
 *
 *     Allow tool: read
 *     Reason: Restricted folder: /tmp/livetest/secret
 *     Path: /tmp/livetest/secret/creds.txt
 *
 * A title is a single-line field, and the dialog's header renders it with
 * `truncate` — so the REASON and the PATH were clipped out of the one
 * element that could show them, leaving a gate that said only "Allow tool:
 * read" over a "Path: …" the user could not see. Splitting the prompt is
 * what lets the dialog show what it is approving.
 *
 * This reads the TITLE's shape. Whether the frame IS a gate is
 * `isApprovalGateFrame`'s question, and it needs the option list too — so a
 * caller must decide that first and then split the title it accepted.
 *
 * A title that is not an approval prompt yields `null`; a prompt with no
 * detail rows yields an empty `details` list, never a missing one.
 */
export function parseApprovalPrompt(title: string | null | undefined): ApprovalPrompt | null {
  const text = typeof title === 'string' ? title : '';
  if (!text.trim().toLowerCase().startsWith(APPROVAL_TITLE_PREFIX)) return null;
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  // The first line is omp's own header: "Allow tool: <tool>".
  const tool = lines[0]?.slice(APPROVAL_TITLE_PREFIX.length).trim() ?? '';
  const rest = lines.slice(1);
  // The reason is omp's own labelled line, and only when it wrote one.
  const reasonLine = rest.find((line) => line.toLowerCase().startsWith('reason:'));
  const reason = reasonLine ? reasonLine.slice('reason:'.length).trim() : undefined;
  const details = rest.filter((line) => line !== reasonLine);
  return { tool, ...(reason ? { reason } : {}), details };
}
