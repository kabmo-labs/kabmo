/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Which wire protocols an ENDPOINT actually speaks — measured, not assumed.
 *
 * An import's hardest question is not "which file" but "which API does this host
 * answer". A provider's own declaration is only about the agent it was written
 * for: measured on `kenari`, whose omp entry says `openai-completions` while the
 * host also answers Anthropic Messages on `/v1/messages` — which is what makes
 * "import kenari from omp into Claude Code" work at all, and what makes writing
 * its declared dialect there fail every request.
 *
 * So the import probes. One unauthenticated `POST` with an empty JSON body per
 * protocol is enough, because every one of these APIs rejects a body it cannot
 * parse BEFORE it looks at a credential:
 *
 * | Route | Empty body answers | Meaning |
 * |---|---|---|
 * | `POST {root}/v1/messages` | 400 `invalid Anthropic request JSON` | Anthropic Messages |
 * | `POST {root}/v1/chat/completions` | 400 `invalid JSON: missing field model` | OpenAI Chat |
 * | `POST {root}/v1/responses` | 400 (same shape) | OpenAI Responses |
 * | `GET {root}/v1beta/models` | 200 JSON list | Google GenAI |
 *
 * 404/405 (and an HTML error page) mean the route is not there. A 401/403 means
 * the route IS there and wants a key — also a yes. The probe therefore sends NO
 * credential: it answers a question about the HOST, and it must be safe to run
 * for a provider whose key is unset or rotated.
 *
 * Measured against kenari.id: `/v1/messages` and `/v1/responses` answer (200 with
 * a key, 400 on an empty body), `/messages` answers 405, `/v1beta/models` answers
 * a 404 HTML page.
 *
 * Server-only: it performs outbound HTTP the settings page must not.
 */

import { CANONICAL_PROTOCOLS, type CanonicalProtocol } from '@/shared/lib/harness/dialects';

/** Bounded because the caller is a settings card and the host is a stranger. */
const PROBE_TIMEOUT_MS = 6_000;
const PROBE_BODY = '{}';

/** The one request that answers "is this route here" for a protocol. */
function routeFor(root: string, protocol: CanonicalProtocol): { url: string; init: RequestInit } {
  const json = { 'content-type': 'application/json' };
  switch (protocol) {
    case 'anthropic-messages':
      return {
        url: `${root}/v1/messages`,
        init: { method: 'POST', headers: { ...json, 'anthropic-version': '2023-06-01' }, body: PROBE_BODY },
      };
    case 'openai-chat':
      return { url: `${root}/v1/chat/completions`, init: { method: 'POST', headers: json, body: PROBE_BODY } };
    case 'openai-responses':
      return { url: `${root}/v1/responses`, init: { method: 'POST', headers: json, body: PROBE_BODY } };
    case 'google-genai':
    case 'vertex-ai':
      // Vertex answers the same listing under a different host shape; a probe of
      // the Gemini route proves the SDK's presence, which is the fact an import
      // needs. A vertex-only host simply does not answer and is not offered.
      return { url: `${root}/v1beta/models`, init: { method: 'GET' } };
  }
}

/** True when a status proves the route EXISTS — it parsed or authenticated nothing. */
function routeExists(status: number, contentType: string): boolean {
  if (status === 404 || status === 405 || status === 410 || status === 501) return false;
  // A 2xx/4xx proves the router knew the path. A 5xx from an HTML page is an
  // error wall in front of the whole site, not a route.
  if (status >= 500) return false;
  // An error page served as HTML is the site's 404 page dressed as a 400.
  if (contentType.includes('text/html')) return false;
  return true;
}

export interface EndpointProbe {
  /** The host root the probe used (version segment stripped). */
  root: string;
  /** Protocols whose route answered, in probe order. */
  protocols: CanonicalProtocol[];
  /** One line per protocol tried, for the card to show as evidence. */
  findings: Array<{ protocol: CanonicalProtocol; status: number | null; present: boolean }>;
  /** Set when the host could not be reached at all. */
  error?: string;
}

/**
 * Probe one endpoint for every portable protocol.
 *
 * All five run in parallel: they are independent GET/POSTs to one host, and a
 * settings card waits on the slowest. A network failure marks the whole probe
 * errored rather than reporting five false negatives — "cannot reach" and "does
 * not speak this" are different answers.
 */
export async function probeEndpointProtocols(baseUrl: string): Promise<EndpointProbe> {
  const root = baseUrl.trim().replace(/\/+$/, '').replace(/\/v1(beta|alpha)?$/i, '');
  if (!root) return { root, protocols: [], findings: [], error: 'No endpoint to probe' };

  let networkError: string | null = null;
  const findings = await Promise.all(CANONICAL_PROTOCOLS.map(async (protocol) => {
    const { url, init } = routeFor(root, protocol);
    try {
      const response = await fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      const contentType = response.headers.get('content-type') ?? '';
      // Drain the body: an unread response keeps the connection alive and Bun
      // will hold the socket until the timeout.
      await response.text().catch(() => '');
      return { protocol, status: response.status, present: routeExists(response.status, contentType) };
    } catch (cause) {
      networkError ??= cause instanceof Error ? cause.message : 'request failed';
      return { protocol, status: null, present: false };
    }
  }));

  return {
    root,
    protocols: findings.filter((finding) => finding.present).map((finding) => finding.protocol),
    findings,
    ...(networkError ? { error: networkError } : {}),
  };
}
