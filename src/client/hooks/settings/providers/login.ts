/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * One provider sign-in flow, as the dialog sees it.
 *
 * omp's `login` command answers with `extension_ui_request` frames on a
 * throwaway RPC child (`POST /api/omp/login`):
 *
 * - `open_url` — the authorization URL. `url` is ALWAYS present; `launchUrl` is
 *   an optional loopback shortcut omp omits for manual-input-only flows and for
 *   non-loopback redirect URIs. Keying on `launchUrl` cancelled the login the
 *   moment it was absent, which is what device flows send.
 * - `input` — a pasted authorization code, or a device code the user has to
 *   type on another machine.
 * - `notify` — progress. It must be ACKNOWLEDGED, or omp waits on it.
 *
 * `instructions` is the only place a device flow says WHICH code to type, so it
 * is part of the state rather than a tooltip.
 */

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

export interface LoginUiFrame {
  id: string;
  method?: string;
  title?: string;
  message?: string;
  url?: string;
  launchUrl?: string;
  instructions?: string;
  placeholder?: string;
}

export type LoginStatus = 'connecting' | 'waiting' | 'success' | 'failed';

export interface LoginFlowState {
  status: LoginStatus;
  /** The authorization URL omp asked us to open (always present on `open_url`). */
  authUrl: string | null;
  /** omp's loopback shortcut, when it offered one. */
  launchUrl: string | null;
  /** Device-flow text (`Enter code: ABCD-1234`), when the provider sends one. */
  instructions: string | null;
  prompt: LoginUiFrame | null;
  notices: string[];
  error: string | null;
}

const INITIAL: LoginFlowState = {
  status: 'connecting',
  authUrl: null,
  launchUrl: null,
  instructions: null,
  prompt: null,
  notices: [],
  error: null,
};

/**
 * The device code inside omp's instructions, when there is one.
 *
 * Mirrors omp's own extraction (`login-dialog.ts`): the lead-in and the code.
 * A code is what a user copies to another device, so it is lifted out of the
 * sentence rather than left buried in it.
 */
export function deviceCodeOf(instructions: string | null): string | null {
  if (!instructions) return null;
  const match = /^(.*\bcode:?\s+)([A-Za-z0-9][A-Za-z0-9-]{3,})\s*$/s.exec(instructions.trim());
  return match?.[2] ?? null;
}

/** A host only the machine running it can reach. */
function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '');
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1' || bare.endsWith('.localhost');
}

/**
 * Whether this browser can usefully open `url`.
 *
 * omp's callback server runs on the SERVER, so its `launchUrl` is
 * `http://127.0.0.1:<port>/launch`. Opening that from a console served on
 * another machine reaches the READER's localhost — a dead tab that looks like
 * a broken login. The same address IS correct when the console itself is on
 * loopback (the usual local install), which is why the page's own host decides
 * rather than a hard-coded refusal.
 */
export function canOpenLocally(url: string | null): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  if (!isLoopbackHost(parsed.hostname)) return true;
  return typeof window !== 'undefined' && isLoopbackHost(window.location.hostname);
}

interface UseProviderLoginOptions {
  isOpen: boolean;
  providerId: string;
  onAuthenticated: () => void;
}

/** Drive one login flow while `isOpen`; abort it when the dialog closes. */
export function useProviderLogin({ isOpen, providerId, onAuthenticated }: UseProviderLoginOptions) {
  const [state, setState] = useState<LoginFlowState>(INITIAL);
  const [inputValue, setInputValue] = useState('');
  const respondRef = useRef<((payload: Record<string, unknown>) => void) | null>(null);
  // Read through a ref: the parent recreates this handler on every render, and
  // a changing dependency would abort + restart the login stream mid-flow.
  const onAuthenticatedRef = useRef(onAuthenticated);
  onAuthenticatedRef.current = onAuthenticated;

  useEffect(() => {
    if (!isOpen) return;
    setState(INITIAL);
    setInputValue('');

    const controller = new AbortController();
    let loginId: string | null = null;
    const respond = (payload: Record<string, unknown>) => {
      if (!loginId) return;
      // The server routes a frame by `type`, so a reply that omits it falls
      // through to the "start a login" branch and is answered 400 — the reply
      // then never reaches omp and the flow waits forever.
      void fetch('/api/omp/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, type: 'extension_ui_response', loginId }),
        signal: controller.signal,
      }).catch(() => {});
    };
    respondRef.current = respond;

    void fetch('/api/omp/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId }),
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const reason = body && typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
          throw new Error(reason);
        }
        if (!response.body) throw new Error('Streaming is not supported by this browser');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split('\n\n');
          buffer = parts.pop() ?? '';
          for (const part of parts) {
            const line = part.split('\n').find((entry) => entry.startsWith('data: '));
            if (!line) continue;
            let frame: Record<string, unknown>;
            try {
              frame = JSON.parse(line.slice(6)) as Record<string, unknown>;
            } catch {
              continue; // malformed frame — skip
            }
            const type = frame.type;
            if (type === 'login_started' && typeof frame.loginId === 'string') {
              loginId = frame.loginId;
              continue;
            }
            if (type === 'extension_ui_request') {
              const ui: LoginUiFrame = {
                id: typeof frame.id === 'string' ? frame.id : '',
                ...(typeof frame.method === 'string' ? { method: frame.method } : {}),
                ...(typeof frame.title === 'string' ? { title: frame.title } : {}),
                ...(typeof frame.message === 'string' ? { message: frame.message } : {}),
                ...(typeof frame.url === 'string' ? { url: frame.url } : {}),
                ...(typeof frame.launchUrl === 'string' ? { launchUrl: frame.launchUrl } : {}),
                ...(typeof frame.instructions === 'string' ? { instructions: frame.instructions } : {}),
                ...(typeof frame.placeholder === 'string' ? { placeholder: frame.placeholder } : {}),
              };
              const method = ui.method;
              if (method === 'open_url') {
                // `url` is the authorization target; `launchUrl` is a shortcut
                // that only exists for a loopback flow on THIS machine.
                const authUrl = ui.url ?? null;
                setState((prev) => ({
                  ...prev,
                  status: 'waiting',
                  authUrl,
                  launchUrl: ui.launchUrl ?? null,
                  instructions: ui.instructions ?? null,
                }));
                // Auto-open only when the target is reachable from here. A
                // server-side loopback URL opened on the user's machine is a
                // dead tab, and a popup blocker eats the attempt silently.
                const target = ui.launchUrl ?? authUrl;
                if (canOpenLocally(target)) {
                  window.open(target as string, '_blank', 'noopener');
                }
                continue;
              }
              if (method === 'input') {
                setState((prev) => ({ ...prev, status: 'waiting', prompt: ui }));
                continue;
              }
              if (method === 'notify') {
                const text = typeof ui.title === 'string' ? ui.title : '';
                setState((prev) => ({
                  ...prev,
                  status: 'waiting',
                  notices: text ? [...prev.notices, text] : prev.notices,
                }));
                // omp blocks on this acknowledgement; without it the flow
                // stalls with the progress line on screen and nothing behind it.
                respond({ id: ui.id, accepted: true });
                continue;
              }
              // Any other dialog method has no answer this dialog can give.
              respond({ id: ui.id, cancelled: true });
              continue;
            }
            if (type === 'login_result') {
              const ok = frame.success === true;
              setState((prev) => ({
                ...prev,
                status: ok ? 'success' : 'failed',
                error: ok ? null : (typeof frame.error === 'string' ? frame.error : 'Login failed'),
              }));
              if (ok) onAuthenticatedRef.current();
              controller.abort();
              return;
            }
          }
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          ...prev,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        }));
      });

    return () => {
      controller.abort();
      respondRef.current = null;
    };
  }, [isOpen, providerId]);

  const submitInput = useCallback((cancelled: boolean) => {
    const prompt = state.prompt;
    if (!prompt) return;
    respondRef.current?.(cancelled
      ? { id: prompt.id, cancelled: true }
      : { id: prompt.id, value: inputValue });
    // The flow is now WAITING on omp, not starting: reporting `connecting` put
    // "Starting the login flow…" over a request that was already answered.
    setState((prev) => ({
      ...prev,
      prompt: null,
      status: 'waiting',
      notices: cancelled ? prev.notices : [...prev.notices, 'Sent to omp — waiting for the provider…'],
    }));
    setInputValue('');
  }, [state.prompt, inputValue]);

  return { state, inputValue, setInputValue, submitInput };
}
