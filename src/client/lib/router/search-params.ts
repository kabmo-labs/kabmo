import { useCallback, useSyncExternalStore } from 'preact/compat';

/**
 * `useSearchParams` replacement. The app's only routing state is `?sessionId=`
 * (plus `?folderId=`), so this is a subscription over `location.search` with the
 * same `[params, setParams]` tuple the Remix hook returned — including the
 * functional-updater form, so call sites keep working unchanged.
 *
 * The search string lives in ONE module-level store, not per-component state:
 * Remix shared router state across every mounted component, so a `setParams`
 * call from the sidebar must re-render `App` and the chat timeline too. With
 * per-component `useState` only the caller re-rendered and the rest of the tree
 * kept reading the stale value (selecting a session updated the URL but left
 * "No session selected" on screen).
 */

type SetParamsInit = URLSearchParams | Record<string, string> | string;
type SetParamsFn = (prev: URLSearchParams) => URLSearchParams;
type SetParams = (next: SetParamsInit | SetParamsFn, options?: { replace?: boolean }) => void;

/** The functional setter `useSearchParams` returns, under a name a caller can
 *  declare a prop with instead of re-stating the signature. */
export type SetSearchParams = SetParams;

const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * The search string of the window in scope RIGHT NOW, never a value cached when
 * this module was first evaluated.
 *
 * A module-level `currentSearch` reads as a harmless cache and is not: it pins
 * the store to whichever `window` existed at import time, and so does the
 * `popstate` listener below. In the browser there is one window forever and the
 * two are equivalent; under `bun test` every DOM suite installs its OWN window,
 * so the pinned pair made the router answer a URL nobody can see and miss
 * `popstate` on the window the suite is actually driving — measured: a suite
 * that set `?sessionId=` and mounted the composer read `''` and drew the
 * landing, failing a case that passes when its file runs alone.
 */
function liveSearch(): string {
  // `window` present but carrying no `location` is a real runtime shape, not a
  // typo: `installDomGlobals({})` builds one on purpose (the SSR case), and a
  // suite that restored its globals leaves a `globalThis`-as-window stand-in
  // behind. Reading through the chain answers "no query string" there instead of
  // throwing a TypeError — measured on the Windows gate, where exactly that
  // killed `list-slots.test.ts` and `plugin-contributions.test.ts` with a stack
  // naming neither of them.
  const search = typeof window === 'undefined' ? undefined : window.location?.search;
  return typeof search === 'string' ? search : '';
}

/**
 * The window this store is currently listening on.
 *
 * Rebound on subscribe rather than once at module load, for the reason above:
 * a suite that replaces `globalThis.window` must get a router that follows it.
 */
let boundWindow: Window | undefined;

function onPopState(): void {
  emit();
}

function bindToCurrentWindow(): void {
  const next = typeof window === 'undefined' ? undefined : window;
  if (next === boundWindow) return;
  // Both calls are guarded the same way `liveSearch` is: a stub window (the
  // SSR `{}`, a `globalThis` stand-in) has no listener API, and subscribing a
  // component must not throw because the suite that owns the globals has ended.
  if (typeof boundWindow?.removeEventListener === 'function') boundWindow.removeEventListener('popstate', onPopState);
  boundWindow = next;
  // Back/forward navigation. `pushState`/`replaceState` do NOT fire popstate,
  // so setParams notifies directly.
  if (typeof next?.addEventListener === 'function') next.addEventListener('popstate', onPopState);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  bindToCurrentWindow();
  return () => listeners.delete(listener);
}

function toSearchString(init: SetParamsInit): string {
  if (typeof init === 'string') return init.startsWith('?') ? init : `?${init}`;
  if (init instanceof URLSearchParams) return init.toString() ? `?${init.toString()}` : '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(init)) {
    if (value !== undefined && value !== null) params.set(key, String(value));
  }
  return params.toString() ? `?${params.toString()}` : '';
}

function resolveNext(next: SetParamsInit | SetParamsFn, current: URLSearchParams): string {
  if (typeof next === 'function') return toSearchString(next(new URLSearchParams(current)));
  return toSearchString(next);
}

export function useSearchParams(): [URLSearchParams, SetParams] {
  // Preact's `useSyncExternalStore` takes only (subscribe, getSnapshot) — no
  // server-snapshot argument — and the app is client-rendered, so the live
  // `location.search` is the single source of truth. It is read on demand, and
  // `useSyncExternalStore` compares snapshots by value, so an unchanged URL
  // costs one string comparison and no render.
  const search = useSyncExternalStore(subscribe, liveSearch);

  const setParams = useCallback<SetParams>((next, options) => {
    const searchString = resolveNext(next, new URLSearchParams(liveSearch()));
    const url = `${window.location.pathname}${searchString}${window.location.hash}`;
    if (options?.replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
    emit();
  }, []);

  return [new URLSearchParams(search), setParams];
}
