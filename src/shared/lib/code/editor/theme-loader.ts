/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Registering an editor theme with the shared Shiki highlighter, on demand.
 *
 * Shiki throws for a theme it has not been given, and `@shikijs/themes` ships 65
 * of them (1.3 MB of TextMate JSON). So a theme is loaded the first time it is
 * SELECTED — the picker's grid draws from the generated colour rows and fetches
 * nothing — and a surface that asks for one before it lands keeps the plain
 * fallback and re-runs on `onEditorThemeReady`.
 *
 * This lives beside the tokenizer rather than in a client hook because the
 * decoration plugin is what needs the notification, and it must not import a
 * Preact module to get it.
 */

import { getHighlighterSync } from '@/shared/lib/code/highlighter';
import {
  EDITOR_AUTO_THEME_ID,
  EDITOR_THEME_LOADERS,
} from '@/shared/lib/code/editor/themes';

/** Ids registered with the highlighter. */
const loaded = new Set<string>();
/** In-flight loads, so two surfaces selecting one theme share a fetch. */
const pending = new Map<string, Promise<void>>();
const listeners = new Set<(id: string) => void>();

function notifyReady(id: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(id);
    } catch {
      // A listener must never break the others.
    }
  }
}

/** Fires when a theme module lands, so a pending tokenize can retry. */
export function onEditorThemeReady(listener: (id: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether Shiki can tokenize with `id` synchronously right now. */
export function isEditorThemeReady(id: string): boolean {
  if (id === EDITOR_AUTO_THEME_ID) return true;
  return loaded.has(id);
}

/**
 * Register `id`'s theme with the shared highlighter.
 *
 * Resolves immediately for `auto`, for an id this build does not ship, and for
 * a highlighter that has not booted yet (the caller keeps the fallback and is
 * retried by `onSyntaxReady`). Never rejects: a theme that fails to load leaves
 * the surface on the app palette, which is a wrong palette rather than a blank
 * editor.
 */
export function loadEditorTheme(id: string): Promise<void> {
  if (id === EDITOR_AUTO_THEME_ID || loaded.has(id)) return Promise.resolve();
  const loader = EDITOR_THEME_LOADERS[id];
  if (!loader) return Promise.resolve();
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;

  const highlighter = getHighlighterSync();
  if (!highlighter) return Promise.resolve();

  const load = highlighter
    .loadTheme(loader as never)
    .then(() => {
      loaded.add(id);
      notifyReady(id);
    })
    .catch(() => {
      // Left out of `loaded` so a later attempt can still succeed.
    })
    .finally(() => {
      pending.delete(id);
    });

  pending.set(id, load);
  return load;
}

/** Test seam: forget every registration (a highlighter restart). */
export function resetEditorThemeLoader(): void {
  loaded.clear();
  pending.clear();
  listeners.clear();
}
