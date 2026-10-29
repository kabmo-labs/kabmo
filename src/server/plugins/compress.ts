// node:zlib stays for brotli only — Bun has no brotli API (Bun.brotliCompressSync is undefined).
import { brotliCompressSync, constants } from 'node:zlib';
import { bodyBytes } from '@/shared/lib/util/bytes';

/**
 * Compresses a response body, except `text/event-stream`.
 *
 * SSE must never be compressed: zlib holds small frames until its buffer
 * fills, so a compressed event stream delivers nothing until it ends. This
 * mirrors the Express `compression({ filter })` it replaces.
 *
 * The incoming body is buffered and a fresh `Response` is returned, because a
 * `Response` body can only be read once — reading it here would otherwise
 * leave Elysia nothing to send.
 *
 * Encodings are offered best-first: zstd, brotli, gzip. On a 905 KiB JSON body
 * the three measured 0.48 ms / 8 KiB, 1.05 ms / 7 KiB and 2.22 ms / 19 KiB —
 * zstd is both the fastest and, within 14% of brotli's ratio, effectively as
 * small, and it stays ahead at every payload size measured (0.004 ms against
 * 0.007 ms for gzip at 2 KiB). Brotli remains for a client that accepts `br`
 * but not `zstd`, and gzip is the floor every client has.
 */
export const MIN_BYTES = 1024;

const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml|wasm|svg))/;

/** Compression encodings this server can produce, best first. */
const ENCODINGS = ['zstd', 'br', 'gzip'] as const;

export type Encoding = (typeof ENCODINGS)[number];

/**
 * Whether a content type is worth compressing at all.
 *
 * Exported because the static asset route decides the same thing before it
 * reads a file: buffering a PNG or a woff2 to discover it compresses to itself
 * is work that buys nothing.
 */
export function isCompressible(contentType: string): boolean {
  return COMPRESSIBLE.test(contentType);
}

/**
 * The best encoding the client accepts, or null.
 *
 * Plain substring matching, matching the previous `includes('br')` behavior: a
 * browser's `Accept-Encoding` is an explicit set of alternatives, not a
 * preference ordering this server has to weigh.
 */
export function pickEncoding(acceptEncoding: string | null): Encoding | null {
  if (!acceptEncoding) return null;
  for (const encoding of ENCODINGS) {
    if (acceptEncoding.includes(encoding)) return encoding;
  }
  return null;
}

export function compressBytes(body: Uint8Array<ArrayBuffer>, encoding: Encoding): Uint8Array<ArrayBuffer> {
  if (encoding === 'zstd') return bodyBytes(Bun.zstdCompressSync(body, { level: 3 }));
  if (encoding === 'br') {
    return bodyBytes(brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4 } }));
  }
  return bodyBytes(Bun.gzipSync(body, { level: 6 }));
}

export async function maybeCompress(response: Response, acceptEncoding: string | null): Promise<Response> {
  if (!acceptEncoding) return response;
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('text/event-stream')) return response;
  if (!COMPRESSIBLE.test(contentType)) return response;
  if (response.status === 204 || response.status === 304) return response;

  const encoding = pickEncoding(acceptEncoding);
  if (!encoding) return response;

  const buffer = bodyBytes(new Uint8Array(await response.arrayBuffer()));
  if (buffer.byteLength < MIN_BYTES) {
    // Body already consumed — hand back a rebuilt Response over the same bytes.
    return rebuild(response, buffer);
  }

  const compressed = compressBytes(buffer, encoding);
  const headers = new Headers(response.headers);
  headers.set('content-encoding', encoding);
  headers.set('content-length', String(compressed.byteLength));
  headers.append('vary', 'accept-encoding');
  return new Response(compressed, { status: response.status, headers });
}

function rebuild(response: Response, buffer: Uint8Array<ArrayBuffer>): Response {
  return new Response(buffer, { status: response.status, headers: response.headers });
}
