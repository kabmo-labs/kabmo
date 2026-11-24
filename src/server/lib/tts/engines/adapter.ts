/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * The shared half of every hosted speech adapter: the input shape, one timeout,
 * and one place that turns an HTTP status into a sentence.
 *
 * Error mapping is shared because the failure a user can act on is the STATUS:
 * a rejected key, an empty wallet, a rate limit and a refused input are four
 * different fixes, and a provider's raw body is often a JSON envelope whose
 * message is the only readable part. Nothing here echoes a header, so a key
 * cannot leak into the error strip.
 */

/** One synthesis request, already in the shape every provider accepts. */
export interface TtsSynthInput {
  text: string;
  model: string;
  voice: string;
  language: string;
  baseUrl: string;
  speed: number;
  apiKey?: string;
}

export interface TtsAudio {
  bytes: Uint8Array;
  mimeType: string;
}

export class TtsEngineError extends Error {
  constructor(
    message: string,
    /** True when retrying the same request could plausibly work. */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'TtsEngineError';
  }
}

const TIMEOUT_MS = 90_000;
const BODY_SNIPPET_CHARS = 200;

/** POST, with the one timeout every provider gets, and its failure mapped. */
export async function postSpeech(label: string, url: string, init: RequestInit): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new TtsEngineError(`${label} did not answer within 90 seconds.`, true);
    }
    throw new TtsEngineError(`Could not reach ${label}.`, true);
  }
  if (response.ok) return response;
  throw new TtsEngineError(
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
      return `The answer is too long for ${label} (HTTP 413)${suffix}`;
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
    const message = errorMessageOf(JSON.parse(text) as unknown);
    if (message) return message;
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, BODY_SNIPPET_CHARS);
}

function errorMessageOf(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  for (const key of ['message', 'detail', 'error', 'err_msg']) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (typeof candidate === 'object' && candidate !== null) {
      const nested = (candidate as Record<string, unknown>).message;
      if (typeof nested === 'string' && nested.trim()) return nested.trim();
    }
  }
  return null;
}

/** The audio bytes, with the provider's content type when it states one. */
export async function readAudio(response: Response, fallbackMime: string): Promise<TtsAudio> {
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength === 0) {
    throw new TtsEngineError('The speech engine returned no audio.', true);
  }
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim();
  return { bytes: buffer, mimeType: mimeType && mimeType.startsWith('audio/') ? mimeType : fallbackMime };
}

/** The key, or a refusal that names the engine. */
export function requireApiKey(label: string, apiKey: string | undefined): string {
  const key = (apiKey ?? '').trim();
  if (!key) {
    throw new TtsEngineError(`${label} needs an API key. Add one in Settings → Voice → Speech.`, false);
  }
  return key;
}
