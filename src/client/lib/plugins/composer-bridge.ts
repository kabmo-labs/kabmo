/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The composer's live state, published to the plugin kit.
 *
 * A module-level value rather than a Preact context, for the same reason
 * `pluginContext` is one: the kit is a PUBLISHED package and cannot import the
 * host's source, so the seam is `configureUiKit` — and a context object would
 * have to be threaded through every surface that renders a plugin (the chat
 * dock, the New Chat modal, the side-question form, a settings pane).
 *
 * The write half is the part that matters. A plugin's `set`/`insert` must go
 * through the SAME state the chat owns, never the DOM: the composer is a
 * controlled textarea, so a DOM write is reverted by the next keystroke and the
 * plugin's edit vanishes with no error. The host therefore registers a writer
 * here from whichever composer is live, and the kit calls it.
 */

import type { ComposerService, ComposerState } from '@kabmo-labs/kabmo-ui';

type Listener = (state: ComposerState) => void;

/** What the live composer can be asked to do. */
type ComposerWriter = Pick<ComposerService, 'set' | 'insert' | 'focus'>;

interface ComposerSlot {
  state: ComposerState;
  writer: ComposerWriter | null;
  listeners: Set<Listener>;
}

/**
 * Process-wide, for the reason every other plugin registry here is: under
 * `bun --hot` this module re-evaluates while a mounted composer still holds the
 * unsubscribe it was handed, and a module-level map would come back empty.
 */
declare global {
  // eslint-disable-next-line no-var
  var __kabmoComposerSlot: ComposerSlot | undefined;
}

const EMPTY: ComposerState = {
  text: '',
  isEmpty: true,
  isSubmitting: false,
  scope: { kind: 'new', sessionId: null },
};

function slot(): ComposerSlot {
  return (globalThis.__kabmoComposerSlot ??= { state: EMPTY, writer: null, listeners: new Set() });
}

/** The composer as it stands. Cheap: the same object until a write moves it. */
export function composerState(): ComposerState {
  return slot().state;
}

export function subscribeComposer(listener: Listener): () => void {
  const listeners = slot().listeners;
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The service the kit reads.
 *
 * Every method delegates to the LIVE writer, so a plugin's `insert` lands in
 * whichever composer is on screen — the chat dock, the New Chat modal — rather
 * than in a copy captured at mount.
 */
export function composerService(): ComposerService {
  const current = slot();
  return {
    ...current.state,
    set: (text) => current.writer?.set(text),
    insert: (text) => current.writer?.insert(text),
    focus: () => current.writer?.focus(),
  };
}

/**
 * Publish a composer's state, and optionally its writer.
 *
 * Called from the composer on every change, so a plugin's `useComposer()` is
 * reactive to a keystroke. A no-op when nothing moved, so a re-render that
 * passes the same draft does not wake every plugin component.
 */
export function setComposerState(state: ComposerState, writer?: ComposerWriter): void {
  const current = slot();
  if (writer) current.writer = writer;
  const unchanged =
    current.state.text === state.text &&
    current.state.isSubmitting === state.isSubmitting &&
    current.state.scope.kind === state.scope.kind &&
    current.state.scope.sessionId === state.scope.sessionId;
  if (unchanged && writer === undefined) return;
  current.state = state;
  for (const listener of [...current.listeners]) listener(state);
}

/** Drop the writer when a composer unmounts, so a plugin cannot write into a gone one. */
export function clearComposerWriter(): void {
  slot().writer = null;
}
