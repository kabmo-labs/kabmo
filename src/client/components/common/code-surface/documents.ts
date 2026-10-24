/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One `EditorState` per open document, applied with `view.setState`.
 *
 * This is what the tab model actually needs and what the textarea surface could
 * only fake: a tab's caret, its extra cursors and its UNDO HISTORY belong to the
 * tab, not to the panel. Measured in CM6: switching states and coming back
 * restores all three, and an undo in one tab cannot touch another — with the
 * single buffer the panel used to hold, `⌘Z` after a tab switch undid an edit in
 * the file the user was no longer looking at.
 *
 * The cache is bounded. A session can open a dozen files and each history holds
 * whole-document snapshots, so the least recently used state is dropped past
 * `MAX_CACHED`. Losing a closed tab's history is the intended cost; losing an
 * OPEN tab's is not, which is why the drop is LRU rather than oldest-first.
 *
 * `wordWrap` and `readOnly` are per-VIEW settings, so they live in compartments
 * this module owns. A cached state is NOT reconfigured in place: `setState`
 * installs that state's own configuration, so the caller re-applies the current
 * options after every swap (`optionsEffects`). Reconfiguring in the cache too
 * would be a second place the same answer is stored.
 */

import { Compartment, EditorState, type Extension, type StateEffect } from '@codemirror/state';

import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { readOnlyExtension, surfaceExtensions, wrapExtension } from '@/client/components/common/code-surface/extensions';
import { shikiHighlight, type ShikiThemeNames } from '@/client/components/common/code-surface/shiki';

/** States kept alive; past this the least recently used one is dropped. */
const MAX_CACHED = 12;

export interface SurfaceOptions {
  wordWrap: boolean;
  readOnly: boolean;
  /**
   * The tokenizer's two theme names.
   *
   * Part of the live options rather than of the document key: two tabs in
   * different languages are two states (their decorations are built from
   * different grammars), but a THEME is one setting for every tab — a new key
   * per theme would throw away every open tab's undo history on a colour change.
   */
  themes: ShikiThemeNames;
}

export interface DocumentCacheDeps extends SurfaceOptions {
  /** Panel-owned commands the editor delegates instead of running. */
  onCommand?: (command: EditorCommand) => void;
  /** Every user edit, with the whole new document. */
  onDocChange: (value: string) => void;
  /** Every state worth remembering (an edit or a selection move). */
  onState: (state: EditorState) => void;
}

export interface DocumentCache {
  /** The state for `key`, created (and cached) from `value` when absent. */
  stateFor(key: string, language: string, value: string): EditorState;
  /** Store the live state so a switch back finds it. */
  remember(key: string, state: EditorState): void;
  /** Drop a closed tab's history. */
  drop(key: string): void;
  /**
   * Effects that bring a view to the current options; empty when nothing moved.
   *
   * `key` names the document the effects will be dispatched to, because the
   * tokenizer is per-LANGUAGE: a theme reconfigure must rebuild it from that
   * document's own grammar, not from whichever one the cache saw last.
   */
  optionsEffects(next: SurfaceOptions, key?: string): StateEffect<unknown>[];
  /**
   * Effects that install the CURRENT options unconditionally.
   *
   * A cached state carries the configuration it was created with, and
   * `view.setState` installs that configuration wholesale — so a tab opened
   * while wrap was off came back unwrapped after a toggle. This is the re-apply
   * a document switch owes.
   */
  currentEffects(key?: string): StateEffect<unknown>[];
}

/** Whether two theme pairs name the same Shiki themes. */
function sameThemes(a: ShikiThemeNames | undefined, b: ShikiThemeNames): boolean {
  return a !== undefined && a.light === b.light && a.dark === b.dark;
}

export function createDocumentCache(deps: DocumentCacheDeps): DocumentCache {
  const states = new Map<string, EditorState>();
  const options: SurfaceOptions = {
    wordWrap: deps.wordWrap,
    readOnly: deps.readOnly,
    themes: deps.themes,
  };
  const wordWrapCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const themeCompartment = new Compartment();
  /** The language each cached state was built for, so a theme reconfigure can
   *  rebuild its tokenizer with the SAME grammar. */
  const languages = new Map<string, string>();
  /**
   * The theme pair each cached state's tokenizer currently holds.
   *
   * Tracked because a theme reconfigure REBUILDS the decoration plugin, which
   * re-tokenizes the viewport. `currentEffects` runs on every tab switch, and
   * paying that for a state that already has the right theme is work for
   * nothing — 2.1 ms on a 20 000-line file, every switch.
   */
  const themesByKey = new Map<string, ShikiThemeNames>();

  const extensionsFor = (language: string): Extension[] =>
    surfaceExtensions({
      language,
      wordWrapCompartment,
      readOnlyCompartment,
      themeCompartment,
      onCommand: deps.onCommand,
      onDocChange: deps.onDocChange,
      onState: deps.onState,
      ...options,
    });

  /** Move `key` to the end of the map so the LRU drop takes the right one. */
  const touch = (key: string, state: EditorState): void => {
    states.delete(key);
    states.set(key, state);
  };

  const evict = (): void => {
    while (states.size > MAX_CACHED) {
      const oldest = states.keys().next();
      if (oldest.done) return;
      states.delete(oldest.value);
    }
  };

  return {
    stateFor(key, language, value) {
      const cached = states.get(key);
      if (cached) {
        touch(key, cached);
        return cached;
      }
      const state = EditorState.create({ doc: value, extensions: extensionsFor(language) });
      states.set(key, state);
      languages.set(key, language);
      themesByKey.set(key, options.themes);
      evict();
      return state;
    },

    remember(key, state) {
      touch(key, state);
    },

    drop(key) {
      states.delete(key);
      languages.delete(key);
      themesByKey.delete(key);
    },

    optionsEffects(next, key) {
      const wrapChanged = next.wordWrap !== options.wordWrap;
      const readOnlyChanged = next.readOnly !== options.readOnly;
      const themeChanged = next.themes.light !== options.themes.light || next.themes.dark !== options.themes.dark;
      options.wordWrap = next.wordWrap;
      options.readOnly = next.readOnly;
      options.themes = next.themes;
      const effects: StateEffect<unknown>[] = [];
      if (wrapChanged) effects.push(wordWrapCompartment.reconfigure(wrapExtension(options.wordWrap)));
      if (readOnlyChanged) effects.push(readOnlyCompartment.reconfigure(readOnlyExtension(options.readOnly)));
      // The plugin carries the language, so the tokenizer is rebuilt from THIS
      // document's grammar. Other cached states are handled by `currentEffects`
      // when they are applied, which is the moment they need it.
      const language = key ? languages.get(key) : undefined;
      if (themeChanged && language) {
        effects.push(themeCompartment.reconfigure(shikiHighlight(language, options.themes)));
        if (key) themesByKey.set(key, options.themes);
      }
      return effects;
    },

    currentEffects(key) {
      const effects: StateEffect<unknown>[] = [
        wordWrapCompartment.reconfigure(wrapExtension(options.wordWrap)),
        readOnlyCompartment.reconfigure(readOnlyExtension(options.readOnly)),
      ];
      const language = key ? languages.get(key) : undefined;
      // Only when this state's tokenizer still holds another theme: a switch
      // back to a tab that already has it must not re-tokenize.
      if (key && language && !sameThemes(themesByKey.get(key), options.themes)) {
        effects.push(themeCompartment.reconfigure(shikiHighlight(language, options.themes)));
        themesByKey.set(key, options.themes);
      }
      return effects;
    },
  };
}
