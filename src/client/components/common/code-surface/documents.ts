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

/** States kept alive; past this the least recently used one is dropped. */
const MAX_CACHED = 12;

export interface SurfaceOptions {
  wordWrap: boolean;
  readOnly: boolean;
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
  /** Effects that bring a view to the current options; empty when nothing moved. */
  optionsEffects(next: SurfaceOptions): StateEffect<unknown>[];
  /**
   * Effects that install the CURRENT options unconditionally.
   *
   * A cached state carries the configuration it was created with, and
   * `view.setState` installs that configuration wholesale — so a tab opened
   * while wrap was off came back unwrapped after a toggle. This is the re-apply
   * a document switch owes.
   */
  currentEffects(): StateEffect<unknown>[];
}

export function createDocumentCache(deps: DocumentCacheDeps): DocumentCache {
  const states = new Map<string, EditorState>();
  const options: SurfaceOptions = { wordWrap: deps.wordWrap, readOnly: deps.readOnly };
  const wordWrapCompartment = new Compartment();
  const readOnlyCompartment = new Compartment();

  const extensionsFor = (language: string): Extension[] =>
    surfaceExtensions({
      language,
      wordWrapCompartment,
      readOnlyCompartment,
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
      evict();
      return state;
    },

    remember(key, state) {
      touch(key, state);
    },

    drop(key) {
      states.delete(key);
    },

    optionsEffects(next) {
      const wrapChanged = next.wordWrap !== options.wordWrap;
      const readOnlyChanged = next.readOnly !== options.readOnly;
      options.wordWrap = next.wordWrap;
      options.readOnly = next.readOnly;
      const effects: StateEffect<unknown>[] = [];
      if (wrapChanged) effects.push(wordWrapCompartment.reconfigure(wrapExtension(options.wordWrap)));
      if (readOnlyChanged) effects.push(readOnlyCompartment.reconfigure(readOnlyExtension(options.readOnly)));
      return effects;
    },

    currentEffects() {
      return [
        wordWrapCompartment.reconfigure(wrapExtension(options.wordWrap)),
        readOnlyCompartment.reconfigure(readOnlyExtension(options.readOnly)),
      ];
    },
  };
}
