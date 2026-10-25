/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Loading a stream mode on demand, and telling the surface when it lands.
 *
 * The mode table is 49 entries but the modules behind them are lazy for the same
 * reason `LANG_LOADERS` is: all 38 modes in one bundle is +85 KB gzip, and a tab
 * opened on a README should pay for none of it. A mode is fetched the first time
 * a document in that language is opened.
 *
 * The notification exists because a `StreamLanguage` is a COMPARTMENT payload:
 * the surface mounts with none, and the tree (and therefore token-aware bracket
 * matching) only exists after the reconfigure. Without the signal a file would
 * keep the textual matcher for its whole life, with nothing on screen to say a
 * better answer was available.
 *
 * Shaped after `theme-loader.ts`, deliberately: same per-process registry on a
 * module-level map, same in-flight dedupe, same "never reject" contract — a mode
 * that fails to load leaves the textual matcher, which is a worse answer rather
 * than a broken editor.
 */

import type { StreamLanguage } from '@codemirror/language';
import { streamModeLoader, STREAM_MODE_EXPORTS } from '@/shared/lib/code/editor/stream-modes';

/**
 * A defined stream language — the CM6 extension a mode becomes.
 *
 * Named here rather than spelled `ReturnType<typeof StreamLanguage.define>`
 * because the type argument is what a consumer holds; the alias keeps the
 * generic out of every call site.
 */
export type StreamLanguageInstance = StreamLanguage<unknown>;

/** Ids whose mode is loaded and ready to install. */
const loaded = new Map<string, StreamLanguageInstance>();
/** In-flight loads, so two surfaces on one language share a fetch. */
const pending = new Map<string, Promise<StreamLanguageInstance | null>>();
const listeners = new Set<(language: string) => void>();

function notifyReady(language: string): void {
  for (const listener of [...listeners]) {
    try {
      listener(language);
    } catch {
      // A listener must never break the others.
    }
  }
}

/**
 * Fires when a mode lands, so a surface that mounted without it can reconfigure.
 *
 * Keyed by SHIKI id, not by mode name: that is what the surface holds.
 */
export function onStreamModeReady(listener: (language: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The mode for `language` if it is already loaded, else null. */
export function readyStreamMode(language: string): StreamLanguageInstance | null {
  return loaded.get(language) ?? null;
}

/**
 * Load and register the mode for a Shiki id.
 *
 * Resolves `null` for a language this build has no mode for (the honest answer
 * for markdown, html, graphql, …) and for one whose module fails to load. Never
 * rejects: the caller keeps the textual matcher.
 */
export function loadStreamMode(language: string): Promise<StreamLanguageInstance | null> {
  const ready = loaded.get(language);
  if (ready) return Promise.resolve(ready);

  const inFlight = pending.get(language);
  if (inFlight) return inFlight;

  const loader = streamModeLoader(language);
  const exportName = STREAM_MODE_EXPORTS[language];
  if (!loader || !exportName) return Promise.resolve(null);

  const load = (async () => {
    try {
      const [module, languageModule] = await Promise.all([
        // The LOADER, not a template specifier: a template literal builds but
        // never resolves at runtime in the dev server (measured — the mode
        // silently failed to load and the surface stayed textual).
        loader(),
        import('@codemirror/language'),
      ]);
      const mode = (module as Record<string, unknown>)[exportName];
      if (!mode) return null;
      // `StreamLanguage.define` is the only constructor; the mode object alone is
      // not an extension.
      const instance = languageModule.StreamLanguage.define(mode as never);
      loaded.set(language, instance);
      notifyReady(language);
      return instance;
    } catch {
      // Left out of `loaded`, so a later attempt can still succeed.
      return null;
    } finally {
      pending.delete(language);
    }
  })();

  pending.set(language, load);
  return load;
}

/** Test seam: forget every registration. */
export function resetStreamModes(): void {
  loaded.clear();
  pending.clear();
  listeners.clear();
}
