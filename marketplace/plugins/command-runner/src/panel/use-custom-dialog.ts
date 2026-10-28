/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The add/edit dialog's state and its three calls.
 *
 * Split out of `app.tsx` when that file crossed the 350-line ceiling, and the
 * seam is real: this is one self-contained concern — which dialog is open, what
 * the server said about the last save, and what a save or a delete does to the
 * list. `app.tsx` keeps the scan, the runs and the layout.
 *
 * ## Every mutation re-scans, and that is not defensive
 *
 * A save can MOVE a row: the record id is derived from the scope and the slug, so
 * editing `deploy staging` into `deploy prod`, or switching it between scopes,
 * writes a different row and removes the old one. The list on screen is therefore
 * stale the moment the answer lands, and a panel that kept it would show the old
 * label until something else happened to trigger a scan.
 *
 * ## The two RPC handles are held in refs
 *
 * `useRpc` returns a fresh state object per render, so `save.call` is a new
 * function every time — as a `useCallback` dependency it would rebuild the
 * handlers on every render and, through `scan`'s own setState, loop. The ref
 * keeps each handler keyed on the scope, which is the real trigger.
 */

import { useCallback, useRef, useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, type Command, type CustomCommand } from '../protocol';

export interface CustomDialogHandle {
  /** True while the dialog is rendered. */
  open: boolean;
  /** The command being edited, or null while adding one. */
  editing: CustomCommand | null;
  /** The server's refusal of the last save. */
  error: string | null;
  /** Open on nothing — a new command. */
  add: () => void;
  /** Open on a stored command, from the row that was clicked. */
  edit: (command: Command) => void;
  remove: (command: Command) => void;
  submit: (input: { command: string; scope: 'global' | 'repo'; cwd: string; previousId: string | null }) => void;
  close: () => void;
}

export function useCustomDialog(args: {
  /** The workspace root a `repo` command would belong to, or null. */
  root: string | null;
  /** Re-read the listing after a mutation lands. */
  rescan: () => Promise<void>;
}): CustomDialogHandle {
  const { root, rescan } = args;
  const save = useRpc<Record<string, unknown>, CustomCommand | { error: string }>(RPC.customSave);
  const removeRpc = useRpc<{ id: string }, { removed: boolean }>(RPC.customRemove);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CustomCommand | null>(null);
  const [error, setError] = useState<string | null>(null);

  const saveRef = useRef(save.call);
  saveRef.current = save.call;
  const removeRef = useRef(removeRpc.call);
  removeRef.current = removeRpc.call;

  const add = useCallback(() => {
    setEditing(null);
    setError(null);
    setOpen(true);
  }, []);

  /**
   * Open on a stored command.
   *
   * The entry travels on the ROW's own `command.custom` rather than being looked
   * up here: the row was drawn from the listing, so it holds the record the user
   * is looking at, and a lookup by id would be a second way to find the same
   * thing that could disagree with it.
   */
  const edit = useCallback((command: Command) => {
    if (!command.custom) return;
    setEditing(command.custom);
    setError(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setEditing(null);
    setError(null);
  }, []);

  /**
   * Save, then re-read the listing.
   *
   * A refusal keeps the dialog OPEN with the server's own sentence — a dialog
   * that closed on a refusal would read as a successful save, and the server's
   * message is the only place the real reason exists (a slug that came out empty,
   * a row that moved under a concurrent edit).
   */
  const submit = useCallback(
    (input: { command: string; scope: 'global' | 'repo'; cwd: string; previousId: string | null }) => {
      void (async () => {
        // A global command stores no root: the field means "which workspace", and
        // a stale path there would read as one.
        const outcome = await saveRef.current({ ...input, root: input.scope === 'repo' ? root : null });
        if (!outcome.ok) {
          setError(outcome.error.message);
          return;
        }
        const value = outcome.value as CustomCommand | { error: string };
        if ('error' in value) {
          setError(value.error);
          return;
        }
        close();
        await rescan();
      })();
    },
    [root, rescan, close],
  );

  /**
   * Delete a stored command.
   *
   * Confirmed, because the row is the ONLY copy: a stored command lives in the
   * Kabmo's own storage, not in a file, so there is no git history to restore it
   * from and nothing to re-derive it from.
   */
  const remove = useCallback(
    (command: Command) => {
      if (!command.custom) return;
      if (!globalThis.confirm(`Delete "${command.label}"?`)) return;
      void (async () => {
        await removeRef.current({ id: command.custom!.id });
        await rescan();
      })();
    },
    [rescan],
  );

  return { open, editing, error, add, edit, remove, submit, close };
}
