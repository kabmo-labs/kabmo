/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The panel's two reads, and the refs that keep them from looping.
 *
 * `useRpc` returns a FRESH state object per render, so `call` is a new function
 * every time. Putting it in an effect's dependency list re-runs the read on every
 * render, and the read's own `setState` renders again — the unbounded loop the
 * command-runner measured (hundreds of requests in seconds, which also starved
 * the render so nothing appeared). The ref holds the newest `call` while the
 * effect is keyed on the SCOPE, which is the real trigger.
 *
 * Both reads are also SKIPPED when the panel is not the visible view: a hidden
 * panel that keeps reading a forge API spends the reader's rate limit for
 * nothing, and the desktop stack keeps every built-in view mounted.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useRpc } from '@kabmo-labs/kabmo-ui';

import { RPC, type ForgeDetail, type ForgeList, type ForgeSection, type ForgeState } from '../protocol';

export interface Scope {
  root: string;
  repo: string;
}

export interface ForgeListState {
  list: ForgeList | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/** All three sections for one scope and one state filter. */
export function useForgeList(scope: Scope | null, state: ForgeState, active: boolean): ForgeListState {
  const call = useRpc<{ root: string; repo: string; state: ForgeState }, ForgeList>(RPC.list);
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
    const outcome = await callRef.current({ ...scope, state });
    setLoading(false);
    if (outcome.ok) {
      setList(outcome.value as ForgeList);
      setError(null);
    } else {
      // A refusal is REPORTED, never rendered as an empty list: the two look the
      // same on screen and only one is actionable.
      setError(outcome.error.message);
    }
  }, [scope?.root, scope?.repo, state]);

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

  const callRef = useRef(call.call);
  callRef.current = call.call;

  useEffect(() => {
    if (!scope || !id || !active) {
      setDetail(null);
      setError(null);
      return;
    }
    let cancelled = false;
    setDetail(null);
    setError(null);
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
  }, [scope?.root, scope?.repo, section, id, active]);

  return { detail, error, loading };
}
