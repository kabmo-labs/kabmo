/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's reads, and the refs that keep them from looping.
 *
 * `useRpc` returns a FRESH state object per render, so `call` is a new function
 * every time. Putting it in an effect's dependency list re-runs the read on every
 * render, and the read's own `setState` renders again — the unbounded loop the
 * command-runner measured (hundreds of requests in seconds, which also starved
 * the render so nothing appeared). The ref holds the newest `call` while the
 * effect is keyed on the SCOPE and the FILTER, which are the real triggers.
 *
 * Both reads are also SKIPPED when the panel is not the visible view: a hidden
 * panel that keeps reading a forge API spends the reader's rate limit for
 * nothing, and the desktop stack keeps every built-in view mounted.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import {
  RPC,
  type ForgeCredential,
  type ForgeDetail,
  type ForgeFilter,
  type ForgeList,
  type ForgeSection,
  type ForgeWrite,
  type ForgeWriteResult,
} from '../protocol';

export interface Scope {
  root: string;
  repo: string;
}

/** A filter's identity, for an effect key: every field that changes a read. */
export function filterKey(filter: ForgeFilter): string {
  return `${filter.state}\u0000${filter.mine ? '1' : '0'}\u0000${filter.label}\u0000${filter.query}`;
}

export interface ForgeListState {
  list: ForgeList | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** All three sections for one scope and one filter. */
export function useForgeList(scope: Scope | null, filter: ForgeFilter, active: boolean): ForgeListState {
  const call = useRpc<{ root: string; repo: string; filter: ForgeFilter }, ForgeList>(RPC.list);
  const [list, setList] = useState<ForgeList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const callRef = useRef(call.call);
  callRef.current = call.call;

  const read = useCallback(async () => {
    if (!scope) {
      setList(null);
      setError(null);
      return;
    }
    setLoading(true);
    const outcome = await callRef.current({ ...scope, filter });
    setLoading(false);
    if (outcome.ok) {
      setList(outcome.value as ForgeList);
      setError(null);
    } else {
      // A refusal is REPORTED, never rendered as an empty list: the two look the
      // same on screen and only one is actionable.
      setError(outcome.error.message);
    }
  }, [scope?.root, scope?.repo, filterKey(filter)]);

  useEffect(() => {
    if (!active) return;
    void read();
  }, [read, active]);

  return { list, error, loading, reload: read };
}

export interface ForgeDetailState {
  detail: ForgeDetail | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * One item's page.
 *
 * Keyed on the pick, so selecting a different row reads again — and CLEARED the
 * moment the pick changes, because a detail left on screen while the next one
 * loads shows the previous item's body under the new item's title.
 */
export function useForgeDetail(
  scope: Scope | null,
  section: ForgeSection,
  id: string | null,
  active: boolean,
): ForgeDetailState {
  const call = useRpc<{ root: string; repo: string; section: ForgeSection; id: string }, ForgeDetail>(RPC.detail);
  const [detail, setDetail] = useState<ForgeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Bumped after a write, so the same item is read again. */
  const [revision, setRevision] = useState(0);
  /** The pick the value on screen belongs to, so a RELOAD does not clear it. */
  const shownKey = useRef<string | null>(null);

  const callRef = useRef(call.call);
  callRef.current = call.call;

  useEffect(() => {
    if (!scope || !id || !active) {
      setDetail(null);
      setError(null);
      shownKey.current = null;
      return;
    }
    // A different ITEM is a different document, so the previous one goes. A
    // RELOAD of the same item — what a write triggers — must not: clearing it
    // unmounted the write bar (and the notice saying the write landed), and
    // blanked the body for the length of the read.
    const key = `${scope.root}\u0000${scope.repo}\u0000${section}\u0000${id}`;
    const different = shownKey.current !== key;
    shownKey.current = key;
    let cancelled = false;
    if (different) {
      setDetail(null);
      setError(null);
    }
    setLoading(true);
    void callRef.current({ ...scope, section, id }).then((outcome) => {
      if (cancelled) return;
      setLoading(false);
      if (outcome.ok) setDetail(outcome.value as ForgeDetail);
      else setError(outcome.error.message);
    });
    return () => {
      cancelled = true;
    };
  }, [scope?.root, scope?.repo, section, id, active, revision]);

  return { detail, error, loading, reload: () => setRevision((value) => value + 1) };
}

export interface ForgeWriteState {
  /** The last refusal or failure, as a sentence. Cleared by a new write. */
  error: string | null;
  /** The last success, as a sentence. */
  notice: string | null;
  pending: boolean;
  run: (write: ForgeWrite) => Promise<boolean>;
  clear: () => void;
}

/**
 * One write, and the re-read it owes.
 *
 * A success is NOT repainted from the answer alone: the host's reply is the item
 * it changed, but the conversation, the files and the CI verdict all move with
 * it, so the detail is read again. The optimistic patch exists only to keep the
 * state badge honest for the frame before that read lands.
 */
export function useForgeWrite(
  scope: Scope | null,
  section: ForgeSection,
  id: string | null,
  onDone: () => void,
): ForgeWriteState {
  const call = useRpc<{ root: string; repo: string; section: ForgeSection; id: string; write: ForgeWrite }, ForgeWriteResult>(
    RPC.write,
  );
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const callRef = useRef(call.call);
  callRef.current = call.call;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  const run = useCallback(
    async (write: ForgeWrite) => {
      if (!scope || !id) return false;
      setPending(true);
      setError(null);
      setNotice(null);
      const outcome = await callRef.current({ ...scope, section, id, write });
      setPending(false);
      if (!outcome.ok) {
        // A refusal is REPORTED with the host's or the capability table's own
        // words: "the token may not have scope" is actionable, "failed" is not.
        setError(outcome.error.message);
        return false;
      }
      setNotice((outcome.value as ForgeWriteResult).message);
      doneRef.current();
      return true;
    },
    [scope?.root, scope?.repo, section, id],
  );

  return {
    error,
    notice,
    pending,
    run,
    clear: () => {
      setError(null);
      setNotice(null);
    },
  };
}

/**
 * Which credential the server resolved, so the panel can say where one came from.
 *
 * Read once per mount and not again: a token does not appear mid-session without
 * the server restarting, and a poll would be a request per minute for a value
 * that cannot change.
 */
export function useForgeCredential(scope: Scope | null, active: boolean): ForgeCredential | null {
  const call = useRpc<{ root: string; repo: string }, ForgeCredential>(RPC.credential);
  const [credential, setCredential] = useState<ForgeCredential | null>(null);
  const callRef = useRef(call.call);
  callRef.current = call.call;

  useEffect(() => {
    if (!scope || !active) return;
    let cancelled = false;
    void callRef.current({ ...scope }).then((outcome) => {
      if (cancelled || !outcome.ok) return;
      setCredential(outcome.value as ForgeCredential);
    });
    return () => {
      cancelled = true;
    };
  }, [scope?.root, scope?.repo, active]);

  return credential;
}
