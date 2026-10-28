/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Catalog → composer mapping for the model/thinking pickers: one definition of
 * how a catalog entry becomes the selected model, and of which thinking level
 * that selection is allowed to claim. Shared by every resolution site in
 * ChatInput so the level rule cannot drift between them.
 */

import type { AIModelOption, ModelEntry } from '@/shared/types';
import { selectableThinkingLevels } from '@/shared/lib/models/thinking-levels';

/**
 * Level reported while none is known. A catalog ladder's first entry is NOT a
 * fact about the session — every model's ladder starts at `off` — and the send
 * path pushes any non-`auto` value onto the live session (queue replay), so an
 * unresolved level must stay indistinguishable from "leave omp alone".
 */
export const UNKNOWN_THINKING_LEVEL = 'auto';

/**
 * Level the composer may select for a model. The session's last-used level is
 * authoritative whenever the model offers it — an async fetch resolving later
 * must not reset it to a ladder default. Only a ladder that is KNOWN and
 * excludes the session level rejects it; an empty ladder (catalog not resolved
 * / model exposes none) must not erase the session's actual level. With no
 * session level to go on, the current selection is kept, and a composer that
 * has none yet reports {@link UNKNOWN_THINKING_LEVEL}.
 */
export function resolveThinkingLevel(
  ladder: readonly string[] | null | undefined,
  sessionLevel: string | null | undefined,
  currentLevel: string | null | undefined,
): string {
  const selectable = selectableThinkingLevels(ladder ?? []);
  if (sessionLevel && (selectable.length === 0 || selectable.includes(sessionLevel))) return sessionLevel;
  return currentLevel ?? UNKNOWN_THINKING_LEVEL;
}

/** The composer's selection for a catalog model, carrying its thinking level. */
export function selectionFor(
  match: ModelEntry,
  sessionLevel: string | null | undefined,
  current: AIModelOption | null,
): AIModelOption {
  return {
    id: match.id,
    name: match.name,
    provider: match.provider,
    contextWindow: match.contextWindow,
    thinkingLevels: match.thinkingLevels,
    thinkingLevel: resolveThinkingLevel(match.thinkingLevels, sessionLevel, current?.thinkingLevel),
  };
}
