/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The HTTP listener this process is serving on, plus how to talk to it.
 *
 * Two consumers need it and neither can import it: the shell renderer, which
 * asks the listener for its own `/_shell` route (Bun renders an HTML route only
 * while serving), and the dev asset proxy, which asks it for the assets Bun's
 * own routing table owns. The reference is injected rather than imported because
 * `index.ts` owns the listener and imports both of them — a direct import would
 * be a cycle.
 *
 * The fetch options are part of the reference because the two are only correct
 * together. Under TLS the listener's own URL is `https://` with a self-signed
 * certificate, so an internal request without `rejectUnauthorized: false` fails
 * its handshake — measured: the shell route answered "self signed certificate"
 * and every page rendered the "Shell not available" page.
 */

type Listener = { url: URL; fetchOptions?: RequestInit } | null;

let listener: Listener = null;

/** Called by the server entry once its listener is up. */
export function setListener(server: { url: URL }, fetchOptions?: RequestInit): void {
  listener = { url: server.url, fetchOptions };
}

/**
 * Drop the reference — the listener is gone.
 *
 * Paired with `setListener`, and what keeps "before the server publishes its
 * listener" observable: the reference is module state that outlives a whole
 * `bun test` process, so a suite that published one must be able to unpublish.
 */
export function clearListener(): void {
  listener = null;
}

/** The listener's base URL, or null before it is up. */
export function listenerUrl(): URL | null {
  return listener?.url ?? null;
}

/**
 * Options for a request the server makes to ITSELF.
 *
 * Empty over plain HTTP. Under TLS it carries `rejectUnauthorized: false`: the
 * certificate is one this machine generated, and the caller is this same process
 * asking its own listener — there is no third party to impersonate, so verifying
 * it would only prevent the server from reading its own routes.
 */
export function listenerFetchOptions(): RequestInit {
  return listener?.fetchOptions ?? {};
}
