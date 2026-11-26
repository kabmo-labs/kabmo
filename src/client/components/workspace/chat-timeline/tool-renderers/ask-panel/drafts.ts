/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Answer bookkeeping for the inline ask card.
 *
 * omp asks a multi-question `ask` one question at a time and blocks on each, so
 * only the question currently in flight owns a dialog. The card still lets the
 * user answer any of them, in any order: a choice made for a question omp has
 * not reached yet is held here and released the moment its dialog arrives. Every
 * sent dialog is remembered by id, so a re-render (or a replayed request after a
 * page reload) can never answer the same frame twice.
 *
 * Multi-select questions are excluded from that queue: omp re-asks them once per
 * toggle and only the LAST one settles the question, so each click is sent
 * immediately and only the display state accumulates here.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { ExtensionUiDialogRequest } from '@kabmo-labs/kabmo-chat/contracts/agent';
import type { AskAnswer, AskQuestion } from '@/shared/lib/chat/ask-form/types';
import type { ExtensionDialogResponse } from '@/client/components/workspace/chat-timeline/tool-renderers/extension-dialog/Lazy';

interface UseAskDraftsOptions {
  toolId: string;
  questions: AskQuestion[];
  /** Dialogs per question, oldest first — the last one is the live dialog. */
  groups: ExtensionUiDialogRequest[][];
  /** Answers omp already recorded in the tool result, per question. */
  recorded: (AskAnswer | null)[];
  respond: (request: ExtensionUiDialogRequest, response: ExtensionDialogResponse) => void;
}

export interface AskDrafts {
  /** Committed single-choice answers, by question index. */
  drafts: Record<number, string>;
  /** Labels the user has toggled on a multi-select question, for display only. */
  multiSelected: Record<number, string[]>;
  commit: (index: number, value: string) => void;
  toggleMulti: (index: number, label: string) => void;
}

/** The live dialog for a question: the most recent frame it raised. */
export function liveFrame(groups: ExtensionUiDialogRequest[][], index: number): ExtensionUiDialogRequest | null {
  const frames = groups[index];
  return frames && frames.length > 0 ? frames[frames.length - 1] : null;
}

// omp records answers only in the FINAL tool result, so a reload mid-ask would
// otherwise repaint every question already answered as still waiting. The draft
// cache keeps the text across a reload; it is per-tab and dies with the session.
function draftKey(toolId: string): string {
  return `kabmo.ask-draft:${toolId}`;
}

function loadDrafts(toolId: string): Record<number, string> {
  try {
    const raw = sessionStorage.getItem(draftKey(toolId));
    return raw ? (JSON.parse(raw) as Record<number, string>) : {};
  } catch {
    return {};
  }
}

export function useAskDrafts({ toolId, questions, groups, recorded, respond }: UseAskDraftsOptions): AskDrafts {
  const [drafts, setDrafts] = useState<Record<number, string>>(() => loadDrafts(toolId));
  const [multiSelected, setMultiSelected] = useState<Record<number, string[]>>({});
  const sentRef = useRef<Set<string>>(new Set());
  // Frames whose checked rows have already seeded the display.
  const syncedRef = useRef<Set<string>>(new Set());

  // A checkbox the form marks `checked` starts ON, and the frame reports it in
  // `checkedIndices`. Drawing an empty set made the first click SEND that label
  // — toggling the default OFF — while the card showed it as selected.
  useEffect(() => {
    for (let index = 0; index < questions.length; index += 1) {
      if (questions[index].multi !== true) continue;
      const frame = liveFrame(groups, index);
      if (!frame || frame.method !== 'select' || !Array.isArray(frame.checkedIndices)) continue;
      if (syncedRef.current.has(frame.id)) continue;
      syncedRef.current.add(frame.id);
      const checked = frame.checkedIndices
        .map((row) => frame.options?.[row])
        .filter((label): label is string => typeof label === 'string');
      setMultiSelected((current) => ({ ...current, [index]: checked }));
    }
  }, [questions, groups]);

  useEffect(() => {
    for (let index = 0; index < questions.length; index += 1) {
      if (recorded[index] || questions[index].multi) continue;
      const value = drafts[index];
      if (!value) continue;
      const frame = liveFrame(groups, index);
      if (!frame || frame.method !== 'select' || sentRef.current.has(frame.id)) continue;
      sentRef.current.add(frame.id);
      respond(frame, { value });
    }
  }, [questions, groups, drafts, recorded, respond]);

  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey(toolId), JSON.stringify(drafts));
    } catch {
      // Storage disabled (private mode): the card still works for this mount.
    }
  }, [toolId, drafts]);

  const commit = useCallback((index: number, value: string) => {
    setDrafts((current) => (current[index] === value ? current : { ...current, [index]: value }));
  }, []);

  const toggleMulti = useCallback((index: number, label: string) => {
    const frame = liveFrame(groups, index);
    if (!frame || sentRef.current.has(frame.id)) return;
    // One omp dialog per toggle: answering it re-asks the question with the
    // updated set, so the next click lands on the dialog that just arrived.
    sentRef.current.add(frame.id);
    respond(frame, { value: label });
    setMultiSelected((current) => {
      const selected = current[index] ?? [];
      return {
        ...current,
        [index]: selected.includes(label) ? selected.filter((item) => item !== label) : [...selected, label],
      };
    });
  }, [groups, respond]);

  return { drafts, multiSelected, commit, toggleMulti };
}
