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
import { indentExtension } from '@/client/components/common/code-surface/extensions';

import type { EditorCommand } from '@/shared/lib/code/editor/keymap';
import { readOnlyExtension, surfaceExtensions, wrapExtension } from '@/client/components/common/code-surface/extensions';
import { typingExtensions, type EditorTypingOptions } from '@/client/components/common/code-surface/typing';
import { shikiHighlight, type ShikiThemeNames } from '@/client/components/common/code-surface/shiki';

/** States kept alive; past this the least recently used one is dropped. */
const MAX_CACHED = 12;

export interface SurfaceOptions {
  wordWrap: boolean;
  readOnly: boolean;
  /**
   * The blame extension, or null when the panel has it off.
   *
   * Part of the live options because the toggle can be pressed while a
   * document is open: a re-mount would drop the tab's undo history for a
   * reading aid. Absent and `null` both mean off.
   */
  blame?: Extension | null;
  /**
   * One indentation level, as a whitespace string.
   *
   * Part of the live options rather than the document key: an indentation setting is
   * one choice for every tab, so a new key per width would throw away every open
   * tab's undo history when the user picked 4 spaces.
   */
  indentUnitText: string;
  /**
   * Auto-close brackets and the completer.
   *
   * Part of the live options, and it needs a RECONFIGURE rather than a value baked into
   * the state: a setting changed while a tab is open must reach it, and a re-mount would
   * drop the undo history.
   */
  typing: EditorTypingOptions;
  /**
   * The tokenizer's two theme names.
   *
   * Part of the live options rather than of the document key: two tabs in
   * different languages are two states (their decorations are built from
   * different grammars), but a THEME is one setting for every tab — a new key
   * per theme would throw away every open tab's undo history on a colour change.
   */
  themes: ShikiThemeNames;
  /**
   * Text drawn while a document is empty, or absent for none.
   *
   * Creation-time rather than a compartment: it is a constant per call site
   * ("This file is empty"), so a reconfigure path for it would be a transaction
   * nobody dispatches.
   */
  placeholder?: string;
}

export interface DocumentCacheDeps extends SurfaceOptions {
  /** Panel-owned commands the editor delegates instead of running. */
  onCommand?: (command: EditorCommand) => void;
  /** Every user edit, with the whole new document. */
  onDocChange: (value: string) => void;
  /** Every state worth remembering (an edit or a selection move). */
  onState: (state: EditorState) => void;
  /** The caret's line and column, for a status readout. */
  onCaret?: (position: { line: number; column: number }) => void;
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
  /**
   * Effects that install a stream language on `key`'s document.
   *
   * The mode is a lazy import, so a document is created WITHOUT one and gets it
   * here when the module lands. Reconfiguring the compartment keeps the
   * document, the selection and the undo history — it only swaps the parser.
   */
  languageEffects(key: string, language: Extension): StateEffect<unknown>[];
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
    blame: deps.blame ?? null,
    themes: deps.themes,
    indentUnitText: deps.indentUnitText,
    typing: deps.typing,
    placeholder: deps.placeholder,
  };
  const wordWrapCompartment = new Compartment();
  const blameCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();
  const indentCompartment = new Compartment();
  const typingCompartment = new Compartment();
  const themeCompartment = new Compartment();
  /**
   * The stream language, when its module has loaded.
   *
   * Per DOCUMENT rather than per view: two tabs in different languages are two
   * states, and a reconfigure of one must not touch the other's tree. It starts
   * empty and is filled by `languageEffects`, which is what the loader's
   * notification drives.
   */
  const languageCompartment = new Compartment();
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
  /**
   * The indentation unit each cached state currently holds.
   *
   * Tracked for the same reason as `themesByKey`: `currentEffects` runs on every tab
   * switch, and reconfiguring a compartment with the value it already has is work
   * for nothing on a file with a large gutter.
   */
  const indentByKey = new Map<string, string>();
  /**
   * The blame extension each cached state currently holds.
   *
   * Tracked for the same reason as `themesByKey`: `currentEffects` runs on every
   * tab switch, and reconfiguring a compartment with the value it already has
   * costs a transaction for nothing — here it would also re-create the label
   * plugin, which rebuilds every decoration on the viewport.
   */
  const blameByKey = new Map<string, Extension | null>();

  const extensionsFor = (language: string): Extension[] =>
    surfaceExtensions({
      language,
      wordWrapCompartment,
      readOnlyCompartment,
      themeCompartment,
      languageCompartment,
      indentCompartment,
      typingCompartment,
      blameCompartment,
      blame: options.blame ?? null,
      onCommand: deps.onCommand,
      onDocChange: deps.onDocChange,
      onState: deps.onState,
      onCaret: deps.onCaret,
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
      indentByKey.set(key, options.indentUnitText);
      blameByKey.set(key, options.blame ?? null);
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
      indentByKey.delete(key);
      blameByKey.delete(key);
    },

    optionsEffects(next, key) {
      const wrapChanged = next.wordWrap !== options.wordWrap;
      const readOnlyChanged = next.readOnly !== options.readOnly;
      const nextBlame = next.blame ?? null;
      const blameChanged = nextBlame !== options.blame;
      const indentChanged = next.indentUnitText !== options.indentUnitText;
      const typingChanged =
        next.typing.autoCloseBrackets !== options.typing.autoCloseBrackets ||
        next.typing.autocomplete !== options.typing.autocomplete;
      const themeChanged = next.themes.light !== options.themes.light || next.themes.dark !== options.themes.dark;
      options.wordWrap = next.wordWrap;
      options.readOnly = next.readOnly;
      options.blame = nextBlame;
      options.themes = next.themes;
      options.indentUnitText = next.indentUnitText;
      options.typing = next.typing;
      const effects: StateEffect<unknown>[] = [];
      if (wrapChanged) effects.push(wordWrapCompartment.reconfigure(wrapExtension(options.wordWrap)));
      // A reading aid, so the same rule as wrap: reconfigure, never re-mount.
      if (blameChanged) {
        effects.push(blameCompartment.reconfigure(options.blame ?? []));
        if (key) blameByKey.set(key, options.blame ?? null);
      }
      if (readOnlyChanged) effects.push(readOnlyCompartment.reconfigure(readOnlyExtension(options.readOnly)));
      // The indent unit AND the tab size move together: a tab-indented setting is
      // one column wide as a unit, and `getIndentUnit` reads `tabSize` to measure
      // it — so a reconfigure of one without the other would measure a level wrong.
      if (indentChanged) {
        effects.push(indentCompartment.reconfigure(indentExtension(options.indentUnitText)));
        if (key) indentByKey.set(key, options.indentUnitText);
      }
      // A BEHAVIOUR toggle reconfigures rather than re-mounts, so an open tab keeps its
      // undo history when the user flips auto-close or the completer.
      if (typingChanged) effects.push(typingCompartment.reconfigure(typingExtensions(options.typing)));
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
      // A cached state carries the configuration it was CREATED with, so a tab
      // opened before the toggle was pressed would come back with the other
      // answer for its whole life.
      const blame = options.blame ?? null;
      if (key && blameByKey.get(key) !== blame) {
        effects.push(blameCompartment.reconfigure(blame ?? []));
        blameByKey.set(key, blame);
      }
      const language = key ? languages.get(key) : undefined;
      // A cached state carries the unit it was CREATED with, so a tab opened before
      // the setting changed would indent by the old width for its whole life.
      if (key && indentByKey.get(key) !== options.indentUnitText) {
        effects.push(indentCompartment.reconfigure(indentExtension(options.indentUnitText)));
        indentByKey.set(key, options.indentUnitText);
      }
      // Only when this state's tokenizer still holds another theme: a switch
      // back to a tab that already has it must not re-tokenize.
      if (key && language && !sameThemes(themesByKey.get(key), options.themes)) {
        effects.push(themeCompartment.reconfigure(shikiHighlight(language, options.themes)));
        themesByKey.set(key, options.themes);
      }
      return effects;
    },

    languageEffects(key, language) {
      // Only a document this cache owns can be reconfigured; a key it has never
      // seen is a caller asking about a tab that closed while the mode loaded.
      if (!states.has(key)) return [];
      return [languageCompartment.reconfigure(language)];
    },
  };
}
