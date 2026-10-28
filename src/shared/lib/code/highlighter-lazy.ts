/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Demand-driven grammar loading for the Shiki core highlighter.
 *
 * `shiki/core` exposes only a synchronous `codeToHtml`: a grammar that was never
 * passed to `loadLanguage` throws, and there is no internal lazy fetch. So the
 * grammar for a language is fetched the first time that language is actually
 * asked for — not for all 58 at boot, which produced 58 parallel chunk requests
 * and ~8 MB of JS for a session that touches three languages.
 *
 * A grammar load is fire-and-forget: callers report the miss synchronously
 * (falling back to escaped plain text) and subscribe via `onLanguageReady` to be
 * told when the grammar landed, so the same highlight can be retried.
 */

import type { HighlighterCore, LanguageRegistration } from 'shiki/core';

import { LANG_LOADERS } from '@/shared/lib/code/shiki-langs';

/** Shape of a `@shikijs/langs/*` module (the registration array sits on `.default`). */
type LangModule = { default: LanguageRegistration[] };

type Listener = () => void;

/** Languages currently being fetched — dedupes concurrent requests per grammar. */
const pending = new Map<string, Promise<void>>();
/** Languages that loaded (or that Shiki treats as built-in, e.g. `text`). */
const loaded = new Set<string>();
const listeners = new Set<Listener>();

/** Shiki rejects special languages; `text` is always available and needs no fetch. */
const SPECIAL_LANGS: Record<string, true> = {
  text: true,
  plain: true,
  plaintext: true,
  txt: true,
  ansi: true,
  none: true,
};

function notify(): void {
  for (const fn of listeners) fn();
}

/**
 * True once `language` can be highlighted synchronously. Special languages are
 * always usable; every other id is usable only after its grammar resolved.
 */
export function isLanguageReady(language: string): boolean {
  return SPECIAL_LANGS[language] === true || loaded.has(language);
}

/** Subscribe to grammar arrivals. Returns an unsubscribe fn. */
export function onLanguageReady(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Ensure `language` is loaded, resolving on completion. Callers stay
 * synchronous: they render the plain-text fallback and retry on the next
 * `onLanguageReady` fire, identical to the previous warmup-race behaviour.
 *
 * Unknown ids (not in `LANG_LOADERS`) resolve immediately — the caller's own
 * fallback language handles them.
 */
export function ensureLanguage(highlighter: HighlighterCore, language: string): Promise<void> {
  if (isLanguageReady(language)) return Promise.resolve();
  const inFlight = pending.get(language);
  if (inFlight) return inFlight;
  const loader = LANG_LOADERS[language];
  if (!loader) return Promise.resolve();

  const load = highlighter
    .loadLanguage(loader as () => Promise<LangModule>)
    .then(() => {
      loaded.add(language);
      notify();
    })
    .catch(() => {
      // Grammar unavailable under this engine: the caller keeps the plain
      // fallback forever, and the id is left out of `loaded` so a later retry
      // is still possible.
    })
    .finally(() => {
      pending.delete(language);
    });

  pending.set(language, load);
  return load;
}

/**
 * Load the eager set without blocking boot. Resolves when every eager grammar
 * settled, which is what the previous `WARMUP_BUDGET_MS` race approximated —
 * now nothing else waits on it, so a slow grammar cannot stall readiness.
 */
export async function ensureLanguages(highlighter: HighlighterCore, languages: readonly string[]): Promise<void> {
  await Promise.all(languages.map((id) => ensureLanguage(highlighter, id)));
}
