/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shell transport, and the reason every other module asks this one whether it
 * is running inside a shell.
 *
 * FIVE shells speak to this page, and they do NOT all inject the same thing:
 *
 * - `packages/macos` / `packages/windows` / `packages/linux` install
 *   `window.__kabmoCall` themselves, at document start, together with
 *   `window.__kabmoDesktop` (their identity). Nothing in this file has to run for
 *   them: `installShellTransport` is a no-op when a call function already exists.
 * - `packages/android` exposes only `window.kabmoHost` (a `@JavascriptInterface`),
 *   and `packages/ios` only `window.webkit.messageHandlers.kabmo`. Neither can
 *   inject script before the page, so THIS module adapts their transport into
 *   `__kabmoCall` — one shape for the whole console — from
 *   `installShellTransport()` in `main.tsx`.
 *
 * The split between `isDesktopShell()` and `isMobileShell()` is load-bearing, not
 * bookkeeping: `titlebarInsetLeft` treats "a shell, with no identity" as a macOS
 * window whose traffic lights float over the page's left edge. A phone that
 * answered `isDesktopShell() === true` would reserve 5rem for controls it does
 * not have and draw its wordmark 80px from the edge.
 *
 * Params cross the mobile transport FORM-ENCODED (`k=v&k=v`), not as JSON:
 * Android's `org.json` is a stub in a JVM unit test, so a JSON wire would leave
 * the parser that most needs a test as the only one that cannot have one. State
 * comes back as JSON TEXT for the same reason — the native side builds one string,
 * and the page parses it in the one place that has a real JSON parser.
 */

/** Which shell host is answering, once one is present. */
export type ShellHostKind = 'desktop' | 'android' | 'ios';

/** What a phone's native side exposes. Android only; iOS uses WebKit messages. */
interface AndroidHost {
  post: (method: string, id: string, params: string) => void;
}

declare global {
  interface Window {
    __kabmoCall?: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
    __kabmoReply?: (id: number, ok: boolean, payload: unknown) => void;
    /** Set by `installShellTransport` — which host answered this page. */
    __kabmoShellHost?: 'android' | 'ios';
    kabmoHost?: AndroidHost;
    webkit?: {
      messageHandlers?: {
        kabmo?: { postMessage: (message: unknown) => void };
      };
    };
  }
}

/** The host object a phone's native side has already installed, if any. */
function detectedHost(): 'android' | 'ios' | null {
  if (typeof window === 'undefined') return null;
  if (window.kabmoHost) return 'android';
  if (window.webkit?.messageHandlers?.kabmo) return 'ios';
  return null;
}

/**
 * Which shell this page is inside, or null in a browser.
 *
 * A desktop shell is identified by the transport it installed by itself; a phone
 * by the host object its native side exposes (or by the marker
 * `installShellTransport` wrote once it adapted that host).
 */
export function shellHost(): ShellHostKind | null {
  if (typeof window === 'undefined') return null;
  const marked = window.__kabmoShellHost;
  if (marked) return marked;
  // The DESKTOP trio is asked FIRST, and not for tidiness: macOS and Linux post
  // over `window.webkit.messageHandlers.kabmo` — the very handler name iOS uses
  // — so a phone-first check read every macOS/Linux shell as `ios`,
  // `isDesktopShell()` answered false, and `titlebarInsetLeft` stopped reserving
  // the 5rem macOS keeps for its traffic lights. The wordmark and the drawer's
  // title were drawn UNDER close / minimise / maximise.
  if (window.__kabmoDesktop) return 'desktop';
  if (typeof window.__kabmoCall === 'function') return 'desktop';
  return detectedHost();
}

/** True once some shell answers `__kabmoCall` — desktop or a phone. */
export function hasShellBridge(): boolean {
  if (typeof window === 'undefined') return false;
  if (typeof window.__kabmoCall === 'function') return true;
  return detectedHost() !== null;
}

/** True in the macOS / Windows / Linux shells. */
export function isDesktopShell(): boolean {
  return shellHost() === 'desktop';
}

/** True in the Android / iOS shells. */
export function isMobileShell(): boolean {
  const host = shellHost();
  return host === 'android' || host === 'ios';
}

/** `{ label: 'NAS', port: 3000 }` → `label=NAS&port=3000`. */
function encodeParams(params: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const text = value === null ? '' : String(value);
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(text)}`);
  }
  return parts.join('&');
}

/**
 * How long a phone's shell gets to answer one command.
 *
 * `servers_state` PROBES every stored URL (`GET /api/health`, 6 s each), so the
 * budget has to cover a short list of unreachable servers rather than a single
 * round trip. A timeout here reports the shell as unresponsive, which is the
 * honest answer for a native thread that never replied.
 */
const REPLY_TIMEOUT_MS = 60_000;

/**
 * Adapt a phone's native transport into the `__kabmoCall` shape the console uses.
 *
 * Idempotent, and a no-op in a browser and in a desktop shell (both either have no
 * host or already have the function). Installed before the first render, so the
 * server control is drawn on the first paint.
 */
export function installShellTransport(): void {
  if (typeof window === 'undefined') return;
  // A desktop shell installed its own transport before the page's scripts, and
  // macOS/Linux expose the same WebKit handler name a phone does — so this test
  // is the identity, not `detectedHost()`.
  if (window.__kabmoDesktop) return;
  if (typeof window.__kabmoCall === 'function') return;
  const host = detectedHost();
  if (!host) return;

  window.__kabmoShellHost = host;

  // The bare globals, not `window.setTimeout`: this file's tests install a
  // minimal `window`, and the timer is the one thing they must not have to fake.
  /** The handle this runtime hands back: a number in a browser, an object under Bun. */
  type TimerHandle = ReturnType<typeof setTimeout>;

  interface PendingReply {
    resolve: (value: unknown) => void;
    reject: (reason: Error) => void;
    timer: TimerHandle;
  }
  const pending = new Map<number, PendingReply>();
  let next = 1;

  window.__kabmoReply = (id, ok, payload) => {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    clearTimeout(entry.timer);
    if (!ok) {
      entry.reject(new Error(typeof payload === 'string' ? payload : 'The shell refused that command.'));
      return;
    }
    // State crosses as JSON TEXT (see this module's header): an unparseable answer
    // is still the shell's answer, so it resolves as-is rather than turning a
    // working command into a failure.
    if (typeof payload !== 'string') {
      entry.resolve(payload);
      return;
    }
    try {
      entry.resolve(JSON.parse(payload));
    } catch {
      entry.resolve(payload);
    }
  };

  window.__kabmoCall = (method, params) => {
    const { promise, resolve, reject } = Promise.withResolvers<unknown>();
    const id = next++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`The shell did not answer ${method} within 60s.`));
    }, REPLY_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    const form = encodeParams(params ?? {});
    if (host === 'android') {
      window.kabmoHost?.post(method, String(id), form);
    } else {
      window.webkit?.messageHandlers?.kabmo?.postMessage({ id, method, params: form });
    }
    return promise;
  };
}

/** One command over whichever transport this shell installed. */
export async function callShell<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const invoke = typeof window === 'undefined' ? undefined : window.__kabmoCall;
  if (!invoke) throw new Error('Not running inside a Kabmo shell.');
  return (await invoke(method, params)) as T;
}

/**
 * A refused command's message.
 *
 * The shell sends its own sentence (a refused URL, a server that exited), which is
 * what the UI shows. Nothing is stripped: a message that genuinely starts with
 * "Error" would lose its first word.
 */
export function bridgeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
