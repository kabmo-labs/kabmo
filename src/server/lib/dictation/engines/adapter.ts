/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared half of every hosted transcription adapter: the input shape, one
 * timeout, and one place that turns an HTTP status into a sentence.
 *
 * Error mapping is shared because the failure a user can act on is the STATUS:
 * a rejected key, an empty wallet, a rate limit and an oversized upload are four
 * different fixes, and a provider's raw body is often a JSON envelope whose
 * message is the only readable part. Nothing here echoes a header, so a key
 * cannot leak into the error strip.
 */

/** One utterance, already in the shape every provider accepts. */
export interface EngineTranscribeInput {
  /** PCM16LE mono at 16 kHz — the wire format the browser captured. */
  pcm16: Uint8Array;
  /** ISO-639-1 tag, or undefined to let the provider detect. */
  language?: string;
  model: string;
  /** Resolved endpoint (base URL, or the engine's fixed one). */
  baseUrl: string;
  prompt?: string;
  apiKey?: string;
}

export class DictationEngineError extends Error {
  constructor(
    message: string,
    /** True when retrying the same request could plausibly work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'DictationEngineError';
  }
}

const TIMEOUT_MS = 60_000;
const BODY_SNIPPET_CHARS = 200;

/** POST, with the one timeout every provider gets, and its failure mapped. */
export async function postAudio(label: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new DictationEngineError(`${label} did not answer within 60 seconds.`, true);
    }
    throw new DictationEngineError(`Could not reach ${label}.`, true);
  }
  if (response.ok) return response;
  throw new DictationEngineError(
    await describeFailure(label, response),
    response.status === 408 || response.status === 429 || response.status >= 500,
  );
}

/** The provider's own message when it has one, with the status attached. */
async function describeFailure(label: string, response: Response): Promise<string> {
  const detail = await readFailureDetail(response);
  const suffix = detail ? ` — ${detail}` : '';
  switch (response.status) {
    case 401:
    case 403:
      return `${label} rejected the API key (HTTP ${response.status})${suffix}`;
    case 402:
      return `${label} reports the account has no credit (HTTP 402)${suffix}`;
    case 413:
      return `The recording is too long for ${label} (HTTP 413)${suffix}`;
    case 429:
      return `${label} rate-limited the request (HTTP 429)${suffix}`;
    default:
      return `${label} failed (HTTP ${response.status})${suffix}`;
  }
}

async function readFailureDetail(response: Response): Promise<string> {
  let text = '';
  try {
    text = (await response.text()).trim();
  } catch {
    return '';
  }
  if (!text) return '';
  try {
    const parsed: unknown = JSON.parse(text);
    const message = errorMessageOf(parsed);
    if (message) return message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, BODY_SNIPPET_CHARS);
}

function errorMessageOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'detail', 'error']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'object' && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return null;
}

/**
 * The transcript out of a successful answer.
 *
 * `{text}` is what every [OI]-shaped server returns; a bare `text/plain` body is
 * what several compatible servers answer instead. Both are accepted so the
 * "compatible" claim is true.
 */
export async function readTranscript(response: Response): Promise<string> {
  const contentType = response.headers.get('content-type') ?? '';
  const body = await response.text();
  if (!contentType.includes('json')) return body.trim();
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed === 'object' && parsed !== null) {
      const text = (parsed as Record<string, unknown>).text;
      if (typeof text === 'string') return text.trim();
    }
  } catch {
    // A server that lies about its content type still gets the text branch.
  }
  return body.trim();
}

/** The key, or a refusal that names the engine. */
export function requireApiKey(label: string, apiKey: string | undefined): string {
  const key = (apiKey ?? '').trim();
  if (!key) {
    throw new DictationEngineError(
      `${label} needs an API key. Add one in Settings → Dictation.`,
      false,
    );
  }
  return key;
}
