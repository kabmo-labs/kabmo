/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * One authenticated GET against a provider's own balance/usage endpoint.
 *
 * Every balance source needs the same three answers — key rejected, request
 * failed, response is not JSON — and they must read the same on every card, so
 * the status handling lives here rather than in each adapter.
 */

const FETCH_TIMEOUT_MS = 10_000;

/**
 * Fetch and parse JSON, or throw an error whose message is safe to show in the
 * provider card (it names the provider, never the credential).
 */
export async function fetchProviderJson(url: string, apiKey: string, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} balance request failed`);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label} rejected the API key (HTTP ${response.status}).`);
  }
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${label} balance request failed (HTTP ${response.status}).`);
  }
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} returned an unreadable balance response.`);
  }
}
