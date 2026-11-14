/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The context keys a `when` clause reads.
 *
 * One store, written by the surfaces that know the fact (the layout knows which
 * columns are open, the editor knows whether its text has focus) and read by
 * the dispatcher on every keystroke. A surface that forgets to clear its key on
 * unmount would leave a command enabled forever, so the hook form clears on
 * cleanup.
 */

import type { CommandContext } from '@/shared/lib/commands/types';

type Value = boolean | string | number | undefined;

interface ContextState {
  values: Record<string, Value>;
  listeners: Set<() => void>;
}

declare global {
  // eslint-disable-next-line no-var
  var __kabmoCommandContext: ContextState | undefined;
}

function state(): ContextState {
  return (globalThis.__kabmoCommandContext ??= { values: {}, listeners: new Set() });
}

/** Write one key. A no-op when the value did not move, so a re-render does not
 *  wake every subscriber. */
export function setCommandContext(key: string, value: Value): void {
  const values = state().values;
  if (values[key] === value) return;
  values[key] = value;
  for (const listener of [...state().listeners]) listener();
}

/** The context as it stands. A fresh object, so a caller cannot mutate it. */
export function commandContext(): CommandContext {
  return { ...state().values };
}

export function subscribeCommandContext(listener: () => void): () => void {
  state().listeners.add(listener);
  return () => state().listeners.delete(listener);
}
