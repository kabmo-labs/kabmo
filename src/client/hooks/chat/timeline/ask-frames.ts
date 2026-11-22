/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Routes omp's pending answerable dialogs to their renderer.
 *
 * `ask` dialogs belong on the tool card that raised them — a modal would hide
 * every question but the one in flight, and the tool's own result (all questions
 * and their answers) is what the user reads afterwards. Everything else
 * (approval gates under `always-ask`, extension pickers) has no card of its own
 * and keeps the modal.
 *
 * An `ask` frame is therefore NEVER modal material, in any state. It is either
 * claimed by the card that raised it, or returned as an ORPHAN the timeline
 * draws inline: a question whose tool call this client never saw (a subagent's,
 * an extension's own `askDialog`, a tool call outside the loaded window) still
 * blocks the agent, and the one place it must not appear is a dialog over the
 * conversation. That is what an empty modal was — `ExtensionDialog` has no
 * `ask` body, so an orphaned frame painted a panel with no question in it and a
 * single button whose click omp rejected ("Ask dialog response must carry N
 * answers"), leaving the run parked.
 *
 * The claim walks two keys, because omp gives the frame less than the tool call
 * does: the question TEXT (what omp's own per-question loop matches on, with a
 * context prefix and a decorated suffix both accepted) and the offered ROWS.
 * A frame that names a question of an ask we know but no OPEN card owns is an
 * inline orphan, never a modal. A field frame that matches neither key is still
 * owned by the only open ask when its title shares a content word with one of
 * that ask's questions — omp's ask tool is exclusive, so nothing else can be
 * asking, and this is what keeps a parser-drift question on the timeline.
 * Everything that matches nothing ask-shaped (a ratchet approval, an extension
 * picker) keeps the modal.
 *
 * The modal is also held until the session's own history has loaded. Ownership
 * is decided against the ask tool calls in `messages`, and on session open the
 * pending dialogs are replayed from the agent-state probe — which answers out
 * of the wrapper's local flags — long before the JSONL fetch lands. Rendering a
 * replayed APPROVAL as a modal in that window painted it on screen and yanked
 * it away the instant the timeline arrived and its card claimed it: the flash
 * seen when switching to a session parked on an ask. `historyLoaded` holds the
 * modal — never the card claim — until there is a timeline to decide against.
 */

import type { ChatMessageData } from '@/shared/types';
import type { ExtensionUiDialogRequest } from '@/shared/types/omp/agent';
import { askQuestionForFrame, askQuestionForOptions, askQuestionForTitle, askQuestionSharesText, normalizeAskText } from '@/shared/lib/chat/ask-questions';
import { bucketAskFrames } from '@/client/hooks/chat/timeline/ask-frame-buckets';
import type { AskFramesSplit } from '@/client/hooks/chat/timeline/ask-frames-context';
import { collectAsks } from '@/client/hooks/chat/timeline/ask-frame-asks';
import { claimFormFrame } from '@/client/hooks/chat/timeline/ask-form-frame';
import { isApprovalGateFrame } from '@/shared/lib/chat/omp/approval-gate';

export function splitAskFrames(
  messages: ChatMessageData[],
  pending: ExtensionUiDialogRequest[],
  /** Whether `messages` is the session's committed history yet (see the module
   *  note). False holds the modal back; it never blocks a card from claiming. */
  historyLoaded: boolean,
): AskFramesSplit {
  const framesByTool = new Map<string, ExtensionUiDialogRequest[][]>();
  const looseByTool = new Map<string, ExtensionUiDialogRequest[]>();
  const formByTool = new Map<string, ExtensionUiDialogRequest>();
  if (pending.length === 0) return { framesByTool, looseByTool, orphanAsks: [], formByTool, modalRequest: null };

  // Match against the asks that can still own a dialog: a reloaded session
  // reads its tool calls back from the JSONL, where a call still parked on a
  // question has no result yet and so cannot be told from a finished one — the
  // pending queue is the authoritative half. What the queue CANNOT do is say
  // which ask raised a frame, and omp asks a retried question with the SAME
  // title: a validation failure leaves a dead call (`status: 'error'`) whose
  // card renders no control, so letting it claim the retry's dialog left the
  // live card on "Waiting for the previous answer…" and the frame unanswerable
  // anywhere — the agent blocked with nothing on screen to answer it. A settled
  // ask, and one whose every question already carries a recorded answer, is
  // therefore not a candidate at all. A parked call read back from the JSONL is
  // neither: omp writes no result until the question is answered.
  const { openAsks, allAsks } = collectAsks(messages);

  const owned = new Map<string, ExtensionUiDialogRequest[]>();
  const handled = new Set<ExtensionUiDialogRequest>();
  /** Frames claimed by their option rows, with the question index they name. */
  const optionPlacements = new Map<ExtensionUiDialogRequest, number>();
  /** Owned frames whose title and rows both missed — drawn as the live control. */
  const unplaced = new Map<string, ExtensionUiDialogRequest[]>();
  const orphanAsks: ExtensionUiDialogRequest[] = [];
  let lastOwner: string | null = null;

  for (const request of pending) {
    // An `ask` frame is never modal material, whatever it carries. A malformed
    // one (no `questions`) has nothing for a card to draw either, but handing it
    // to the title/lastOwner walk below would file it under an unrelated ask's
    // question — so it is orphaned like any other cardless ask.
    const isAskFrame = request.method === 'ask';
    // A GROUPED ask frame (`method:"ask"`, sent after `set_ask_dialog`) carries
    // every question of one call and no `title` at all, so the title walk below
    // can never place it. Its questions carry omp's own ids, which is the
    // exact key the tool call's arguments use — match on those.
    const grouped = isAskFrame && Array.isArray(request.questions) && request.questions.length > 0
      ? request.questions
      : null;
    if (isAskFrame && !grouped) {
      if (historyLoaded) orphanAsks.push(request);
      continue;
    }
    if (grouped) {
      const ids = new Set(grouped.map((question) => question.id).filter(Boolean));
      let groupedOwner = [...openAsks].reverse().find((candidate) =>
        candidate.questions.some((question) => question.id && ids.has(question.id)),
      );
      // The id walk is the exact key, but it is not the only one omp gives us:
      // a call whose questions carry no `id` (measured on 2 of 161 real `ask`
      // calls) yields an empty id set, and the frame then matched nothing and
      // fell through to the MODAL — an ask dialog shown outside the timeline,
      // which is the one place it must never be. The question TEXT is what
      // omp's own per-question loop matches on, so it is the fallback here.
      if (!groupedOwner) {
        const titles = new Set(grouped.map((question) => normalizeAskText(question.question)).filter(Boolean));
        groupedOwner = [...openAsks].reverse().find((candidate) =>
          candidate.questions.some((question) => titles.has(normalizeAskText(question.question))),
        );
      }
      if (groupedOwner) {
        handled.add(request);
        lastOwner = groupedOwner.toolId;
        owned.set(groupedOwner.toolId, [...(owned.get(groupedOwner.toolId) ?? []), request]);
      }
      // A grouped ask is NEVER modal material: with no card to claim it, it is
      // an orphan the timeline draws inline (see the module note). It must not
      // fall through to the title/lastOwner walk either — that walk exists for
      // the per-question `select` loop, and handing a grouped frame to it would
      // file one dialog under a single question.
      //
      // The orphan row waits for the history for the same reason the modal
      // does: a frame replayed on session open looks cardless until the JSONL
      // lands, so drawing it now would paint the question at the tail of the
      // timeline and then move it onto its card. The frame stays queued, so
      // nothing is lost — the split simply re-runs.
      if (!groupedOwner && historyLoaded) {
        orphanAsks.push(request);
        handled.add(request);
      }
      continue;
    }

    // A FORM frame (omp 19.1.0's `ui.formDialog`, which the `ask` tool now
    // uses) carries no `title` and no per-question ids: its `html` is the SAME
    // string the tool call's arguments carry, which makes it the exact key.
    // It answers every control of the form in one `{ data }` reply, so it
    // belongs to the call as a whole rather than to one question.
    if (request.method === 'form' && typeof request.html === 'string') {
      const owner = claimFormFrame(request.html, openAsks);
      if (owner) {
        handled.add(request);
        lastOwner = owner.toolId;
        formByTool.set(owner.toolId, request);
      } else if (historyLoaded) {
        // Cardless: an extension's own `formDialog` (not the ask tool) has no
        // card of its own. The timeline draws it inline rather than the modal,
        // which has no form body.
        orphanAsks.push(request);
        handled.add(request);
      }
      continue;
    }

    let owner: string | null = null;
    let titleMatched = false;
    if (typeof request.title === 'string' && request.title) {
      // Newest first: omp asks one question at a time and blocks on it, so when
      // two live calls name the same question the later one is the one in
      // flight.
      for (let index = openAsks.length - 1; index >= 0; index -= 1) {
        const candidate = openAsks[index];
        if (askQuestionForTitle(candidate.questions, request.title) !== -1) {
          owner = candidate.toolId;
          titleMatched = true;
          break;
        }
      }
    }
    // The dialog omp opens after "Other (type your own)" names the question in
    // its title only loosely; it continues whichever ask spoke last. An
    // approval gate is never part of an ask, so it keeps its own modal.
    //
    // The gate arrives as a `select` over RPC (see `isApprovalGateFrame`), and
    // its title names no question — so the walk above cannot place it, and the
    // "last ask spoke" fallback used to hand it to that ask's card, where
    // "Approve"/"Deny" rendered as the ANSWERS to an unrelated question and
    // the answer went to the wrong tool call. A gate is excluded from the
    // fallback exactly like a `confirm`, and reaches the modal instead.
    //
    // A `select` whose title matches nothing is still the ask's when its ROWS
    // are the question's rows: the two parsers can disagree on a form shape
    // neither was written for, and the title is the only key that drifts. The
    // option list is the same list either way, so it is the fallback key — and
    // an exact set match cannot steal an extension picker or a gate.
    if (!owner && request.method === 'select' && !isApprovalGateFrame(request)) {
      for (let index = openAsks.length - 1; index >= 0; index -= 1) {
        const candidate = openAsks[index];
        const matched = askQuestionForOptions(candidate.questions, request.options);
        if (matched === -1) continue;
        owner = candidate.toolId;
        // The title walk already places a title match in `groupAskFrames`; a
        // frame claimed by its rows has no title to place by, so its row is
        // recorded here.
        optionPlacements.set(request, matched);
        break;
      }
    }
    if (!owner && request.method !== 'confirm' && !isApprovalGateFrame(request)) {
      // The frame names a question of an ask this client knows, but that ask is
      // not a live owner (it failed, was aborted, or already has every answer).
      // It is still an ask dialog: show it inline and leave the modal to
      // extension pickers, which have no card.
      const knownAsk = [...allAsks].reverse().some(
        (candidate) => askQuestionForFrame(candidate.questions, request) !== -1,
      );
      if (knownAsk) {
        if (historyLoaded) {
          orphanAsks.push(request);
          handled.add(request);
        }
        continue;
      }
      // A continuation of the ask that spoke last (the free-text dialog opened
      // by an "Other" row) can arrive with a decorated title that names nothing.
      // An approval gate is never part of an ask, so it keeps its own modal.
      if (lastOwner && openAsks.some((candidate) => candidate.toolId === lastOwner)) {
        owner = lastOwner;
      } else if (
        openAsks.length === 1 &&
        request.secret !== true &&
        (request.method === 'select' || request.method === 'input' || request.method === 'editor') &&
        askQuestionSharesText(openAsks[0].questions, request.title)
      ) {
        // The ask tool is EXCLUSIVE: while it blocks on a field, no extension
        // tool can raise a dialog of its own. A single open ask therefore owns
        // an unclaimed field dialog whose title still shares a content word
        // with one of its questions — this is the guarantee that a question
        // whose derived text drifted can never open as a modal. A dialog with
        // no shared word is someone else's (an extension picker) and keeps the
        // modal.
        owner = openAsks[0].toolId;
      }
      if (!owner) continue;
    }
    if (!owner) continue;
    handled.add(request);
    lastOwner = owner;
    owned.set(owner, [...(owned.get(owner) ?? []), request]);
    if (!titleMatched && !optionPlacements.has(request)) {
      unplaced.set(owner, [...(unplaced.get(owner) ?? []), request]);
    }
  }

  for (const [toolId, frames] of owned) {
    const questions = openAsks.find((candidate) => candidate.toolId === toolId)?.questions ?? [];
    const buckets = bucketAskFrames(questions, frames, new Set(unplaced.get(toolId) ?? []), optionPlacements);
    framesByTool.set(toolId, buckets.perQuestion);
    if (buckets.unmatched.length > 0) looseByTool.set(toolId, buckets.unmatched);
  }

  // The frame stays queued either way — only the modal waits for the history,
  // so nothing is dropped and nothing flashes. An `ask` frame is excluded here
  // in BOTH states: it is answered by a card or by the orphan row, and the
  // modal has no body for it. Anything this split already handed to an inline
  // surface is excluded too — a dialog must never be drawn twice.
  // A `form` frame is excluded for the same reason as `ask`: the modal has no
  // form body, so an unclaimed one is drawn inline by the timeline.
  const modalRequest = historyLoaded
    ? pending.find((request) => !handled.has(request) && request.method !== 'ask' && request.method !== 'form') ?? null
    : null;
  return { framesByTool, looseByTool, orphanAsks, formByTool, modalRequest };
}
