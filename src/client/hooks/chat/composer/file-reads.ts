/**
 * @license
 * SPDX-License-Identifier: MIT
 */

/**
 * Reading a dropped `File`'s bytes — and the one browser rule that makes the
 * TIMING of that read part of the contract.
 *
 * A file that arrives through a drop is not an ordinary `Blob`. The browser
 * holds a permission reference to the real file, and that reference is released
 * when the `drop` event's handler returns. A read started after that point
 * fails with `NotReadableError: ... permission problems that have occurred
 * after a reference to a file was acquired`, and it fails PERMANENTLY — every
 * retry after it fails the same way, because the reference is gone rather than
 * busy. This is why a dropped file showed a chip with a correct name and size
 * while its contents never arrived, and why three retries did not help.
 *
 * `FileReader.readAs*` checks the permission when it is CALLED, not when it
 * completes. So the read must be STARTED synchronously inside the drop handler;
 * awaiting its result later is fine. `primeFileReads` is that start, and every
 * later consumer takes the already-running read rather than beginning its own.
 */


/** How many times a read that came back empty is retried before giving up. */
export const READ_ATTEMPTS = 3;

/** Base delay between read attempts; a promised file needs a beat to land. */
export const READ_RETRY_MS = 60;

/**
 * How many files a single drop primes up front. Matches `MAX_DROPPED_FILES`:
 * priming beyond what can be attached would hold bytes the budget will reject.
 */
const MAX_PRIMED_FILES = 50;

export function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Start a data-URL read and return the still-running promise.
 *
 * MUST be called synchronously from the drop handler — see the module note. The
 * result is the whole `data:<mime>;base64,<payload>` string, because the two
 * consumers want different halves of it: an image takes the payload, a text file
 * decodes it back to text.
 */
function startDataUrlRead(file: File): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
  reader.onerror = () => {
    resolve(null);
  };
  reader.onabort = () => resolve(null);
  reader.readAsDataURL(file);
  return promise;
}

/**
 * A read already in flight, started while the drop's permission was live.
 *
 * `dataUrl` and `prefix` are the PRIMARY file's reads. `spare` holds the reads
 * of the same drop's other `File` object, tried when the primary yields nothing:
 * a drop can expose one file twice and only one of the two objects reads, with
 * neither the metadata nor the context saying which. See `drop-entries.ts`.
 */
export interface PrimedRead {
  /** The whole file as a data URL — the authorized read of a dropped file. */
  dataUrl: Promise<string | null>;
  /**
   * The leading bytes, for the text sniff and the empty-stub check.
   *
   * Those two ask a `File` for bytes through `slice().arrayBuffer()`, which is
   * subject to the same permission as `FileReader` — so they have to be served
   * from a read started in the drop's tick as well, not started on demand.
   */
  prefix: Promise<Uint8Array | null>;
  /** The counterpart object's reads, when the payload exposed the file twice. */
  spare?: PrimedRead;
}

export type PrimedReads = Map<File, PrimedRead>;

/** Bytes sampled to decide whether an unclassified file is text. */
const PREFIX_BYTES = 4096;

function startPrefixRead(file: File): Promise<Uint8Array | null> {
  const { promise, resolve } = Promise.withResolvers<Uint8Array | null>();
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result instanceof ArrayBuffer ? new Uint8Array(reader.result) : null);
  reader.onerror = () => resolve(null);
  reader.onabort = () => resolve(null);
  reader.readAsArrayBuffer(file.slice(0, PREFIX_BYTES));
  return promise;
}

/**
 * Begin reading every file NOW, in the drop handler's own tick.
 *
 * Returns a lookup the later async pipeline consults instead of reading the
 * `File` itself. Files that were not primed (a directory walk discovers its
 * children after the tick) simply have no entry and fall back to a fresh read.
 */
export function primeFileReads(files: readonly File[], fallbacks?: Map<File, File>): PrimedReads {
  const primed: PrimedReads = new Map();
  // Bounded by the same cap the attach path applies: a read is buffered as a
  // data URL, so priming a thousand-file drop would hold every byte twice
  // before the budget had a chance to reject any of them.
  for (const file of files.slice(0, MAX_PRIMED_FILES)) {
    if (primed.has(file)) continue;
    const counterpart = fallbacks?.get(file);
    primed.set(file, {
      dataUrl: startDataUrlRead(file),
      prefix: startPrefixRead(file),
      // Primed in the same tick for the same reason: a fallback whose own read
      // starts after the drop window closes is not authorized either.
      ...(counterpart
        ? { spare: { dataUrl: startDataUrlRead(counterpart), prefix: startPrefixRead(counterpart) } }
        : {}),
    });
  }
  return primed;
}

/**
 * The primed leading bytes, or `undefined` when the file was never primed.
 *
 * An empty array means the read was attempted and yielded nothing — which is
 * also what a genuine empty file gives, and what the sniff should see.
 */
export async function primedPrefix(file: File, primed?: PrimedReads): Promise<Uint8Array | undefined> {
  const started = primed?.get(file);
  if (!started) return undefined;
  const bytes = await started.prefix;
  if (bytes && bytes.byteLength > 0) return bytes;
  if (started.spare) {
    const spare = await started.spare.prefix;
    if (spare && spare.byteLength > 0) return spare;
  }
  return bytes ?? new Uint8Array(0);
}

/** The base64 payload of a data URL, or null when there is none. */
export function base64Of(dataUrl: string | null): string | null {
  if (dataUrl === null) return null;
  const comma = dataUrl.indexOf(',');
  return comma === -1 ? null : dataUrl.slice(comma + 1);
}

/**
 * Decode a data URL's payload back to text, or null when it cannot be decoded.
 *
 * Null covers both "no payload" and "payload is not text": a dropped binary
 * arrives through the same data-URL read, and its bytes are not a UTF-8 string.
 */
export function textOf(dataUrl: string | null): string | null {
  const base64 = base64Of(dataUrl);
  if (base64 === null) return null;
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

/** Read a File as base64, or null when the read fails. */
export async function readAsDataUrl(file: File, primed?: PrimedReads): Promise<string | null> {
  const started = primed?.get(file);
  if (started) {
    const payload = base64Of(await started.dataUrl);
    if (payload !== null) return payload;
    // The primary object did not read; the drop's other object for the same file
    // may. One of the two is unreadable in a given context and it is not the one
    // the metadata suggests.
    if (started.spare) return base64Of(await started.spare.dataUrl);
    return null;
  }
  return base64Of(await startDataUrlRead(file));
}

/** Read a File as text through `readAsText`, or null when the read fails. */
function readAsTextDirect(file: File): Promise<string | null> {
  const { promise, resolve } = Promise.withResolvers<string | null>();
  const reader = new FileReader();
  reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
  reader.onerror = () => {
    resolve(null);
  };
  reader.onabort = () => resolve(null);
  reader.readAsText(file);
  return promise;
}

/**
 * Read a File's text, preferring a read that was already started.
 *
 * The primed read is the one that matters: it is the only one the browser is
 * guaranteed to authorize for a dropped file (see the module note), so it is
 * consulted first and a non-empty body from it ends the call. The loop behind it
 * exists for a PROMISED file — another app's drag, whose bytes land a moment
 * after the entry exists — and for a file that was never primed at all.
 *
 * Returns null when no attempt produced a body for a file that declares bytes.
 */
export async function readFileTextWithRetry(file: File, primed?: PrimedReads): Promise<string | null> {
  const started = primed?.get(file);
  if (started) {
    const content = textOf(await started.dataUrl);
    if (content !== null && content.length > 0) return content;
    if (started.spare) {
      const spare = textOf(await started.spare.dataUrl);
      if (spare !== null && spare.length > 0) return spare;
    }
  }

  let last: string | null = null;
  for (let attempt = 0; attempt < READ_ATTEMPTS; attempt += 1) {
    last = await readAsTextDirect(file);
    if (last === null || last.length === 0) {
      const viaDataUrl = textOf(await startDataUrlRead(file));
      if (viaDataUrl !== null && viaDataUrl.length > 0) return viaDataUrl;
    }
    if (last !== null && last.length > 0) return last;
    // An empty body is the real answer once the file has had a beat to
    // materialize AND declares no bytes of its own.
    if (file.size === 0 && attempt > 0) return last ?? '';
    await delay(READ_RETRY_MS);
  }
  return last;
}
