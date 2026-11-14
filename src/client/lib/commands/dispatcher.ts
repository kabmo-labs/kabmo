/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The one keydown listener.
 *
 * Every global chord in the app resolves here. A surface that owns a key
 * locally (a modal's Escape, the editor's text commands) calls
 * `preventDefault` or `stopPropagation` first, and this listener respects both
 * — that is the whole contract, and it is why a component never needs to know
 * which other component might also be listening.
 *
 * A two-stroke chord enters a PENDING state. The first stroke is consumed
 * (`preventDefault`) because otherwise it would type a character; the pending
 * prefix is published so the UI can show what it is waiting for.
 */

import { resolveKey } from '@/shared/lib/commands/resolve';
import { strokeOfEvent } from '@/shared/lib/commands/chord';
import type { Chord } from '@/shared/lib/commands/types';
import { commandContext } from '@/client/lib/commands/context';
import { effectiveRules } from '@/client/lib/commands/keymap';
import { runCommand } from '@/client/lib/commands/registry';

interface DispatcherState {
  installed: boolean;
  pending: Chord | null;
  listeners: Set<(chord: Chord | null) => void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCommandDispatcher: DispatcherState | undefined;
}

function state(): DispatcherState {
  return (globalThis.__kabmoCommandDispatcher ??= { installed: false, pending: null, listeners: new Set() });
}

function publishPending(): void {
  const pending = state().pending;
  for (const listener of [...state().listeners]) listener(pending);
}

export function pendingChord(): Chord | null {
  return state().pending;
}

export function subscribePendingChord(listener: (chord: Chord | null) => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}

/** Install the listener once per page. Returns a disposer for tests. */
export function installCommandDispatcher(): () => void {
  const current = state();
  if (current.installed) return () => {};
  current.installed = true;

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;

    if (event.key === 'Escape' && current.pending) {
      current.pending = null;
      publishPending();
      return;
    }

    const resolution = resolveKey(effectiveRules(), strokeOfEvent(event), commandContext(), current.pending);

    if (resolution.kind === 'run') {
      current.pending = null;
      publishPending();
      event.preventDefault();
      runCommand(resolution.rule.command);
      return;
    }

    if (resolution.kind === 'pending') {
      current.pending = resolution.prefix;
      publishPending();
      event.preventDefault();
      return;
    }

    if (current.pending) {
      current.pending = null;
      publishPending();
    }
  };

  window.addEventListener('keydown', onKeyDown);
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    current.installed = false;
    current.pending = null;
    publishPending();
  };
}
